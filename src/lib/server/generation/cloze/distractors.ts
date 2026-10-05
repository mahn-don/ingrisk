// LLM distractors for lexical gaps, 10 items per call (prompt: llm/prompts/cloze-distractors.ts).
import { type LlmDeps, generateStructured } from '../../llm/client.ts';
import * as prompt from '../../llm/prompts/cloze-distractors.ts';
import { capitalize, tokenize, withGap } from '../tokens.ts';
import { type BatchRun, type CallBudget, runBatches } from '../batch.ts';
import type { Candidate } from './candidates.ts';

export interface Distractors {
	/** Three words, capitalized when the gap is sentence-initial. */
	words: string[];
	reasons: string[];
	answerVi: string;
	model: string;
}

export interface DistractorRun extends BatchRun<Candidate> {
	/** By candidate content hash. */
	results: Map<string, Distractors>;
	/** Items the model left out of its answer, by content hash. */
	missing: Candidate[];
}

export function distractorItem(c: Candidate, n: number): prompt.DistractorItem {
	return { n, sentence: withGap(c.enText, tokenize(c.enText), c.tokenIndex), answer: c.answer, vi: c.viText };
}

export async function fetchDistractors(
	candidates: readonly Candidate[],
	llm: LlmDeps,
	options: { budget: CallBudget; providerId?: number }
): Promise<DistractorRun> {
	const results = new Map<string, Distractors>();
	const missing: Candidate[] = [];
	const run = await runBatches(
		candidates,
		async (batch) => {
			const response = await generateStructured(
				{
					purpose: prompt.PURPOSE,
					system: prompt.system,
					user: prompt.buildUser(batch.map((c, i) => distractorItem(c, i + 1))),
					schema: prompt.Response,
					maxTokens: 3000,
					providerId: options.providerId,
					fallback: options.providerId === undefined
				},
				llm
			);
			const byN = new Map(response.data.items.map((item) => [item.n, item]));
			batch.forEach((c, i) => {
				const item = byN.get(i + 1);
				if (item === undefined) {
					missing.push(c);
					return;
				}
				results.set(c.contentHash, {
					words: item.distractors.map((d) => (c.initial ? capitalize(d.word.trim()) : d.word.trim())),
					reasons: item.distractors.map((d) => d.why_wrong),
					answerVi: item.answer_vi.trim(),
					model: response.model
				});
			});
		},
		options
	);
	return { ...run, results, missing };
}
