// Prefetch: keep the stock of validated items full, cheapest kinds first, on one call budget.
import type { DbOrTx } from '../db/client.ts';
import { authSessionsRepo } from '../db/repositories/auth-sessions.ts';
import { cacheRepo } from '../db/repositories/cache.ts';
import { clozeItemsRepo, learnerClozeRepo } from '../db/repositories/cloze-items.ts';
import type { UsageEntry } from '../db/repositories/llm-calls.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { profilesRepo } from '../db/repositories/profiles.ts';
import { type QueuedGradingSummary, gradeQueuedWritings } from '../grading/queued.ts';
import type { LlmDeps } from '../llm/client.ts';
import { type RunBudget, startBudget } from './budget.ts';
import { buildCloze } from './cloze/build.ts';
import type { GenerationContext } from './context.ts';
import { DRILL_CODES, type DrillCode, buildDrills, drillParamsHash } from './drills/build.ts';
import { INJECTED_CODES } from './drills/inject.ts';
import { buildReading } from './reading/build.ts';
import { MAX_BAND } from '../llm/prompts/levels.ts';
import { OVERSAMPLE, STOCK_TARGETS, type StockTargets } from './stock.ts';
import { type GenSummary, countAdded, countIn, emptySummary, mergeSummary } from './summary.ts';

/**
 * What each kind costs, cheapest first: cloze items are Tatoeba sentences (LLM only for lexical
 * distractors and the critic); injected drills are Tatoeba sentences plus an explanation and the
 * critic; LLM drills are written by the model; passages are long LLM texts.
 */
export const COST_RANK = { cloze: 0, 'drill-injected': 1, 'drill-llm': 2, reading: 3 } as const;
export type ShortfallKind = keyof typeof COST_RANK;

export interface Shortfall {
	kind: ShortfallKind;
	band: number;
	/** For drills. */
	topic?: DrillCode;
	have: number;
	target: number;
	missing: number;
}

export interface StockLevels {
	/** The highest known_band_ceiling across the non-archived profiles (Phase 12). */
	ceiling: number;
	/** Per band: validated shared items the most-served learner has no card for yet (the minimum across profiles). */
	cloze: ReadonlyMap<number, number>;
	/** Key "TOPIC|band". */
	drills: ReadonlyMap<string, number>;
	reading: ReadonlyMap<number, number>;
}

export const bandsInRange = (ceiling: number) =>
	Array.from({ length: Math.min(MAX_BAND, Math.max(1, ceiling + 1)) }, (_, i) => i + 1);

const isInjected = (topic: DrillCode) => (INJECTED_CODES as readonly string[]).includes(topic);

/** Every stock below its target, cheapest kind first (then band, then topic). */
export function computeShortfall(levels: StockLevels, targets: StockTargets = STOCK_TARGETS): Shortfall[] {
	const out: Shortfall[] = [];
	const add = (kind: ShortfallKind, band: number, have: number, target: number, topic?: DrillCode) => {
		if (have < target) out.push({ kind, band, have, target, missing: target - have, ...(topic ? { topic } : {}) });
	};
	for (const band of bandsInRange(levels.ceiling)) {
		add('cloze', band, levels.cloze.get(band) ?? 0, targets.clozePerBand);
		for (const topic of DRILL_CODES) {
			add(isInjected(topic) ? 'drill-injected' : 'drill-llm', band, levels.drills.get(`${topic}|${band}`) ?? 0, targets.drillsPerTopicPerBand, topic);
		}
		add('reading', band, levels.reading.get(band) ?? 0, targets.readingPerBand);
	}
	return orderCheapestFirst(out);
}

export function orderCheapestFirst(shortfalls: readonly Shortfall[]): Shortfall[] {
	return [...shortfalls].sort(
		(a, b) =>
			COST_RANK[a.kind] - COST_RANK[b.kind] ||
			a.band - b.band ||
			DRILL_CODES.indexOf(a.topic ?? 'ART') - DRILL_CODES.indexOf(b.topic ?? 'ART')
	);
}

/**
 * Cloze stock is shared, but "available" depends on the learner (items they already have a card
 * for are used up): the stock is as full as it is for the learner with the fewest items left.
 */
function sharedClozeAvailable(db: DbOrTx, learners: readonly number[], bands: readonly number[]): Map<number, number> {
	if (learners.length === 0) {
		const validated = new Map<number, number>();
		for (const c of clozeItemsRepo(db).counts()) if (c.validated) validated.set(c.levelBand, (validated.get(c.levelBand) ?? 0) + c.n);
		return validated;
	}
	const perLearner = learners.map((id) => learnerClozeRepo(db, id).availableByBand());
	return new Map(bands.map((band) => [band, Math.min(...perLearner.map((m) => m.get(band) ?? 0))]));
}

