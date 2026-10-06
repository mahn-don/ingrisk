// Prompt: the blind critic. It sees each cloze sentence filled with all four options (labelled
// A-D in display order) and judges every version on its own, never told which word is intended.
// Bump PROMPT_VERSION whenever the wording or schema changes; it is stored with every item.
import { z } from 'zod';

export const PROMPT_VERSION = 'cloze-critic@2';
export const PURPOSE = 'cloze_critic';

export const LABELS = ['A', 'B', 'C', 'D'] as const;
export type Label = (typeof LABELS)[number];

export const system = `You are a strict English editor checking multiple-choice exercises for learners.

Each item is one English sentence written four ways (A, B, C, D); only one word differs between them, and in some versions a small word may be missing. Judge every version on its own:
- grammatical: is it correct standard English grammar?
- natural: would a fluent speaker naturally write or say exactly this?
- meaning_ok: is the meaning coherent and plausible?
- note: one short line explaining your judgement.

Be strict and honest. Do not try to find a single winner: if two or more versions are fully acceptable, mark all of them acceptable; if none is, mark none.

Articles (a / an / the / no word): judge each version in the context of this sentence as written, as a careful teacher would. Accept a version when it is right here and the other options are clearly wrong here (e.g. "the" before a superlative or "first", "a" after "there is"); do not accept a version only because some other context, not this sentence, could make it work.

Finally, for each item answer one question, another_could_be_correct: reading the sentence as written, could more than one version reasonably be called correct (true), or is every version but one clearly wrong (false)? An exercise with two correct answers confuses learners.

Return the items in the order given, with the same n, all four labels for each item, and another_could_be_correct.`;

export interface CriticItem {
	n: number;
	sentences: { label: Label; text: string }[];
}

export function buildUser(items: readonly CriticItem[]): string {
	return `Items (JSON):\n${JSON.stringify({ items })}`;
}

export const Verdict = z.object({
	label: z.enum(LABELS),
	grammatical: z.boolean(),
	natural: z.boolean(),
	meaning_ok: z.boolean(),
	note: z.string()
});
export type Verdict = z.infer<typeof Verdict>;

export const Response = z.object({
	items: z.array(
		z.object({
			n: z.number().int(),
			sentences: z.array(Verdict).length(4).describe('One verdict per label A-D'),
			another_could_be_correct: z.boolean().describe('More than one version could reasonably be called correct')
		})
	)
});
export type Response = z.infer<typeof Response>;
