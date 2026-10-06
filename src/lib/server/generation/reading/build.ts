// Graded reading passages (kind 'reading' in generated_cache): one passage per LLM call (the
// band's allowed words in the prompt), rules (length, coverage, glossary, options, blocklist) with
// one rewrite when only coverage fails, then the blind critic. See plans/phase-05b.md, phase-11.md.
import { cacheRepo } from '../../db/repositories/cache.ts';
import { type LlmDeps, generateStructured } from '../../llm/client.ts';
import * as criticPrompt from '../../llm/prompts/reading-critic.ts';
import * as passagePrompt from '../../llm/prompts/reading-passage.ts';
import { type CallBudget, runBatches } from '../batch.ts';
import type { BlocklistMatcher } from '../blocklist.ts';
import type { FormIndex } from '../forms.ts';
import { hashString, seededShuffle, sha256 } from '../random.ts';
import { type GenSummary, countAdded, countIn, emptySummary, paramsHash, reasonCode } from '../summary.ts';
import { allowedWords, coverage, STOCK_NAMES, wordCount } from './coverage.ts';
import { judgeReading } from './critic.ts';
import { checkPassage, readingRuleReason, wordRange } from './rules.ts';
import { TOPICS } from './topics.ts';

export const READING_STOCK_KEY = 'reading';
/** Passages judged per critic call (they are long). */
const CRITIC_BATCH = 5;

export interface ReadingPayload extends passagePrompt.Response {
	topic: string;
	word_count: number;
	coverage: number;
}

export interface ReadingRequest {
	band: number;
	count: number;
}

export interface ReadingDeps {
	llm: LlmDeps;
	forms: FormIndex;
	blocklist: BlocklistMatcher;
}

export const readingParamsHash = (topic: string) => paramsHash('reading', { topic });

/** `count` topics for a band: the least used so far first, ties broken by a stable seed. */
export function pickTopics(band: number, count: number, used: ReadonlyMap<string, number>): string[] {
	const ordered = seededShuffle(
		TOPICS.map((t) => t.id),
		`topics|${band}`
	).sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0));
	return Array.from({ length: count }, (_, i) => ordered[i % ordered.length]);
}

/** Options shuffled by a seed from the passage, so the answer is not always where the model put it. */
function shuffleQuestions(passage: passagePrompt.Response, seed: string): passagePrompt.Response {
	const questions = passage.questions.map((q, i) => {
		const order = seededShuffle([0, 1, 2, 3], `reading|${seed}|${i}`);
		return { ...q, options: order.map((k) => q.options[k]), answer_index: order.indexOf(q.answer_index) };
	});
	return { ...passage, questions };
}

interface Draft {
	payload: ReadingPayload;
	band: number;
	hash: string;
	model: string;
}

