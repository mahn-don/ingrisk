// The blind drill critic: it sees only the erroneous sentence and must find and fix all errors.
import { type LlmDeps, generateStructured } from '../../llm/client.ts';
import * as prompt from '../../llm/prompts/drill-critic.ts';
import { type BatchRun, type CallBudget, runBatches } from '../batch.ts';

/** Case, quotes, spacing and spacing before punctuation do not count as a difference. */
export function normalizeSentence(text: string): string {
	return text
		.normalize('NFKC')
		.replace(/[‘’`]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/\s+/g, ' ')
		.replace(/\s+([.,!?;:])/g, '$1')
		.trim()
		.toLowerCase();
}

export interface DrillJudgement {
	ok: boolean;
	/** Null when accepted. */
	reason: string | null;
	/** The critic's answer, as JSON (kept in validation_notes). */
	notes: string;
}

/** Accept only if the critic found exactly one fix and its corrected sentence is ours. */
export function judgeDrill(answer: { fixes: { wrong: string; right: string }[]; corrected_sentence: string }, corrected: string): DrillJudgement {
	let reason: string | null = null;
	if (answer.fixes.length === 0) reason = 'critic:no_error_found';
	else if (answer.fixes.length > 1) reason = `critic:several_errors (${answer.fixes.length})`;
	else if (normalizeSentence(answer.corrected_sentence) !== normalizeSentence(corrected)) {
		reason = `critic:different_fix (${answer.fixes[0].wrong} -> ${answer.fixes[0].right})`;
	}
	return { ok: reason === null, reason, notes: JSON.stringify({ reason, critic: answer }) };
}

export interface DrillCriticInput {
	key: string;
	sentenceWithError: string;
	corrected: string;
}

export interface DrillCriticRun extends BatchRun<DrillCriticInput> {
	missing: DrillCriticInput[];
}

export async function runDrillCritic(
	items: readonly DrillCriticInput[],
	llm: LlmDeps,
	options: { budget: CallBudget; providerId?: number; onJudged: (item: DrillCriticInput, judgement: DrillJudgement, model: string) => void }
): Promise<DrillCriticRun> {
	const missing: DrillCriticInput[] = [];
	const run = await runBatches(
		items,
		async (batch) => {
			const response = await generateStructured(
				{
					purpose: prompt.PURPOSE,
					system: prompt.system,
					user: prompt.buildUser(batch.map((item, i) => ({ n: i + 1, sentence: item.sentenceWithError }))),
					schema: prompt.Response,
					maxTokens: 3000,
					providerId: options.providerId,
					fallback: options.providerId === undefined
				},
				llm
			);
			const byN = new Map(response.data.items.map((item) => [item.n, item]));
			batch.forEach((item, i) => {
				const answer = byN.get(i + 1);
				if (answer === undefined) missing.push(item);
				else options.onJudged(item, judgeDrill(answer, item.corrected), response.model);
			});
		},
		options
	);
	return { ...run, missing };
}