/** Current stock levels from the database, across every non-archived profile (one shared stock). */
export function readStockLevels(db: DbOrTx): StockLevels {
	const cache = cacheRepo(db);
	const topicByHash = new Map(DRILL_CODES.map((t) => [drillParamsHash(t), t]));
	const drills = new Map<string, number>();
	for (const row of cache.countByParams('error')) {
		const topic = topicByHash.get(row.paramsHash);
		if (topic !== undefined) drills.set(`${topic}|${row.levelBand}`, (drills.get(`${topic}|${row.levelBand}`) ?? 0) + row.n);
	}
	const reading = new Map<number, number>();
	for (const row of cache.countByParams('reading')) reading.set(row.levelBand, (reading.get(row.levelBand) ?? 0) + row.n);
	const learners = profilesRepo(db)
		.active()
		.map((p) => p.id);
	const ceiling = Math.max(1, ...learners.map((id) => profileRepo(db, id).get().knownBandCeiling));
	return {
		ceiling,
		cloze: sharedClozeAvailable(db, learners, bandsInRange(ceiling)),
		drills,
		reading
	};
}

export interface PrefetchDeps {
	llm: LlmDeps;
	context: GenerationContext;
	dailyCap: number;
	targets?: StockTargets;
}

export interface PrefetchSummary extends GenSummary {
	shortfall: Shortfall[];
	/** Stock kinds (in order) that were worked on before the budget ran out or all were filled. */
	steps: string[];
	budgetExhausted: boolean;
	llm: { calls: number; usage: UsageEntry[] };
	/** Queued writing submissions graded first (learner-facing, so before the stock). */
	writing: QueuedGradingSummary;
	/** Expired login sessions deleted at the start of the run (housekeeping). */
	expiredSessionsDeleted: number;
}

const oversample = (n: number) => Math.ceil(n * OVERSAMPLE);

/**
 * Delete expired login sessions, grade the queued writings, then fill the stock: compute the
 * shortfall, then run cloze, injected drills, LLM drills and reading. All on one call budget.
 */
export async function prefetch(options: { maxCalls: number }, deps: PrefetchDeps): Promise<PrefetchSummary> {
	const db = deps.llm.db;
	const expiredSessionsDeleted = authSessionsRepo(db).deleteExpired(deps.llm.now());
	const budget: RunBudget = startBudget(db, deps.llm.now(), { maxCalls: options.maxCalls, dailyCap: deps.dailyCap });
	const shortfall = computeShortfall(readStockLevels(db), deps.targets);
	const writing = await gradeQueuedWritings({ maxCalls: options.maxCalls, budget }, { llm: deps.llm, dailyCap: deps.dailyCap });
	const summary: PrefetchSummary = { ...emptySummary(), shortfall, steps: [], budgetExhausted: false, llm: { calls: 0, usage: [] }, writing, expiredSessionsDeleted };
	const { context } = deps;

	for (const step of ['cloze', 'drill-injected', 'drill-llm', 'reading'] as const) {
		const due = shortfall.filter((s) => s.kind === step);
		if (due.length === 0) continue;
		if (!budget.canCall()) break;
		summary.steps.push(step);
		if (step === 'cloze') {
			for (const s of due) {
				if (!budget.canCall()) break;
				const result = await buildCloze(
					{ bands: [s.band, s.band], limit: oversample(s.missing), maxCalls: options.maxCalls, dailyCap: deps.dailyCap, budget },
					{ llm: deps.llm, isWord: context.isWord, blocklist: context.blocklist }
				);
				const added = Object.values(result.validated).reduce((n, bands) => n + (bands[s.band] ?? 0), 0);
				if (added > 0) countAdded(summary, 'cloze', s.band, added);
				for (const [code, n] of Object.entries(result.ruleFailures)) countIn(summary.rejected, `cloze:rule:${code}`, n);
				for (const [reason, n] of Object.entries(result.criticReasons)) countIn(summary.rejected, `cloze:${reason}`, n);
				for (const [reason, n] of Object.entries(result.llmFailureReasons)) countIn(summary.llmFailed, reason, n);
				summary.notRun += result.notRun;
			}
		} else if (step === 'reading') {
			const result = await buildReading(
				due.map((s) => ({ band: s.band, count: s.missing })),
				{ llm: deps.llm, forms: context.forms, blocklist: context.blocklist },
				{ budget }
			);
			mergeSummary(summary, result);
		} else {
			const result = await buildDrills(
				due.map((s) => ({ topic: s.topic!, band: s.band, count: oversample(s.missing) })),
				{ llm: deps.llm, forms: context.forms, classes: context.classes, blocklist: context.blocklist },
				{ budget }
			);
			mergeSummary(summary, result);
		}
	}
	summary.budgetExhausted = !budget.canCall() || summary.notRun > 0;
	summary.llm = { calls: budget.calls(), usage: budget.usage() };
	return summary;
}
