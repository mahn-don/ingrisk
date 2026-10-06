// Prompt: one graded reading passage with 2 comprehension questions and a short glossary.
// Bump PROMPT_VERSION whenever the wording or schema changes; it is stored with every item.
import { z } from 'zod';
import { describeBand } from './levels.ts';

export const PROMPT_VERSION = 'reading-passage@2';
export const PURPOSE = 'reading_passage';

export const system = `You write graded reading passages for a Vietnamese adult learning English.

Write one short, natural, interesting text about the topic in the brief: a little story, a message, a blog post or a description of everyday life. Keep strictly to the level: short sentences, common words. allowed_words lists the content words of the level (any form of them is fine: plurals, past tenses); use them, small function words (a, the, in, and, he…) and the listed names only. At most 2 or 3 other words in the whole text, and put those in the glossary. At least 95% of the words must be allowed. Use only the names and places listed in the brief. Nothing violent, sexual or political.

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
	/** The band's content words (lemmas), most frequent first. */
	allowed_words: readonly string[];
}

export function buildUser(brief: PassageBrief): string {
	const payload = {
		level: describeBand(brief.level_band),
		level_band: brief.level_band,
		topic: brief.topic,
		word_range: [brief.min_words, brief.max_words],
		names_and_places: brief.names,
		allowed_words: brief.allowed_words.join(' ')
	};
	return `Brief (JSON):\n${JSON.stringify(payload)}`;
}

/**
 * The one retry after a coverage failure: the same brief, the passage, and the words above the
 * level, to be replaced by allowed words (or kept only if glossed, at most 2 or 3).
 */
export function buildRewriteUser(brief: PassageBrief, previous: Response, aboveLevel: readonly string[]): string {
	return `${buildUser(brief)}

Your passage used too many words above the level: ${aboveLevel.join(', ')}.
Rewrite it on the same topic, replacing those words with words from allowed_words (or simpler phrasing). Return the whole result again (title, passage, 2 questions, glossary) in the same format. Previous passage (JSON):
${JSON.stringify({ title_en: previous.title_en, passage_en: previous.passage_en })}`;
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
