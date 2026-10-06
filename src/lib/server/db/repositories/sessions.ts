import { and, asc, desc, eq, gte, ne } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { type ServedItem, type ServedSession, type SessionSummary, sessions } from '../schema.ts';

export type SessionRow = typeof sessions.$inferSelect;
export type FinishedSession = Omit<typeof sessions.$inferInsert, 'id'>;

export function sessionsRepo(db: DbOrTx) {
	return {
		/**
		 * Record a finished session. Idempotent on client_session_id: a retried submission returns
		 * the row stored the first time, with `created: false`.
		 */
		recordFinished(payload: FinishedSession): { session: SessionRow; created: boolean } {
			return db.transaction((tx) => {
				const inserted = tx.insert(sessions).values(payload).onConflictDoNothing().returning().get();
				if (inserted !== undefined) return { session: inserted, created: true };
				const existing = tx
					.select()
					.from(sessions)
					.where(eq(sessions.clientSessionId, payload.clientSessionId))
					.get();
				if (existing === undefined) throw new Error('session insert conflicted but no row found');
				return { session: existing, created: false };
			});
		},
		byId(id: number): SessionRow | undefined {
			return db.select().from(sessions).where(eq(sessions.id, id)).get();
		},
		byClientSessionId(clientSessionId: string): SessionRow | undefined {
			return db.select().from(sessions).where(eq(sessions.clientSessionId, clientSessionId)).get();
		},
		inProgress(): SessionRow | undefined {
			return db.select().from(sessions).where(eq(sessions.status, 'in_progress')).get();
		},
		/** Abandon the session in progress, if any (its answers are lost). Returns how many. */
		abandonInProgress(at: Date): number {
			return db
				.update(sessions)
				.set({ status: 'abandoned', endedAt: at })
				.where(eq(sessions.status, 'in_progress'))
				.run().changes;
		},
		/** Start a session (in progress). `placeholderId` fills client_session_id until finish. */
		start(values: { startedAt: Date; budgetMin: number; shape: SessionRow['shape']; served: ServedItem[] | ServedSession; placeholderId: string }): SessionRow {
			return db
				.insert(sessions)
				.values({
					clientSessionId: values.placeholderId,
					startedAt: values.startedAt,
					budgetMin: values.budgetMin,
					shape: values.shape,
					status: 'in_progress',
					servedJson: values.served
				})
				.returning()
				.get();
		},
		markFinished(id: number, values: { clientSessionId: string; finishedAt: Date; itemsDone: number; summary: SessionSummary }): SessionRow {
			const row = db
				.update(sessions)
				.set({
					status: 'finished',
					clientSessionId: values.clientSessionId,
					finishedAt: values.finishedAt,
					endedAt: values.finishedAt,
					itemsDone: values.itemsDone,
					summaryJson: values.summary
				})
				.where(and(eq(sessions.id, id), eq(sessions.status, 'in_progress')))
				.returning()
				.get();
			if (row === undefined) throw new Error(`session ${id} is not in progress`);
			return row;
		},
		/** The most recent finished session that was not quick (Đọc/Viết rotation). */
		lastFinishedNonQuick(): SessionRow | undefined {
			return db
				.select()
				.from(sessions)
				.where(and(eq(sessions.status, 'finished'), ne(sessions.shape, 'quick')))
				.orderBy(desc(sessions.finishedAt), desc(sessions.id))
				.limit(1)
				.get();
		},
		/** The most recent finished Viết session (writing / translation alternation). */
		lastFinishedWrite(): SessionRow | undefined {
			return db
				.select()
				.from(sessions)
				.where(and(eq(sessions.status, 'finished'), eq(sessions.shape, 'write')))
				.orderBy(desc(sessions.finishedAt), desc(sessions.id))
				.limit(1)
				.get();
		},
		/** Sessions finished at or after `from`, oldest first. */
		finishedSince(from: Date): SessionRow[] {
			return db
				.select()
				.from(sessions)
				.where(and(eq(sessions.status, 'finished'), gte(sessions.finishedAt, from)))
				.orderBy(asc(sessions.finishedAt))
				.all();
		},
		/** Every finished session: when, how many items, how long (the progress history). */
		finishedHistory(): { finishedAt: Date; itemsDone: number; studyMs: number }[] {
			return db
				.select({ finishedAt: sessions.finishedAt, endedAt: sessions.endedAt, startedAt: sessions.startedAt, itemsDone: sessions.itemsDone, summary: sessions.summaryJson })
				.from(sessions)
				.where(eq(sessions.status, 'finished'))
				.orderBy(asc(sessions.id))
				.all()
				.map((r) => ({ finishedAt: r.finishedAt ?? r.endedAt ?? r.startedAt, itemsDone: r.itemsDone, studyMs: r.summary?.studyMs ?? 0 }));
		}
	};
}
