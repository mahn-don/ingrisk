// Error-correction drills (kind 'error' in generated_cache): injected into Tatoeba sentences for
// ART PLU SVA COP TNS PRE, written by the LLM for COL WFM WOR; explained in Vietnamese by the LLM;
// then rules, then the blind critic. See plans/phase-05b.md.
import { cacheRepo } from '../../db/repositories/cache.ts';
import { sentencesRepo } from '../../db/repositories/sentences.ts';
import { type LlmDeps, generateStructured } from '../../llm/client.ts';
import * as critic from '../../llm/prompts/drill-critic.ts';
import * as explain from '../../llm/prompts/drill-explain.ts';
import * as generate from '../../llm/prompts/drill-generate.ts';
import { type CallBudget, runBatches } from '../batch.ts';
import type { BlocklistMatcher } from '../blocklist.ts';
import { MAX_OFF_LIST, MAX_WORDS, MIN_WORDS } from '../cloze/candidates.ts';
import type { FormIndex } from '../forms.ts';
import { seededShuffle, sha256 } from '../random.ts';
import { type GenSummary, countAdded, countIn, emptySummary, paramsHash, reasonCode } from '../summary.ts';
import { runDrillCritic } from './critic.ts';
import { drillDiff } from './diff.ts';
import { INJECTED_CODES, type InjectedCode, type TopicCode, inject } from './inject.ts';
import { type DrillPayload, checkDrill, checkExplanation, drillRuleReason } from './rules.ts';
import type { WordClasses } from './word-classes.ts';

export const DRILL_CODES = [...INJECTED_CODES, ...generate.LLM_CODES] as const;
export type DrillCode = (typeof DRILL_CODES)[number];

/** Drills generated per LLM call (generation, explanation and critic alike). */
const PER_CALL = 10;

export interface DrillRequest {
	topic: DrillCode;
	band: number;
	count: number;
}

export interface DrillDeps {
	llm: LlmDeps;
	forms: FormIndex;
	classes: WordClasses;
	blocklist: BlocklistMatcher;
}

export interface DrillOptions {
	budget: CallBudget;
	providerId?: number;
}

export const drillParamsHash = (topic: TopicCode) => paramsHash('error', { topic_code: topic });
export const drillStockKey = (topic: TopicCode) => `error:${topic}`;
const contentHash = (p: Pick<DrillPayload, 'sentence_with_error' | 'corrected'>) =>
	sha256(`drill|${p.sentence_with_error}|${p.corrected}`);

interface Draft {
	payload: DrillPayload;
	band: number;
	hash: string;
	models: string[];
	versions: string[];
}

const isInjected = (topic: DrillCode): topic is InjectedCode => (INJECTED_CODES as readonly string[]).includes(topic);

/** Spans of the minimal diff (deterministic drafts carry exactly the change they make). */
function withSpans(sentenceWithError: string, corrected: string) {
	const diff = drillDiff(sentenceWithError, corrected);
	return { original_span: diff?.originalSpan ?? '', corrected_span: diff?.correctedSpan ?? '' };
}

/** Up to `count` new injected drafts for one code and band, from sentences in a stable seeded order. */
function injectedDrafts(request: DrillRequest & { topic: InjectedCode }, deps: DrillDeps, exclude: (hash: string) => boolean): Draft[] {
	const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
	const sentences = seededShuffle(
		sentencesRepo(deps.llm.db)
			.forCloze(MAX_OFF_LIST)
			.filter((s) => (s.levelBand ?? 1) === request.band && words(s.enText) >= MIN_WORDS && words(s.enText) <= MAX_WORDS),
		`drills|${request.topic}|${request.band}`
	);
	const drafts: Draft[] = [];
	for (const sentence of sentences) {
		if (drafts.length >= request.count) break;
		const injected = inject(sentence.enText, request.topic, deps, String(sentence.id));
		if (injected === null) continue;
		const payload: DrillPayload = {
			sentence_with_error: injected.sentenceWithError,
			corrected: injected.corrected,
			...withSpans(injected.sentenceWithError, injected.corrected),
			topic_code: request.topic,
			explanation_vi: '',
			source: 'tatoeba',
			sentence_id: sentence.id
		};
		const hash = contentHash(payload);
		if (!exclude(hash)) drafts.push({ payload, band: request.band, hash, models: [], versions: [] });
	}
	return drafts;
}

