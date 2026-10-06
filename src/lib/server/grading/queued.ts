// Grading the queued writing submissions: placement and session writings (and translations) whose
// live grading failed or timed out. Called by prefetch and, in the background, on Home. Grading
// mines the errors into cards (grading/apply.ts).
import { placementRepo } from '../db/repositories/placement.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import type { CallBudget } from '../generation/batch.ts';
import { startBudget } from '../generation/budget.ts';
import type { LlmDeps } from '../llm/client.ts';
import { LlmError } from '../llm/errors.ts';
import type { WritingSubmission } from '../db/repositories/writing.ts';
import type { BaseFeedback, TranslationFeedback, WritingFeedback } from '../llm/prompts/feedback.ts';
import { type GradedWriting, applyWritingGrade } from './apply.ts';
import { gradeTranslation, gradeWriting } from './grading.ts';

export const toGradedWriting = (feedback: BaseFeedback & Partial<WritingFeedback> & Partial<TranslationFeedback>): GradedWriting => ({
	cefr: feedback.cefr_estimate,
	correctedText: feedback.corrected_text,
	errors: feedback.errors,
	onTopic: feedback.on_topic ?? null,
	taskNoteVi: feedback.task_note_vi === undefined || feedback.task_note_vi === '' ? null : feedback.task_note_vi,
	meaningOk: feedback.meaning_ok ?? null
});

/** Grade one submission: a writing task, or a translation against its reference. */
export async function gradeSubmission(submission: WritingSubmission, levelBand: number, llm: LlmDeps): Promise<GradedWriting> {
	if (submission.taskKind === 'translation') {
		const graded = await gradeTranslation(
			{ vi: submission.prompt, reference_en: submission.referenceEn ?? '', user_en: submission.userText, level_band: levelBand },
			llm
		);
		return toGradedWriting(graded.feedback);
	}
	const graded = await gradeWriting({ prompt_vi: submission.prompt, user_text: submission.userText, level_band: levelBand, feedback_mode: 'direct' }, llm);
	return toGradedWriting(graded.feedback);
}

export interface QueuedGradingSummary {
	graded: number;
	/** Grading calls that failed (the submission stays queued for the next run). */
	failed: number;
	/** Still queued afterwards. */
	remaining: number;
}

/**
 * Grade queued submissions, oldest first, while the budget allows. The first LLM failure stops the
 * run (the provider is probably down; the rest would fail too). A graded placement writing refines
 * its result and, for the latest result, the profile.
 */
export async function gradeQueuedWritings(
	options: { maxCalls: number; budget?: CallBudget },
	deps: { llm: LlmDeps; dailyCap: number }
): Promise<QueuedGradingSummary> {
	const db = deps.llm.db;
	const writing = writingRepo(db);
	const placement = placementRepo(db);
	const summary: QueuedGradingSummary = { graded: 0, failed: 0, remaining: 0 };
	const queued = writing.queued();
	if (queued.length === 0) return summary;
	const budget = options.budget ?? startBudget(db, deps.llm.now(), { maxCalls: options.maxCalls, dailyCap: deps.dailyCap });
	for (const submission of queued) {
		if (!budget.canCall()) break;
		const level = placement.resultByWritingSubmission(submission.id)?.abilityBand ?? profileRepo(db).get().knownBandCeiling;
		try {
			const graded = await gradeSubmission(submission, level, deps.llm);
			if (applyWritingGrade(db, submission.id, graded, deps.llm.now())) summary.graded++;
		} catch (error) {
			if (!(error instanceof LlmError)) throw error;
			summary.failed++;
			break;
		}
	}
	summary.remaining = writing.queued().length;
	return summary;
}
