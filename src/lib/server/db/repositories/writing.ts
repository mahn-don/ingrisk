import { and, asc, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { type CEFR_LEVELS, type WritingError, writingSubmissions } from '../schema.ts';

export type WritingSubmission = typeof writingSubmissions.$inferSelect;
export type NewWritingSubmission = Pick<typeof writingSubmissions.$inferInsert, 'sessionId' | 'prompt' | 'userText' | 'submittedAt'> &
	Partial<Pick<typeof writingSubmissions.$inferInsert, 'taskKind' | 'promptId' | 'sentenceId' | 'referenceEn'>>;

export interface WritingFeedback {
	correctedText: string;
	errors: WritingError[];
	cefrEstimate: (typeof CEFR_LEVELS)[number];
	/** Writing: answered the task (null: not judged, e.g. translation). */
	onTopic?: boolean | null;
	taskNoteVi?: string | null;
	/** Translation: the meaning came across. */
	meaningOk?: boolean | null;
}

/**
 * Every profile's queued submissions, oldest first: only for the background grader (cron, CLI),
 * which then works on each through writingRepo(db, submission.profileId).
 */
export function queuedWritingsAllProfiles(db: DbOrTx): WritingSubmission[] {
	return db
		.select()
		.from(writingSubmissions)
		.where(eq(writingSubmissions.status, 'queued'))
		.orderBy(asc(writingSubmissions.submittedAt), asc(writingSubmissions.id))
		.all();
}

/** One learner's writing submissions (Phase 12): queued on submit, scored later, feedback shown once. */
export function writingRepo(db: DbOrTx, profileId: number) {
	const mine = eq(writingSubmissions.profileId, profileId);
	const setById = (id: number, values: Partial<WritingSubmission>) => {
		const row = db
			.update(writingSubmissions)
			.set(values)
			.where(and(mine, eq(writingSubmissions.id, id)))
			.returning()
			.get();
		if (row === undefined) throw new Error(`writing submission ${id} not found`);
		return row;
	};
	return {
		queue(submission: NewWritingSubmission): WritingSubmission {
			return db
				.insert(writingSubmissions)
				.values({ ...submission, profileId, status: 'queued' })
				.returning()
				.get();
		},
		byId(id: number): WritingSubmission | undefined {
			return db.select().from(writingSubmissions).where(and(mine, eq(writingSubmissions.id, id))).get();
		},
		/** Submissions waiting to be graded, oldest first. */
		queued(): WritingSubmission[] {
			return db
				.select()
				.from(writingSubmissions)
				.where(and(mine, eq(writingSubmissions.status, 'queued')))
				.orderBy(asc(writingSubmissions.submittedAt), asc(writingSubmissions.id))
				.all();
		},
		markScored(id: number, feedback: WritingFeedback, now = new Date()): WritingSubmission {
			return setById(id, {
				status: 'scored',
				correctedText: feedback.correctedText,
				errorsJson: feedback.errors,
				cefrEstimate: feedback.cefrEstimate,
				onTopic: feedback.onTopic ?? null,
				taskNoteVi: feedback.taskNoteVi ?? null,
				meaningOk: feedback.meaningOk ?? null,
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
				.where(and(mine, eq(writingSubmissions.status, 'scored'), isNull(writingSubmissions.feedbackSeenAt)))
				.orderBy(asc(writingSubmissions.scoredAt), asc(writingSubmissions.id))
				.all();
		},
		markSeen(id: number, now = new Date()): WritingSubmission {
			return setById(id, { feedbackSeenAt: now });
		},
		markMined(id: number, count: number, now: Date): WritingSubmission {
			return setById(id, { minedAt: now, minedCount: count });
		},
		/** The submission of a session's writing anchor, if any. */
		forSession(sessionId: number): WritingSubmission | undefined {
			return db.select().from(writingSubmissions).where(and(mine, eq(writingSubmissions.sessionId, sessionId))).get();
		},
		/** Scored since `since` (the weakness profile reads their errors). */
		scoredSince(since: Date): WritingSubmission[] {
			return db
				.select()
				.from(writingSubmissions)
				.where(and(mine, eq(writingSubmissions.status, 'scored'), gte(writingSubmissions.scoredAt, since)))
				.all();
		},
		/** Source sentences already given as translation tasks (never served twice). */
		translationSentenceIds(): number[] {
			return db
				.select({ id: writingSubmissions.sentenceId })
				.from(writingSubmissions)
				.where(and(mine, isNotNull(writingSubmissions.sentenceId)))
				.all()
				.map((r) => r.id!);
		},
		/** Writing prompts used since `since` (not repeated within 14 days). */
		promptIdsSince(since: Date): Set<string> {
			const rows = db
				.select({ id: writingSubmissions.promptId })
				.from(writingSubmissions)
				.where(and(mine, isNotNull(writingSubmissions.promptId), gte(writingSubmissions.submittedAt, since)))
				.all();
			return new Set(rows.map((r) => r.id!));
		}
	};
}
