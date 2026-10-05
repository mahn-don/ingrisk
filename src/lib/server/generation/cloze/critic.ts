// The blind critic: every option filled into the sentence, judged without knowing the answer.
// Prompt: llm/prompts/cloze-critic.ts. 10 items per call.
import { type LlmDeps, generateStructured } from '../../llm/client.ts';
import * as prompt from '../../llm/prompts/cloze-critic.ts';
import { fillGap, tokenize } from '../tokens.ts';
import { type BatchRun, type CallBudget, runBatches } from './batch.ts';

export interface CriticInput {
	contentHash: string;
	enText: string;
	tokenIndex: number;
	answer: string;
	/** In display order; labels A-D follow this order. */
	options: readonly string[];
}

export interface Judgement {
	ok: boolean;
	/** Labels the critic found grammatical, natural and meaningful. */
	acceptable: prompt.Label[];
	/** Null when accepted. */
	reason: string | null;
	/** The verdicts as JSON (stored as critic_notes). */
	notes: string;
}

/** The sentence once per option, labelled A-D in display order. */
export function criticSentences(input: CriticInput): prompt.CriticItem['sentences'] {
	const tokens = tokenize(input.enText);
	return input.options.map((option, i) => ({ label: prompt.LABELS[i], text: fillGap(input.enText, tokens, input.tokenIndex, option) }));
}

export const isAcceptable = (v: prompt.Verdict) => v.grammatical && v.natural && v.meaning_ok;

/**
 * Accept only if exactly one filled sentence is acceptable and it is the intended answer.
 * Returns null if the verdicts do not cover A-D exactly once (a malformed answer, not a judgement).
 */
export function judge(answerLabel: prompt.Label, verdicts: readonly prompt.Verdict[]): Judgement | null {
	const labels = verdicts.map((v) => v.label);
	if (labels.length !== 4 || prompt.LABELS.some((l) => !labels.includes(l))) return null;
	const acceptable = prompt.LABELS.filter((l) => isAcceptable(verdicts.find((v) => v.label === l)!));
	const notes = JSON.stringify([...verdicts].sort((a, b) => a.label.localeCompare(b.label)));
	let reason: string | null = null;
	if (acceptable.length === 0) reason = 'critic:none_acceptable';
	else if (acceptable.length > 1) reason = `critic:several_acceptable (${acceptable.join(', ')})`;
	else if (acceptable[0] !== answerLabel) reason = `critic:other_option_acceptable (${acceptable[0]}, answer ${answerLabel})`;
	return { ok: reason === null, acceptable, reason, notes };
}

export interface CriticRun extends BatchRun<CriticInput> {
	/** Items the model left out, or answered with a malformed set of labels. */
	missing: CriticInput[];
}

/** Judge items in batches; `onJudged` is called as each batch completes (so results can be stored). */
export async function runCritic(
	items: readonly CriticInput[],
	llm: LlmDeps,
	options: { budget: CallBudget; providerId?: number; onJudged: (item: CriticInput, judgement: Judgement, model: string) => void }
): Promise<CriticRun> {
	const missing: CriticInput[] = [];
	const run = await runBatches(
		items,
		async (batch) => {
			const response = await generateStructured(
				{
					purpose: prompt.PURPOSE,
					system: prompt.system,
					user: prompt.buildUser(batch.map((item, i) => ({ n: i + 1, sentences: criticSentences(item) }))),
					schema: prompt.Response,
					maxTokens: 4000,
					providerId: options.providerId,
					fallback: options.providerId === undefined
				},
				llm
			);
			const byN = new Map(response.data.items.map((item) => [item.n, item]));
			batch.forEach((item, i) => {
				const answerIndex = item.options.indexOf(item.answer);
				const verdicts = byN.get(i + 1)?.sentences;
				const judgement = verdicts === undefined || answerIndex < 0 ? null : judge(prompt.LABELS[answerIndex], verdicts);
				if (judgement === null) missing.push(item);
				else options.onJudged(item, judgement, response.model);
			});
		},
		options
	);
	return { ...run, missing };
}
