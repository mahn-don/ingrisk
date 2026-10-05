// The cloze pipeline (`npm run cloze:build`): candidates -> LLM distractors (lexical) -> rules
// -> blind critic -> store. See plans/phase-05a.md.
import { grammarTopicsRepo } from '../../db/repositories/grammar-topics.ts';
import { clozeItemsRepo, type NewClozeItem } from '../../db/repositories/cloze-items.ts';
import { lexemesRepo } from '../../db/repositories/lexemes.ts';
import { type UsageEntry, llmCallsRepo } from '../../db/repositories/llm-calls.ts';
import { sentencesRepo } from '../../db/repositories/sentences.ts';
import { CLOZE_GAP_TYPES } from '../../db/schema.ts';
import type { LlmDeps } from '../../llm/client.ts';
import { PROMPT_VERSION as CRITIC_VERSION } from '../../llm/prompts/cloze-critic.ts';
import { PROMPT_VERSION as DISTRACTORS_VERSION } from '../../llm/prompts/cloze-distractors.ts';
import type { BlocklistMatcher } from '../blocklist.ts';
import { buildFormIndex } from '../forms.ts';
import { seededShuffle } from '../random.ts';
import { type RunBudget, startBudget } from '../budget.ts';
import { type Candidate, type GapType, MAX_OFF_LIST, corpusWords, selectCandidates, sentenceCandidates } from './candidates.ts';
import { type CriticInput, runCritic } from './critic.ts';
import { fetchDistractors } from './distractors.ts';
import { checkRules, ruleReason } from './rules.ts';


export interface BuildOptions {
	/** Inclusive band range of the items (default 1-8). */
	bands?: [number, number];
	types?: readonly GapType[];
	limit: number;
	/** Default: the active provider (with fallback). */
	providerId?: number;
	/** Stop once this run has made this many HTTP attempts (llm_calls rows). */
	maxCalls: number;
	/** Refuse to start when the last 24 h already hold this many llm_calls rows. */
	dailyCap: number;
	/** A budget shared with other pipelines (prefetch); maxCalls and dailyCap are then ignored. */
	budget?: RunBudget;
}

export interface BuildDeps {
	/** The LLM dependencies; `llm.db` is the database and `llm.now` the clock. */
	llm: LlmDeps;
	isWord: (word: string) => boolean;
	blocklist: BlocklistMatcher;
}

type PerType = Record<GapType, number>;
const perType = (): PerType => Object.fromEntries(CLOZE_GAP_TYPES.map((t) => [t, 0])) as PerType;

export interface BuildSummary {
	/** New candidates in the requested bands and types (before --limit). */
	available: PerType;
	selected: PerType;
	ruleFailures: Record<string, number>;
	criticRejections: PerType;
	criticReasons: Record<string, number>;
	/** gap type -> band -> validated items stored by this run. */
	validated: Record<GapType, Record<number, number>>;
	stored: number;
	/** Not stored because an LLM call failed (schema, refusal, retries) or left the item out; a rerun retries them. */
	llmFailed: number;
	llmFailureReasons: Record<string, number>;
	/** Not attempted because --max-calls or the daily cap was reached. */
	notRun: number;
	budgetExhausted: boolean;
	llm: { calls: number; usage: UsageEntry[] };
}

const bump = (counts: Record<string, number>, key: string) => {
	counts[key] = (counts[key] ?? 0) + 1;
};

/** The option shuffle is seeded by the content hash, so an item's display order never changes. */
export const shuffleOptions = (options: readonly string[], contentHash: string) =>
	seededShuffle(options, `options|${contentHash}`);

