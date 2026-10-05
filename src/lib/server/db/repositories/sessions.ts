import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { sessions } from '../schema.ts';

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
		}
	};
}
