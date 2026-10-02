import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { type CEFR_LEVELS, type WritingError, writingSubmissions } from '../schema.ts';

export type WritingSubmission = typeof writingSubmissions.$inferSelect;
export type NewWritingSubmission = Pick<
	typeof writingSubmissions.$inferInsert,
	'sessionId' | 'prompt' | 'userText' | 'submittedAt'
>;

export interface WritingFeedback {
	correctedText: string;
	errors: WritingError[];
	cefrEstimate: (typeof CEFR_LEVELS)[number];
}

/** Writing submissions: queued on submit, scored later, feedback shown once. */
export function writingRepo(db: Db) {
	const setById = (id: number, values: Partial<WritingSubmission>) => {
		const row = db
			.update(writingSubmissions)
			.set(values)
			.where(eq(writingSubmissions.id, id))
			.returning()
			.get();
		if (row === undefined) throw new Error(`writing submission ${id} not found`);
		return row;
	};
	return {
		queue(submission: NewWritingSubmission): WritingSubmission {
			return db
				.insert(writingSubmissions)
				.values({ ...submission, status: 'queued' })
				.returning()
				.get();
		},
		/** Submissions waiting to be graded, oldest first. */
		queued(): WritingSubmission[] {
			return db
				.select()
				.from(writingSubmissions)
				.where(eq(writingSubmissions.status, 'queued'))
				.orderBy(asc(writingSubmissions.submittedAt), asc(writingSubmissions.id))
				.all();
		},
		markScored(id: number, feedback: WritingFeedback, now = new Date()): WritingSubmission {
			return setById(id, {
				status: 'scored',
				correctedText: feedback.correctedText,
				errorsJson: feedback.errors,
				cefrEstimate: feedback.cefrEstimate,
				scoredAt: now
			});
		},
		markFailed(id: number): WritingSubmission {
			return setById(id, { status: 'failed' });
		},
		/** Scored submissions whose feedback the learner has not seen yet, oldest first. */
		unseenFeedback(): WritingSubmission[] {
			return db
				.select()
				.from(writingSubmissions)
				.where(and(eq(writingSubmissions.status, 'scored'), isNull(writingSubmissions.feedbackSeenAt)))
				.orderBy(asc(writingSubmissions.scoredAt), asc(writingSubmissions.id))
				.all();
		},
		markSeen(id: number, now = new Date()): WritingSubmission {
			return setById(id, { feedbackSeenAt: now });
		}
	};
}
