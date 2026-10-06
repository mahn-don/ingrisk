// Graded writing feedback as the session shows it: unseen feedback at session start, and the
// anchor's own feedback when grading finishes in time.
import type { DbOrTx } from '../db/client.ts';
import { grammarTopicsRepo } from '../db/repositories/grammar-topics.ts';
import { placementRepo } from '../db/repositories/placement.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import { type WritingSubmission, writingRepo } from '../db/repositories/writing.ts';
import { selectShownErrors } from '../llm/prompts/feedback.ts';
import type { FeedbackCard, TopicCode } from '../../session/types.ts';

/** The card for a scored submission; the corrected text only in direct feedback mode. */
export function feedbackCard(db: DbOrTx, submission: WritingSubmission): FeedbackCard {
	const names = new Map(grammarTopicsRepo(db).all().map((t) => [t.code, t.nameVi]));
	const direct = settingsRepo(db).get().feedbackMode === 'direct';
	return {
		submissionId: submission.id,
		taskKind: submission.taskKind,
		placement: placementRepo(db).resultByWritingSubmission(submission.id) !== undefined,
		prompt: submission.prompt,
		userText: submission.userText,
		correctedText: direct ? submission.correctedText : null,
		// 3 errors, distinct codes first; all of them were mined.
		errors: selectShownErrors(submission.errorsJson ?? []).map(({ error: e, repeats }) => ({
			original: e.original,
			correction: e.correction,
			topicCode: e.topic_code as TopicCode,
			topicNameVi: names.get(e.topic_code) ?? e.topic_code,
			explanationVi: e.explanation_vi,
			repeats
		})),
		totalErrors: submission.errorsJson?.length ?? 0,
		cefr: submission.cefrEstimate,
		onTopic: submission.onTopic,
		taskNoteVi: submission.taskNoteVi,
		meaningOk: submission.meaningOk,
		referenceEn: submission.referenceEn,
		mined: submission.minedCount
	};
}

/** Scored submissions whose feedback the learner has not seen (placement ones included). */
export const unseenFeedbackCards = (db: DbOrTx): FeedbackCard[] => writingRepo(db).unseenFeedback().map((s) => feedbackCard(db, s));
