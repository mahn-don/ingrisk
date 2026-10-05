import { eq, lte } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { authSessions } from '../schema.ts';

export type AuthSession = typeof authSessions.$inferSelect;

/** Login sessions, keyed by the SHA-256 of the cookie value (see auth/sessions.ts). */
export function authSessionsRepo(db: DbOrTx) {
	return {
		insert(row: AuthSession): void {
			db.insert(authSessions).values(row).run();
		},
		get(id: string): AuthSession | undefined {
			return db.select().from(authSessions).where(eq(authSessions.id, id)).get();
		},
		update(id: string, patch: Partial<Omit<AuthSession, 'id'>>): void {
			db.update(authSessions).set(patch).where(eq(authSessions.id, id)).run();
		},
		delete(id: string): void {
			db.delete(authSessions).where(eq(authSessions.id, id)).run();
		},
		/** Remove every session that expired at or before `now`; returns how many. */
		deleteExpired(now: Date): number {
			return db.delete(authSessions).where(lte(authSessions.expiresAt, now)).run().changes;
		}
	};
}