export async function buildReading(
	requests: readonly ReadingRequest[],
	deps: ReadingDeps,
	options: { budget: CallBudget; providerId?: number }
): Promise<GenSummary> {
	const summary = emptySummary();
	const cache = cacheRepo(deps.llm.db);
	const now = deps.llm.now();
	const llmFailed = (n: number, reason: string) => countIn(summary.llmFailed, reason, n);

	// Topic usage per band (every validated passage ever made), so a band cycles through topics.
	const hashToTopic = new Map(TOPICS.map((t) => [readingParamsHash(t.id), t.id]));
	const usedByBand = new Map<number, Map<string, number>>();
	for (const row of cache.countByParams('reading', { includeServed: true })) {
		const topic = hashToTopic.get(row.paramsHash);
		if (topic === undefined) continue;
		const used = usedByBand.get(row.levelBand) ?? new Map<string, number>();
		used.set(topic, (used.get(topic) ?? 0) + row.n);
		usedByBand.set(row.levelBand, used);
	}
	const jobs = requests.flatMap((r) => pickTopics(r.band, r.count, usedByBand.get(r.band) ?? new Map()).map((topic) => ({ band: r.band, topic })));

	const store = (draft: Draft, validated: boolean, notes: string, versions: string[]) => {
		const row = cache.insert({
			kind: 'reading',
			paramsHash: readingParamsHash(draft.payload.topic),
			contentHash: draft.hash,
			levelBand: draft.band,
			payloadJson: draft.payload,
			model: draft.model,
			promptVersion: versions.join('+'),
			createdAt: now,
			validated,
			validationNotes: notes
		});
		if (row !== undefined && validated) countAdded(summary, READING_STOCK_KEY, draft.band);
	};

	// 1. One passage per call; 2. rules right away.
	const drafts: Draft[] = [];
	const generated = await runBatches(
		jobs,
		async ([job]) => {
			const [min, max] = wordRange(job.band);
			const topic = TOPICS.find((t) => t.id === job.topic)!;
			const brief = { level_band: job.band, topic: topic.en, min_words: min, max_words: max, names: [...STOCK_NAMES], allowed_words: allowedWords(job.band, deps.forms) };
			const call = (user: string) =>
				generateStructured(
					{
						purpose: passagePrompt.PURPOSE,
						system: passagePrompt.system,
						user,
						schema: passagePrompt.Response,
						maxTokens: 2500,
						providerId: options.providerId,
						fallback: options.providerId === undefined
					},
					deps.llm
				);
			let response = await call(passagePrompt.buildUser(brief));
			let rules = checkPassage(response.data, job.band, deps);
			// Coverage alone failed: send the words above the level back once, then judge the rewrite.
			if (!rules.ok && rules.code === 'coverage') {
				const above = coverage(response.data.passage_en, job.band, deps.forms).uncovered;
				countIn(summary.rejected, 'reading:coverage_retry');
				response = await call(passagePrompt.buildRewriteUser(brief, response.data, above));
				rules = checkPassage(response.data, job.band, deps);
			}
			const hash = sha256(`reading|${response.data.passage_en.replace(/\s+/g, ' ').trim()}`);
			if (cache.existingHashes([hash]).size > 0) return;
			const passage = shuffleQuestions(response.data, String(hashString(hash)));
			const payload: ReadingPayload = {
				...passage,
				topic: job.topic,
				word_count: wordCount(passage.passage_en),
				coverage: Number(coverage(passage.passage_en, job.band, deps.forms).ratio.toFixed(3))
			};
			const draft: Draft = { payload, band: job.band, hash, model: response.model };
			if (rules.ok) drafts.push(draft);
			else {
				const reason = readingRuleReason(rules);
				countIn(summary.rejected, reasonCode(reason));
				store(draft, false, JSON.stringify({ reason }), [passagePrompt.PROMPT_VERSION]);
			}
		},
		{ budget: options.budget, size: 1 }
	);
	for (const f of generated.failures) llmFailed(f.items.length, f.reason);
	summary.notRun += generated.notRun.length;

	// 3. The blind critic answers the questions without the key.
	const judged = await runBatches(
		drafts,
		async (batch) => {
			const response = await generateStructured(
				{
					purpose: criticPrompt.PURPOSE,
					system: criticPrompt.system,
					user: criticPrompt.buildUser(
						batch.map((d, i) => ({
							n: i + 1,
							passage: d.payload.passage_en,
							questions: d.payload.questions.map((q, k) => ({
								q: k + 1,
								question: q.question_en,
								options: Object.fromEntries(criticPrompt.LABELS.map((l, j) => [l, q.options[j]])) as Record<criticPrompt.Label, string>
							}))
						}))
					),
					schema: criticPrompt.Response,
					maxTokens: 1500,
					providerId: options.providerId,
					fallback: options.providerId === undefined
				},
				deps.llm
			);
			const byN = new Map(response.data.items.map((item) => [item.n, item.answers]));
			batch.forEach((draft, i) => {
				const answers = byN.get(i + 1);
				if (answers === undefined) return llmFailed(1, 'llm:missing_item');
				const judgement = judgeReading(
					draft.payload.questions.map((q) => q.answer_index),
					answers
				);
				if (!judgement.ok) countIn(summary.rejected, reasonCode(judgement.reason!));
				const model = draft.model === response.model ? draft.model : `${draft.model}+${response.model}`;
				store({ ...draft, model }, judgement.ok, judgement.notes, [passagePrompt.PROMPT_VERSION, criticPrompt.PROMPT_VERSION]);
			});
		},
		{ budget: options.budget, size: CRITIC_BATCH }
	);
	for (const f of judged.failures) llmFailed(f.items.length, f.reason);
	summary.notRun += judged.notRun.length;
	return summary;
}
