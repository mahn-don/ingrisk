// The WritingFeedback schema (docs/architecture.md Part II §5), shared by the grading prompts.
import { z } from 'zod';
import { CEFR_LEVELS, TOPIC_CODES } from '../../db/schema.ts';

/** Errors shown to the learner per text (distinct error codes first: selectShownErrors). */
export const MAX_ERRORS = 3;
/** Errors kept from one grading: every one is mined into a card (a longer list is cut, not failed). */
export const MAX_RETURNED_ERRORS = 10;

export const FeedbackError = z
	.object({
		original: z.string(),
		correction: z.string(),
		topic_code: z.enum(TOPIC_CODES),
		explanation_vi: z.string()
	})
	.strict();

const Score = z.number().int().min(1).max(5);

/** What every grading returns (writing and translation alike). */
export const BaseFeedback = z
	.object({
		corrected_text: z.string(),
		// Every real error, one entry per occurrence, most important first. The provider schema carries
		// no size limit (Anthropic rejects one); a longer list is cut instead of failing a live grading.
		// All of them are mined; the learner sees 3 (selectShownErrors).
		errors: z
			.array(FeedbackError)
			.describe(`Every real error (at most ${MAX_RETURNED_ERRORS}), one entry per occurrence, most important first`)
			.transform((errors) => errors.slice(0, MAX_RETURNED_ERRORS)),
		cefr_estimate: z.enum(CEFR_LEVELS),
		scores: z.object({ range: Score, accuracy: Score, coherence: Score }).strict()
	})
	.strict();
export type BaseFeedback = z.output<typeof BaseFeedback>;

/** Writing adds task relevance (Phase 9b): an off-topic text keeps its CEFR out of every estimate. */
export const WritingFeedback = BaseFeedback.extend({
	on_topic: z.boolean().describe('Whether the text responds to the task'),
	task_note_vi: z.string().describe('If off topic: one short Vietnamese sentence saying what the task asked; else empty')
}).strict();
export type WritingFeedback = z.output<typeof WritingFeedback>;

export const TranslationFeedback = BaseFeedback.extend({ meaning_ok: z.boolean() }).strict();
export type TranslationFeedback = z.output<typeof TranslationFeedback>;

export const TOPIC_CODE_GUIDE = `Error codes (use exactly one per error):
ART articles (a/an/the missing or wrong); TNS tense or aspect; PLU plural forms; SVA subject-verb agreement; COP missing or wrong "be"; PRE prepositions; COL collocation (wrong word partnership, e.g. "do a mistake"); WFM word form (e.g. "He is success"); WOR word order; OTH anything else (spelling, punctuation that changes meaning, missing words).`;

export const RUBRIC = `Scores, each an integer from 1 to 5: range (variety of words and structures), accuracy (grammar and word choice), coherence (ideas connected and easy to follow).
cefr_estimate: the CEFR level this text shows (A1 simple isolated phrases; A2 simple connected sentences on familiar topics; B1 straightforward connected text with some errors; B2 clear detailed text, good control; C1/C2 fluent, precise, almost no errors).`;

export const FEEDBACK_RULES = `Rules for errors:
- Report only real errors: grammar, word choice, word form, word order, or meaning. Never invent errors; never "correct" something that is already correct and natural, and never change British/American spelling or style preferences.
- A correct text gets an empty errors list and corrected_text identical to the learner's text.
- List every real error, up to ${MAX_RETURNED_ERRORS}, one entry per occurrence, the most important first (errors that block understanding, then systematic grammar errors, then small slips). If the same kind of error happens twice (e.g. two subject-verb agreement slips), list both: the app groups them by code and shows the learner 3 errors of different codes first, so never leave out an error of another code to make room for a repeat.
- original: the exact words from the learner's text (copy them); correction: what they should be.
- explanation_vi: one or two short sentences in plain Vietnamese, suited to the learner's level, saying why it is wrong and the rule.
- corrected_text: the learner's text with all errors fixed (also those not listed), changing as little as possible.`;

export const TASK_RELEVANCE = `Task relevance:
- on_topic: true if the text responds to the task (task_vi), even briefly or imperfectly; false if it is about something else or ignores the task.
- task_note_vi: when on_topic is false, one short, kind Vietnamese sentence saying what the task asked for; when on_topic is true, an empty string.
- Grade the English itself (errors, cefr_estimate) the same way either way.`;

export interface ShownError<E extends { topic_code: string }> {
	error: E;
	/** How many returned errors share this code (2+: "lặp lại N lần" in the UI). */
	repeats: number;
}

/**
 * The errors shown to the learner: the first (most important) error of each distinct code in the
 * model's order, then, if fewer than `max` codes occurred, further errors in order. Each carries the
 * number of errors with its code. Mining uses the full list, not this one.
 */
export function selectShownErrors<E extends { topic_code: string }>(errors: readonly E[], max = MAX_ERRORS): ShownError<E>[] {
	const counts = new Map<string, number>();
	for (const e of errors) counts.set(e.topic_code, (counts.get(e.topic_code) ?? 0) + 1);
	const seen = new Set<string>();
	const firstOfCode = errors.filter((e) => !seen.has(e.topic_code) && seen.add(e.topic_code));
	const rest = errors.filter((e) => !firstOfCode.includes(e));
	return [...firstOfCode, ...rest].slice(0, max).map((error) => ({ error, repeats: counts.get(error.topic_code) ?? 1 }));
}
