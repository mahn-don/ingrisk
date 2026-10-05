// Prompt: error-correction drills the corpus cannot provide by injection (COL, WFM, WOR).
// Bump PROMPT_VERSION whenever the wording or schema changes; it is stored with every item.
import { z } from 'zod';
import { describeBand } from './levels.ts';

export const PROMPT_VERSION = 'drill-generate@1';
export const PURPOSE = 'drill_generate';

export const LLM_CODES = ['COL', 'WFM', 'WOR'] as const;
export type LlmCode = (typeof LLM_CODES)[number];

const ERROR_TYPES: Record<LlmCode, string> = {
	COL: 'COL (collocation): a wrong word partnership typical of Vietnamese learners, e.g. "do a mistake" for "make a mistake", "strong rain" for "heavy rain", "open the light" for "turn on the light"',
	WFM: 'WFM (word form): the right word family in the wrong form, e.g. "He is success" for "He is successful", "I am very interesting in music" for "I am very interested in music"',
	WOR: 'WOR (word order): words in Vietnamese order, e.g. "the book red" for "the red book", "I like very much football" for "I like football very much"'
};

export const system = `You write error-correction exercises for a Vietnamese adult learning English.

Each exercise is one short English sentence (5-14 words) about everyday life that contains exactly ONE error of the requested type, typical of Vietnamese learners, plus:
- corrected: the same sentence with only that error fixed, everything else identical;
- original_span: the wrong words exactly as they appear in the sentence (1-3 words);
- corrected_span: what replaces them in the corrected sentence;
- explanation_vi: at most 2 short sentences in plain Vietnamese saying why it is wrong.

Rules: the corrected sentence must be natural, correct English; the sentence with the error must have no other mistake; vary the situations and the words; no names other than Tom, Mary, Lan or Minh; nothing violent, sexual or political.`;

export interface GenerateRequest {
	topic_code: LlmCode;
	level_band: number;
	count: number;
}

export function buildUser(request: GenerateRequest): string {
	const brief = {
		error_type: ERROR_TYPES[request.topic_code],
		level: describeBand(request.level_band),
		count: request.count
	};
	return `Write ${request.count} exercises. Brief (JSON):\n${JSON.stringify(brief)}`;
}

export const Response = z.object({
	items: z.array(
		z.object({
			sentence_with_error: z.string(),
			corrected: z.string(),
			original_span: z.string(),
			corrected_span: z.string(),
			explanation_vi: z.string()
		})
	)
});
export type Response = z.infer<typeof Response>;