export async function buildDrills(requests: readonly DrillRequest[], deps: DrillDeps, options: DrillOptions): Promise<GenSummary> {
	const summary = emptySummary();
	const db = deps.llm.db;
	const cache = cacheRepo(db);
	const now = deps.llm.now();
	const seen = new Set<string>();
	const exclude = (hash: string) => seen.has(hash) || cache.existingHashes([hash]).size > 0;
	const llmFailed = (n: number, reason: string) => countIn(summary.llmFailed, reason, n);

	const store = (draft: Draft, validated: boolean, notes: string | null) => {
		const row = cache.insert({
			kind: 'error',
			paramsHash: drillParamsHash(draft.payload.topic_code),
			contentHash: draft.hash,
			levelBand: draft.band,
			payloadJson: draft.payload,
			model: [...new Set(draft.models)].join('+') || 'none',
			promptVersion: draft.versions.join('+') || 'rules-only',
			createdAt: now,
			validated,
			validationNotes: notes
		});
		if (row !== undefined && validated) countAdded(summary, drillStockKey(draft.payload.topic_code), draft.band);
	};
	const reject = (draft: Draft, reason: string, extra: object = {}) => {
		countIn(summary.rejected, reasonCode(reason));
		store(draft, false, JSON.stringify({ reason, ...extra }));
	};

	// 1. Drafts: injected from the corpus (no LLM), then written by the LLM (one call per 10).
	const drafts: Draft[] = [];
	for (const request of requests.filter((r) => isInjected(r.topic))) {
		const found = injectedDrafts(request as DrillRequest & { topic: InjectedCode }, deps, exclude);
		for (const d of found) seen.add(d.hash);
		drafts.push(...found);
	}
	const llmRequests = requests
		.filter((r) => !isInjected(r.topic))
		.flatMap((r) => Array.from({ length: Math.ceil(r.count / PER_CALL) }, (_, k) => ({ ...r, count: Math.min(PER_CALL, r.count - k * PER_CALL) })));
	const generated = await runBatches(
		llmRequests,
		async ([request]) => {
			const response = await generateStructured(
				{
					purpose: generate.PURPOSE,
					system: generate.system,
					user: generate.buildUser({ topic_code: request.topic as generate.LlmCode, level_band: request.band, count: request.count }),
					schema: generate.Response,
					maxTokens: 3000,
					providerId: options.providerId,
					fallback: options.providerId === undefined
				},
				deps.llm
			);
			for (const item of response.data.items.slice(0, request.count)) {
				const payload: DrillPayload = { ...item, topic_code: request.topic, source: 'llm' };
				const hash = contentHash(payload);
				if (exclude(hash)) continue;
				seen.add(hash);
				drafts.push({ payload, band: request.band, hash, models: [response.model], versions: [generate.PROMPT_VERSION] });
			}
		},
		{ budget: options.budget, size: 1 }
	);
	for (const f of generated.failures) llmFailed(f.items.reduce((n, r) => n + r.count, 0), f.reason);
	summary.notRun += generated.notRun.reduce((n, r) => n + r.count, 0);

	// 2. Structure rules (spans, single change, topic, blocklist).
	const structured: Draft[] = [];
	for (const draft of drafts) {
		const result = checkDrill(draft.payload, draft.payload.topic_code, deps.blocklist);
		if (result.ok) {
			// Store the canonical (minimal) spans, whatever the LLM wrote.
			Object.assign(draft.payload, withSpans(draft.payload.sentence_with_error, draft.payload.corrected));
			structured.push(draft);
		} else reject(draft, drillRuleReason(result));
	}

	// 3. Vietnamese explanations for injected drills (LLM-written ones came with theirs).
	const needExplanation = structured.filter((d) => d.payload.source === 'tatoeba');
	const explained = new Set(structured.filter((d) => d.payload.source === 'llm'));
	const explanations = await runBatches(
		needExplanation,
		async (batch) => {
			const response = await generateStructured(
				{
					purpose: explain.PURPOSE,
					system: explain.system,
					user: explain.buildUser(
						batch.map((d, i) => ({
							n: i + 1,
							sentence_with_error: d.payload.sentence_with_error,
							corrected: d.payload.corrected,
							original_span: d.payload.original_span,
							corrected_span: d.payload.corrected_span,
							topic_code: d.payload.topic_code
						}))
					),
					schema: explain.Response,
					maxTokens: 2500,
					providerId: options.providerId,
					fallback: options.providerId === undefined
				},
				deps.llm
			);
			const byN = new Map(response.data.items.map((item) => [item.n, item.explanation_vi]));
			batch.forEach((draft, i) => {
				const text = byN.get(i + 1);
				if (text === undefined) return llmFailed(1, 'llm:missing_item');
				draft.payload.explanation_vi = text.trim();
				draft.models.push(response.model);
				draft.versions.push(explain.PROMPT_VERSION);
				explained.add(draft);
			});
		},
		{ budget: options.budget }
	);
	for (const f of explanations.failures) llmFailed(f.items.length, f.reason);
	summary.notRun += explanations.notRun.length;

	const forCritic: Draft[] = [];
	for (const draft of structured.filter((d) => explained.has(d))) {
		const result = checkExplanation(draft.payload.explanation_vi);
		if (result.ok) forCritic.push(draft);
		else reject(draft, drillRuleReason(result));
	}

	// 4. The blind critic; judged drills are stored as each batch completes.
	const byKey = new Map(forCritic.map((d) => [d.hash, d]));
	const judged = await runDrillCritic(
		forCritic.map((d) => ({ key: d.hash, sentenceWithError: d.payload.sentence_with_error, corrected: d.payload.corrected })),
		deps.llm,
		{
			budget: options.budget,
			providerId: options.providerId,
			onJudged: (item, judgement, model) => {
				const draft = byKey.get(item.key)!;
				draft.models.push(model);
				draft.versions.push(critic.PROMPT_VERSION);
				if (judgement.ok) store(draft, true, judgement.notes);
				else {
					countIn(summary.rejected, reasonCode(judgement.reason!));
					store(draft, false, judgement.notes);
				}
			}
		}
	);
	for (const f of judged.failures) llmFailed(f.items.length, f.reason);
	if (judged.missing.length > 0) llmFailed(judged.missing.length, 'llm:missing_item');
	summary.notRun += judged.notRun.length;
	return summary;
}
