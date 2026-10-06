// Storing a grade, wherever it came from (live in a session or the placement, or a queued
// submission graded later): mark it scored, refine its placement result, mine its errors.
import type { DbOrTx } from '../db/client.ts';
import { placementRepo } from '../db/repositories/placement.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import { type GradedWriting, applyResultToProfile, offTopicResult, refineResult } from '../placement/results.ts';
import { mineErrors } from '../session/mining.ts';

export type { GradedWriting };

/**
 * Store a grade for a queued submission. A placement writing refines its result (and the profile
 * when it is the latest), unless it was off topic: then its CEFR is not used anywhere. Every
 * graded error is mined into a card. Returns false if the submission was not queued (graded
 * already, e.g. by a parallel run).
 */
export function applyWritingGrade(db: DbOrTx, profileId: number, submissionId: number, graded: GradedWriting, now: Date): boolean {
	return db.transaction((tx) => {
		const writing = writingRepo(tx, profileId);
		const submission = writing.byId(submissionId);
		if (submission?.status !== 'queued') return false;
		writing.markScored(
			submissionId,
			{
				correctedText: graded.correctedText,
				errors: graded.errors,
				cefrEstimate: graded.cefr,
				onTopic: graded.onTopic,
				taskNoteVi: graded.taskNoteVi,
				meaningOk: graded.meaningOk
			},
			now
		);
		const placement = placementRepo(tx, profileId);
		const result = placement.resultByWritingSubmission(submissionId);
		if (result !== undefined) {
			const refined = graded.onTopic === false ? offTopicResult(result) : refineResult(result, graded.cefr);
			applyResultToProfile(tx, profileId, placement.updateResult(result.id, refined), now);
		}
		if (graded.errors.length > 0) {
			const mined = mineErrors(
				tx,
				profileId,
				{ correctedText: graded.correctedText, errors: graded.errors, viText: submission.prompt, levelBand: profileRepo(tx, profileId).get().knownBandCeiling },
				now
			);
			writing.markMined(submissionId, mined.created, now);
		}
		return true;
	});
}
