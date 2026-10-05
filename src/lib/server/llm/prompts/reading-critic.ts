// Prompt: the blind reading critic. It reads the passage and answers each question itself, never
// told the intended answer, and lists every option the passage supports. Up to 5 passages per call.
// Bump PROMPT_VERSION whenever the wording or schema changes; it is stored with every item.
import { z } from 'zod';

export const PROMPT_VERSION = 'reading-critic@1';
export const PURPOSE = 'reading_critic';

export const LABELS = ['A', 'B', 'C', 'D'] as const;
export type Label = (typeof LABELS)[number];

export const system = `You check reading-comprehension exercises for English learners.

Each item is a short passage and its multiple-choice questions (options A-D). For every question:
- chosen: the option you would pick, using only the passage;
- defensible: every option that the passage supports as a correct answer (normally exactly one; list two or more if the question is ambiguous, none if no option is supported).

Be strict: an option is defensible only if the passage clearly supports it. Return the items in the order given, with the same n, and one answer per question with the same q.`;

export interface CriticItem {
	n: number;
	passage: string;
	questions: { q: number; question: string; options: Record<Label, string> }[];
}

export function buildUser(items: readonly CriticItem[]): string {
	return `Items (JSON):\n${JSON.stringify({ items })}`;
}

export const Response = z.object({
	items: z.array(
		z.object({
			n: z.number().int(),
			answers: z.array(z.object({ q: z.number().int(), chosen: z.enum(LABELS), defensible: z.array(z.enum(LABELS)) }))
		})
	)
});
export type Response = z.infer<typeof Response>;
