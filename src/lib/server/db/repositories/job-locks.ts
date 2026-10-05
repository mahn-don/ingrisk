import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { jobLocks } from '../schema.ts';

export type JobLock = typeof jobLocks.$inferSelect;

/** Single-run locks for background jobs. Callers hold the returned token and release with it. */
export function jobLocksRepo(db: DbOrTx) {
	return {
		/**
		 * Take the lock `name` for `holder` unless another run holds it and took it less than
		 * `staleMs` ago. Returns whether the lock was taken. Runs in one write transaction, so two
		 * concurrent callers cannot both succeed.
		 */
		acquire(name: string, holder: string, now: Date, staleMs: number): boolean {
			return db.transaction(
				(tx) => {
					const current = tx.select().from(jobLocks).where(eq(jobLocks.name, name)).get();
					if (current !== undefined && now.getTime() - current.acquiredAt.getTime() < staleMs) return false;
					tx.insert(jobLocks)
						.values({ name, holder, acquiredAt: now })
						.onConflictDoUpdate({ target: jobLocks.name, set: { holder, acquiredAt: now } })
						.run();
					return true;
				},
				{ behavior: 'immediate' }
			);
		},
		/** Release the lock if `holder` still holds it (a stale run never frees a newer run's lock). */
		release(name: string, holder: string): void {
			const current = db.select().from(jobLocks).where(eq(jobLocks.name, name)).get();
			if (current?.holder === holder) db.delete(jobLocks).where(eq(jobLocks.name, name)).run();
		},
		get(name: string): JobLock | undefined {
			return db.select().from(jobLocks).where(eq(jobLocks.name, name)).get();
		}
	};
}
