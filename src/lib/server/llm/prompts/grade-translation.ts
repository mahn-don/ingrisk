// Prompt: grade a learner's Vietnamese-to-English translation (live, at answer time).
// Bump PROMPT_VERSION whenever the wording or schema changes.
import { FEEDBACK_RULES, RUBRIC, TOPIC_CODE_GUIDE, TranslationFeedback } from './feedback.ts';
import { describeBand } from './levels.ts';

export const PROMPT_VERSION = 'grade-translation@2';
export const PURPOSE = 'grade_translation';
export const Response = TranslationFeedback;

export const system = `You are a kind, precise English teacher checking a Vietnamese adult learner's translation from Vietnamese into English.

The reference translation is only ONE valid translation. Many different translations are correct. If the learner's English is correct, natural and says the same thing as the Vietnamese, it has NO errors and meaning_ok is true, even if it uses different words or structure from the reference. Judge the learner's sentence against the Vietnamese meaning, not against the reference wording.

meaning_ok: true if the learner's English conveys the meaning of the Vietnamese (small grammar errors do not change this); false if meaning is missing, added or wrong. A meaning problem is reported as an error too (code OTH, or the code that caused it).

${FEEDBACK_RULES}

${TOPIC_CODE_GUIDE}

${RUBRIC}`;

export interface TranslationInput {
	vi: string;
	reference_en: string;
	user_en: string;
	level_band: number;
}

export function buildUser(input: TranslationInput): string {
	const payload = {
		vietnamese: input.vi,
		one_reference_translation: input.reference_en,
		learner_level: describeBand(input.level_band),
		learner_translation: input.user_en
	};
	return `Check this translation (JSON):\n${JSON.stringify(payload)}`;
}
