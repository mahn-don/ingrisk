// The WritingFeedback schema (docs/architecture.md Part II §5), shared by the grading prompts.
import { z } from 'zod';
import { CEFR_LEVELS, TOPIC_CODES } from '../../db/schema.ts';

export const MAX_ERRORS = 3;

export const FeedbackError = z
	.object({
		original: z.string(),
		correction: z.string(),
		topic_code: z.enum(TOPIC_CODES),
		explanation_vi: z.string()
	})
	.strict();

const Score = z.number().int().min(1).max(5);

export const WritingFeedback = z
	.object({
		corrected_text: z.string(),
		// Ranked by importance. The provider schema carries no size limit (Anthropic rejects one);
		// a longer list is cut to the 3 most important instead of failing a live grading call.
		errors: z
			.array(FeedbackError)
			.describe(`At most ${MAX_ERRORS} errors, most important first`)
			.transform((errors) => errors.slice(0, MAX_ERRORS)),
		cefr_estimate: z.enum(CEFR_LEVELS),
		scores: z.object({ range: Score, accuracy: Score, coherence: Score }).strict()
	})
	.strict();
export type WritingFeedback = z.output<typeof WritingFeedback>;

export const TranslationFeedback = WritingFeedback.extend({ meaning_ok: z.boolean() }).strict();
export type TranslationFeedback = z.output<typeof TranslationFeedback>;

export const TOPIC_CODE_GUIDE = `Error codes (use exactly one per error):
ART articles (a/an/the missing or wrong); TNS tense or aspect; PLU plural forms; SVA subject-verb agreement; COP missing or wrong "be"; PRE prepositions; COL collocation (wrong word partnership, e.g. "do a mistake"); WFM word form (e.g. "He is success"); WOR word order; OTH anything else (spelling, punctuation that changes meaning, missing words).`;

export const RUBRIC = `Scores, each an integer from 1 to 5: range (variety of words and structures), accuracy (grammar and word choice), coherence (ideas connected and easy to follow).
cefr_estimate: the CEFR level this text shows (A1 simple isolated phrases; A2 simple connected sentences on familiar topics; B1 straightforward connected text with some errors; B2 clear detailed text, good control; C1/C2 fluent, precise, almost no errors).`;

export const FEEDBACK_RULES = `Rules for errors:
- Report only real errors: grammar, word choice, word form, word order, or meaning. Never invent errors; never "correct" something that is already correct and natural, and never change British/American spelling or style preferences.
- A correct text gets an empty errors list and corrected_text identical to the learner's text.
- At most 3 errors, the most important first (errors that block understanding, then systematic grammar errors, then small slips).
- original: the exact words from the learner's text (copy them); correction: what they should be.
- explanation_vi: one or two short sentences in plain Vietnamese, suited to the learner's level, saying why it is wrong and the rule.
- corrected_text: the learner's text with all errors fixed (also those not listed), changing as little as possible.`;