export async function buildCloze(options: BuildOptions, deps: BuildDeps): Promise<BuildSummary> {
	const db = deps.llm.db;
	const now = deps.llm.now();
	const budget = options.budget ?? startBudget(db, now, options);
	const calls = llmCallsRepo(db);
	const baseline = calls.maxId();

	const summary: BuildSummary = {
		available: perType(),
		selected: perType(),
		ruleFailures: {},
		criticRejections: perType(),
		criticReasons: {},
		validated: Object.fromEntries(CLOZE_GAP_TYPES.map((t) => [t, {}])) as BuildSummary['validated'],
		stored: 0,
		llmFailed: 0,
		llmFailureReasons: {},
		notRun: 0,
		budgetExhausted: false,
		llm: { calls: 0, usage: [] }
	};

	// 1. Candidates (deterministic), minus those already stored.
	const forms = buildFormIndex(lexemesRepo(db).all());
	const sentences = sentencesRepo(db);
	const corpus = corpusWords(sentences.all().map((s) => s.enText));
	const candidateDeps = { forms, isWord: deps.isWord, attested: (w: string) => corpus.has(w) };
	const all = sentences
		.forCloze(MAX_OFF_LIST)
		.flatMap((s) => sentenceCandidates({ ...s, levelBand: s.levelBand ?? 1 }, candidateDeps));
	const items = clozeItemsRepo(db);
	const exclude = items.existingHashes(all.map((c) => c.contentHash));
	const select = (limit: number) => selectCandidates(all, { limit, bands: options.bands, types: options.types, exclude });
	for (const c of select(Infinity)) summary.available[c.gapType]++;
	const selected = select(options.limit);
	for (const c of selected) summary.selected[c.gapType]++;

	const topicIds = new Map(grammarTopicsRepo(db).all().map((t) => [t.code, t.id]));
	const store = (c: Candidate, fields: Pick<NewClozeItem, 'options' | 'ruleOk' | 'criticOk' | 'rejectionReason' | 'criticNotes' | 'answerVi' | 'promptVersion' | 'model'>) => {
		const validated = fields.ruleOk && fields.criticOk === true;
		const row = items.insert({
			sentenceId: c.sentenceId,
			gapType: c.gapType,
			tokenIndex: c.tokenIndex,
			answer: c.answer,
			lexemeId: c.lexemeId,
			grammarTopicId: c.topicCode === null ? null : (topicIds.get(c.topicCode) ?? null),
			levelBand: c.levelBand,
			validated,
			contentHash: c.contentHash,
			createdAt: now,
			...fields
		});
		if (row === undefined) return;
		summary.stored++;
		if (validated) summary.validated[c.gapType][c.levelBand] = (summary.validated[c.gapType][c.levelBand] ?? 0) + 1;
	};
	const llmFailed = (count: number, reason: string) => {
		summary.llmFailed += count;
		summary.llmFailureReasons[reason] = (summary.llmFailureReasons[reason] ?? 0) + count;
	};

	// 2. LLM distractors for lexical gaps.
	const lexical = selected.filter((c) => c.gapType === 'lexical');
	const distractors = await fetchDistractors(lexical, deps.llm, { budget, providerId: options.providerId });
	for (const f of distractors.failures) llmFailed(f.items.length, f.reason);
	if (distractors.missing.length > 0) llmFailed(distractors.missing.length, 'llm:missing_item');
	summary.notRun += distractors.notRun.length;

	// 3. Rules. Failures are stored (validated = false); passing items go to the critic.
	interface Draft {
		candidate: Candidate;
		options: string[];
		answerVi: string | null;
		models: string[];
		versions: string[];
	}
	const drafts: Draft[] = [];
	for (const c of selected) {
		let draft: Draft;
		if (c.gapType === 'lexical') {
			const d = distractors.results.get(c.contentHash);
			if (d === undefined) continue;
			draft = {
				candidate: c,
				options: shuffleOptions([c.answer, ...d.words], c.contentHash),
				answerVi: d.answerVi,
				models: [d.model],
				versions: [DISTRACTORS_VERSION]
			};
		} else {
			draft = { candidate: c, options: shuffleOptions(c.options ?? [], c.contentHash), answerVi: null, models: [], versions: [] };
		}
		const rules = checkRules({ ...c, options: draft.options }, { forms, isWord: deps.isWord, blocklist: deps.blocklist });
		if (rules.ok) {
			drafts.push(draft);
			continue;
		}
		bump(summary.ruleFailures, rules.code);
		store(c, {
			options: draft.options,
			ruleOk: false,
			criticOk: null,
			rejectionReason: ruleReason(rules),
			criticNotes: null,
			answerVi: draft.answerVi,
			promptVersion: draft.versions.join('+') || 'rules-only',
			model: draft.models.join('+') || null
		});
	}

	// 4. The blind critic; every judged item is stored as its batch completes.
	const byHash = new Map(drafts.map((d) => [d.candidate.contentHash, d]));
	const critic = await runCritic(
		drafts.map(
			(d): CriticInput => ({
				contentHash: d.candidate.contentHash,
				enText: d.candidate.enText,
				tokenIndex: d.candidate.tokenIndex,
				answer: d.candidate.answer,
				options: d.options
			})
		),
		deps.llm,
		{
			budget,
			providerId: options.providerId,
			onJudged: (input, judgement, model) => {
				const draft = byHash.get(input.contentHash)!;
				const c = draft.candidate;
				if (!judgement.ok) {
					summary.criticRejections[c.gapType]++;
					bump(summary.criticReasons, judgement.reason!.replace(/ \(.*\)$/, ''));
				}
				store(c, {
					options: draft.options,
					ruleOk: true,
					criticOk: judgement.ok,
					rejectionReason: judgement.reason,
					criticNotes: judgement.notes,
					answerVi: draft.answerVi,
					promptVersion: [...draft.versions, CRITIC_VERSION].join('+'),
					model: [...new Set([...draft.models, model])].join('+')
				});
			}
		}
	);
	for (const f of critic.failures) llmFailed(f.items.length, f.reason);
	if (critic.missing.length > 0) llmFailed(critic.missing.length, 'llm:missing_item');
	summary.notRun += critic.notRun.length;

	summary.budgetExhausted = summary.notRun > 0;
	summary.llm = { calls: calls.countAfterId(baseline), usage: calls.usageAfterId(baseline) };
	return summary;
}

