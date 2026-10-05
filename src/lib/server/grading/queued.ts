// Grading the queued writing submissions: placement writings whose live grading failed or timed
// out (and, from Phase 9, session writings). Called by prefetch and, in the background, on Home.
import { placementRepo } from '../db/repositories/placement.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import type { CallBudget } from '../generation/batch.ts';
import { startBudget } from '../generation/budget.ts';
import type { LlmDeps } from '../llm/client.ts';
import { LlmError } from '../llm/errors.ts';
import type { WritingFeedback } from '../llm/prompts/feedback.ts';
import { type GradedWriting, applyWritingGrade } from '../placement/results.ts';
import { gradeWriting } from './grading.ts';

export const toGradedWriting = (feedback: WritingFeedback): GradedWriting => ({
	cefr: feedback.cefr_estimate,
	correctedText: feedback.corrected_text,
	errors: feedback.errors
});

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
			const graded = await gradeWriting(
				{ prompt_vi: submission.prompt, user_text: submission.userText, level_band: level, feedback_mode: 'direct' },
				deps.llm
			);
			if (applyWritingGrade(db, submission.id, toGradedWriting(graded.feedback), deps.llm.now())) summary.graded++;
		} catch (error) {
			if (!(error instanceof LlmError)) throw error;
			summary.failed++;
			break;
		}
	}
	summary.remaining = writing.queued().length;
	return summary;
}
