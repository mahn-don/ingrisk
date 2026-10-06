// Server-side login sessions. The cookie holds a random 32-byte token (base64url); the database
// stores only sha256(token). Sessions last 30 days and slide forward on use, at most once an hour.
import { createHash, randomBytes } from 'node:crypto';
import type { DbOrTx } from '../db/client.ts';
import { authSessionsRepo } from '../db/repositories/auth-sessions.ts';

export const SESSION_COOKIE = 'se_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** last_seen_at (and the expiry) is written at most this often. */
export const SESSION_TOUCH_MS = 60 * 60 * 1000;

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface Session {
	expiresAt: Date;
}

/** Start a session (a successful login; expired sessions are deleted): returns the cookie token (never stored) and its expiry. */
export function createSession(db: DbOrTx, now: Date): { token: string; expiresAt: Date } {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
	authSessionsRepo(db).deleteExpired(now);
	authSessionsRepo(db).insert({ id: hashToken(token), createdAt: now, expiresAt, lastSeenAt: now });
	return { token, expiresAt };
}

/**
 * The session for a cookie token, or null (unknown, malformed or expired; an expired row is
 * deleted). `refreshed` is true when the expiry slid forward, so the cookie should be re-sent.
 */
export function resolveSession(db: DbOrTx, token: string | undefined, now: Date): (Session & { refreshed: boolean }) | null {
	if (token === undefined || !TOKEN.test(token)) return null;
	const repo = authSessionsRepo(db);
	const id = hashToken(token);
	const row = repo.get(id);
	if (row === undefined) return null;
	if (row.expiresAt.getTime() <= now.getTime()) {
		repo.delete(id);
		return null;
	}
	if (now.getTime() - row.lastSeenAt.getTime() < SESSION_TOUCH_MS) return { expiresAt: row.expiresAt, refreshed: false };
	const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
	repo.update(id, { lastSeenAt: now, expiresAt });
	return { expiresAt, refreshed: true };
}

export function deleteSession(db: DbOrTx, token: string | undefined): void {
	if (token !== undefined && TOKEN.test(token)) authSessionsRepo(db).delete(hashToken(token));
}
