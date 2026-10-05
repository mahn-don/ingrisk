// Prompt: three distractors per lexical cloze gap, plus a Vietnamese gloss of the answer.
// Bump PROMPT_VERSION whenever the wording or schema changes; it is stored with every item.
import { z } from 'zod';

export const PROMPT_VERSION = 'cloze-distractors@1';
export const PURPOSE = 'cloze_distractors';

export const system = `You write distractors for English multiple-choice gap-fill exercises. The learner is a Vietnamese speaker at CEFR A1-B2 level.

For every item you get an English sentence with one gap (___), the word that fills it (the answer) and a Vietnamese translation of the sentence.

For each item return:
- distractors: exactly 3 wrong options, each with why_wrong (one short English line saying why it does not fit this sentence).
- answer_vi: a short Vietnamese gloss (1-4 words) of the answer as it is used in this sentence.

Every distractor must be:
- one single English word, written in lowercase;
- the same part of speech and the same inflection as the answer (past tense for a past tense, plural for a plural, -ing for -ing);
- a common word of similar frequency to the answer, never rare, offensive or a proper noun;
- plausible at first sight, but clearly wrong in this sentence: the sentence with it must be wrong or make no sense;
- not a form of the answer's word, and not a synonym that would also fit.

Exactly one option (the answer) may fit the gap. Return the items in the order given, with the same n.`;

export interface DistractorItem {
	n: number;
	/** The English sentence with the gap shown as ___. */
	sentence: string;
	answer: string;
	/** The Vietnamese translation of the whole sentence. */
	vi: string;
}

export function buildUser(items: readonly DistractorItem[]): string {
	return `Items (JSON):\n${JSON.stringify({ items })}`;
}

export const Response = z.object({
	items: z.array(
		z.object({
			n: z.number().int(),
			distractors: z
				.array(z.object({ word: z.string(), why_wrong: z.string() }))
				.length(3)
				.describe('Exactly 3 distractors'),
			answer_vi: z.string()
		})
	)
});
export type Response = z.infer<typeof Response>;