/** The summary as printable lines. */
export function formatSummary(s: BuildSummary): string[] {
	const fmt = (r: Record<string, number>) =>
		Object.entries(r)
			.map(([k, v]) => `${k} ${v}`)
			.join(', ') || 'none';
	const lines = [
		`candidates available (new, in range): ${fmt(s.available)}`,
		`candidates selected: ${fmt(s.selected)}`,
		`rule failures: ${fmt(s.ruleFailures)}`,
		`critic rejections by type: ${fmt(s.criticRejections)}`,
		`critic rejections by reason: ${fmt(s.criticReasons)}`,
		'validated (type x band):'
	];
	for (const type of CLOZE_GAP_TYPES) {
		const bands = Object.entries(s.validated[type]).map(([b, n]) => `b${b} ${n}`);
		lines.push(`  ${type}: ${bands.join(', ') || '0'}`);
	}
	lines.push(`stored: ${s.stored}`);
	lines.push(`not stored (LLM failure, retried next run): ${s.llmFailed}${s.llmFailed > 0 ? ` (${fmt(s.llmFailureReasons)})` : ''}`);
	lines.push(`not attempted (call budget reached): ${s.notRun}`);
	const input = s.llm.usage.reduce((n, u) => n + u.inputTokens, 0);
	const output = s.llm.usage.reduce((n, u) => n + u.outputTokens, 0);
	lines.push(`LLM calls (HTTP attempts): ${s.llm.calls}; tokens: ${input} input + ${output} output`);
	for (const u of s.llm.usage) lines.push(`  provider ${u.providerId} ${u.model}: ${u.calls} calls, ${u.inputTokens} in, ${u.outputTokens} out`);
	return lines;
}
