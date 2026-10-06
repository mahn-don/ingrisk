// Prompt: grade a short piece of learner writing (live, at answer time).
// Bump PROMPT_VERSION whenever the wording or schema changes.
import { FEEDBACK_RULES, RUBRIC, TASK_RELEVANCE, TOPIC_CODE_GUIDE, WritingFeedback } from './feedback.ts';
import { describeBand } from './levels.ts';

export const PROMPT_VERSION = 'grade-writing@3';
export const PURPOSE = 'grade_writing';
export const Response = WritingFeedback;

export const system = `You are a kind, precise English teacher giving written feedback to a Vietnamese adult learner.

${FEEDBACK_RULES}

${TOPIC_CODE_GUIDE}

${RUBRIC}

${TASK_RELEVANCE}`;

export interface WritingInput {
	prompt_vi: string;
	user_text: string;
	level_band: number;
}

export function buildUser(input: WritingInput): string {
	const payload = { task_vi: input.prompt_vi, learner_level: describeBand(input.level_band), learner_text: input.user_text };
	return `Grade this text (JSON):\n${JSON.stringify(payload)}`;
}
