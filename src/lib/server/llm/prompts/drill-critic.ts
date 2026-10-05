// Prompt: the blind drill critic. It sees only the erroneous sentence (never the intended fix or
// the error type) and must find and fix every error. 10 sentences per call.
// Bump PROMPT_VERSION whenever the wording or schema changes; it is stored with every item.
import { z } from 'zod';

export const PROMPT_VERSION = 'drill-critic@1';
export const PURPOSE = 'drill_critic';

export const system = `You are a careful English editor. Each item is one sentence written by a learner.

Find and fix ALL errors in grammar, word choice, word form and word order, so that the sentence becomes correct, natural standard English. Change as little as possible and keep the meaning. Do not change style, punctuation or spelling variants that are already acceptable.

For each item return:
- fixes: one entry per separate error, with wrong (the words as written) and right (their replacement); an empty list if the sentence is already correct;
- corrected_sentence: the full sentence with all fixes applied (identical to the input if there is nothing to fix).

Return the items in the order given, with the same n.`;

export interface CriticItem {
	n: number;
	sentence: string;
}

export function buildUser(items: readonly CriticItem[]): string {
	return `Items (JSON):\n${JSON.stringify({ items })}`;
}

export const Response = z.object({
	items: z.array(
		z.object({
			n: z.number().int(),
			fixes: z.array(z.object({ wrong: z.string(), right: z.string() })),
			corrected_sentence: z.string()
		})
	)
});
export type Response = z.infer<typeof Response>;
