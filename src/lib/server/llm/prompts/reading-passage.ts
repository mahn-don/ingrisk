// Prompt: one graded reading passage with 2 comprehension questions and a short glossary.
// Bump PROMPT_VERSION whenever the wording or schema changes; it is stored with every item.
import { z } from 'zod';
import { describeBand } from './levels.ts';

export const PROMPT_VERSION = 'reading-passage@1';
export const PURPOSE = 'reading_passage';

export const system = `You write graded reading passages for a Vietnamese adult learning English.

Write one short, natural, interesting text about the topic in the brief: a little story, a message, a blog post or a description of everyday life. Keep strictly to the level: short sentences, common words; at most a few words above the level, and put those in the glossary. Use only the names and places listed in the brief. Nothing violent, sexual or political.

Return:
- title_en: a short title;
- passage_en: the text, with the number of words inside the given range;
- questions: exactly 2 comprehension questions, each with 4 options, answer_index (0-3) of the only correct option, and explanation_vi: one short Vietnamese sentence saying where the passage gives the answer. Each question must be answerable from the passage alone, with exactly one defensible option; wrong options must be clearly wrong according to the passage;
- glossary: up to 5 words from the passage that are above the level, each with a short Vietnamese gloss (vi); the word exactly as it appears in the passage.`;

export interface PassageBrief {
	level_band: number;
	topic: string;
	min_words: number;
	max_words: number;
	names: readonly string[];
}

export function buildUser(brief: PassageBrief): string {
	const payload = {
		level: describeBand(brief.level_band),
		level_band: brief.level_band,
		topic: brief.topic,
		word_range: [brief.min_words, brief.max_words],
		names_and_places: brief.names
	};
	return `Brief (JSON):\n${JSON.stringify(payload)}`;
}

export const Question = z.object({
	question_en: z.string(),
	options: z.array(z.string()).length(4).describe('Exactly 4 options'),
	answer_index: z.number().int().min(0).max(3),
	explanation_vi: z.string()
});

export const Response = z.object({
	title_en: z.string(),
	passage_en: z.string(),
	questions: z.array(Question).length(2).describe('Exactly 2 questions'),
	glossary: z.array(z.object({ word: z.string(), vi: z.string() })).max(5).describe('At most 5 entries')
});
export type Response = z.infer<typeof Response>;
