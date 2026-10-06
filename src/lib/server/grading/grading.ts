// Live grading services for Phase 9: writing feedback and translation checks. Never cached.
import type { FEEDBACK_MODES } from '../db/schema.ts';
import { type LlmDeps, defaultLlmDeps, generateStructured } from '../llm/client.ts';
import type { BaseFeedback, TranslationFeedback, WritingFeedback } from '../llm/prompts/feedback.ts';
import * as translationPrompt from '../llm/prompts/grade-translation.ts';
import * as writingPrompt from '../llm/prompts/grade-writing.ts';
import type { Usage } from '../llm/wire.ts';

export type FeedbackMode = (typeof FEEDBACK_MODES)[number];

/** What the UI shows: in indirect mode the corrected text is withheld, so the learner self-corrects. */
export type FeedbackDisplay<F extends BaseFeedback> = Omit<F, 'corrected_text'> & { corrected_text?: string };

export function toDisplay<F extends BaseFeedback>(feedback: F, mode: FeedbackMode): FeedbackDisplay<F> {
	if (mode === 'direct') return feedback;
	const { corrected_text: _hidden, ...rest } = feedback;
	return rest;
}

export interface Graded<F extends BaseFeedback> {
	/** Everything the model returned (after validation and the invented-error guard). */
	feedback: F;
	/** Errors dropped by the guard: their "original" is not in the learner's text, or changes nothing. */
	dropped: number;
	model: string;
	usage: Usage;
	promptVersion: string;
}

const norm = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/**
 * Drop errors that cannot be real: the quoted original is not in the learner's text, or the
 * correction equals it. The prompt forbids inventing errors; this catches the ones that slip through.
 */
export function guardErrors<F extends BaseFeedback>(feedback: F, learnerText: string): { feedback: F; dropped: number } {
	const text = norm(learnerText);
	const errors = feedback.errors.filter((e) => norm(e.original) !== '' && text.includes(norm(e.original)) && norm(e.original) !== norm(e.correction));
	return { feedback: { ...feedback, errors }, dropped: feedback.errors.length - errors.length };
}

export interface WritingRequest {
	prompt_vi: string;
	user_text: string;
	level_band: number;
	feedback_mode: FeedbackMode;
}

/** Grade learner writing with the active provider. Returns the full feedback and the UI shape. */
export async function gradeWriting(
	request: WritingRequest,
	deps: LlmDeps = defaultLlmDeps()
): Promise<Graded<WritingFeedback> & { display: FeedbackDisplay<WritingFeedback> }> {
	const result = await generateStructured(
		{
			purpose: writingPrompt.PURPOSE,
			system: writingPrompt.system,
			user: writingPrompt.buildUser(request),
			schema: writingPrompt.Response,
			maxTokens: 2000
		},
		deps
	);
	const { feedback, dropped } = guardErrors(result.data, request.user_text);
	return {
		feedback,
		display: toDisplay(feedback, request.feedback_mode),
		dropped,
		model: result.model,
		usage: result.usage,
		promptVersion: writingPrompt.PROMPT_VERSION
	};
}

export interface TranslationRequest {
	vi: string;
	reference_en: string;
	user_en: string;
	level_band: number;
}

/** Check a VI->EN translation with the active provider; the reference is one valid answer of many. */
export async function gradeTranslation(request: TranslationRequest, deps: LlmDeps = defaultLlmDeps()): Promise<Graded<TranslationFeedback>> {
	const result = await generateStructured(
		{
			purpose: translationPrompt.PURPOSE,
			system: translationPrompt.system,
			user: translationPrompt.buildUser(request),
			schema: translationPrompt.Response,
			maxTokens: 1500
		},
		deps
	);
	const { feedback, dropped } = guardErrors(result.data, request.user_en);
	return { feedback, dropped, model: result.model, usage: result.usage, promptVersion: translationPrompt.PROMPT_VERSION };
}
