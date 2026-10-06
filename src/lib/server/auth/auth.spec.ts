import { describe, expect, it } from 'vitest';
import { authSessionsRepo } from '../db/repositories/auth-sessions.ts';
import { createTestDb } from '../db/test-db.ts';
import { authConfig } from './config.ts';
import { accessFor, isPublicPath } from './guard.ts';
import { sanitizeNext } from './next.ts';
import { createLoginLimiter } from './rate-limit.ts';
import { SESSION_TOUCH_MS, SESSION_TTL_MS, createSession, deleteSession, hashToken, resolveSession } from './sessions.ts';

const T0 = new Date('2026-10-05T02:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('sessions', () => {
	it('creates a session whose cookie token is never stored', () => {
		const db = createTestDb();
		const { token, expiresAt } = createSession(db, T0);
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
		expect(expiresAt).toEqual(at(SESSION_TTL_MS));
		const row = authSessionsRepo(db).get(hashToken(token))!;
		expect(row).toEqual({ id: hashToken(token), createdAt: T0, expiresAt, lastSeenAt: T0 });
		expect(JSON.stringify(row)).not.toContain(token);
	});

	it('reads a session without writing within the hour', () => {
		const db = createTestDb();
		const { token, expiresAt } = createSession(db, T0);
		expect(resolveSession(db, token, at(SESSION_TOUCH_MS - 1))).toEqual({ expiresAt, refreshed: false });
		expect(authSessionsRepo(db).get(hashToken(token))!.lastSeenAt).toEqual(T0);
	});

	it('slides the expiry forward on use, at most once an hour', () => {
		const db = createTestDb();
		const { token } = createSession(db, T0);
		const later = at(SESSION_TOUCH_MS);
		expect(resolveSession(db, token, later)).toEqual({ expiresAt: new Date(later.getTime() + SESSION_TTL_MS), refreshed: true });
		expect(authSessionsRepo(db).get(hashToken(token))).toMatchObject({ lastSeenAt: later, expiresAt: new Date(later.getTime() + SESSION_TTL_MS) });
		// 29 days later, still alive because it slid.
		expect(resolveSession(db, token, at(29 * 24 * 3600_000 + SESSION_TOUCH_MS))).not.toBeNull();
	});

	it('expires after 30 days without use and deletes the row', () => {
		const db = createTestDb();
		const { token } = createSession(db, T0);
		expect(resolveSession(db, token, at(SESSION_TTL_MS))).toBeNull();
		expect(authSessionsRepo(db).get(hashToken(token))).toBeUndefined();
	});

	it('rejects unknown and malformed tokens, and deletes on logout', () => {
		const db = createTestDb();
		const { token } = createSession(db, T0);
		expect(resolveSession(db, undefined, T0)).toBeNull();
		expect(resolveSession(db, 'x'.repeat(43), T0)).toBeNull();
		expect(resolveSession(db, "'; drop table auth_sessions; --", T0)).toBeNull();
		deleteSession(db, token);
		expect(resolveSession(db, token, T0)).toBeNull();
	});

	it('deleteExpired sweeps old rows', () => {
		const db = createTestDb();
		createSession(db, T0);
		createSession(db, at(SESSION_TTL_MS / 2));
		expect(authSessionsRepo(db).deleteExpired(at(SESSION_TTL_MS))).toBe(1);
		expect(authSessionsRepo(db).deleteExpired(at(SESSION_TTL_MS))).toBe(0);
	});

	it('a successful login deletes the expired sessions', () => {
		const db = createTestDb();
		const old = createSession(db, T0);
		const recent = createSession(db, at(SESSION_TTL_MS / 2));
		createSession(db, at(SESSION_TTL_MS + 1));
		expect(authSessionsRepo(db).get(hashToken(old.token))).toBeUndefined();
		expect(authSessionsRepo(db).get(hashToken(recent.token))).toBeDefined();
	});
});

describe('sanitizeNext', () => {
	it('keeps same-origin relative paths', () => {
		expect(sanitizeNext('/stats')).toBe('/stats');
		expect(sanitizeNext('/settings?tab=a#x')).toBe('/settings?tab=a#x');
		expect(sanitizeNext('/a/../stats')).toBe('/stats');
	});

	it('falls back to / for anything else', () => {
		for (const bad of [null, undefined, '', 'stats', '//evil.com', '//evil.com/x', '/\\evil.com', '\\\\evil.com', 'https://evil.com', 'http:/evil.com', 'javascript:alert(1)', '/%0d%0aSet-Cookie:x', '/\u0000x', '/login', '/login?next=/x']) {
			expect(sanitizeNext(bad as string), String(bad)).toBe(bad === '/%0d%0aSet-Cookie:x' ? '/%0d%0aSet-Cookie:x' : '/');
		}
	});
});

describe('login limiter', () => {
	it('blocks after 5 failures in 10 minutes, per IP, and the window slides', () => {
		const limiter = createLoginLimiter();
		for (let i = 0; i < 5; i++) {
			expect(limiter.blocked('1.1.1.1', i * 1000)).toBe(false);
			limiter.recordFailure('1.1.1.1', i * 1000);
		}
		expect(limiter.blocked('1.1.1.1', 5000)).toBe(true);
		expect(limiter.blocked('2.2.2.2', 5000)).toBe(false);
		// The first failure (t=0) leaves the window at 10 minutes.
		expect(limiter.blocked('1.1.1.1', 10 * 60_000 - 1)).toBe(true);
		expect(limiter.blocked('1.1.1.1', 10 * 60_000)).toBe(false);
	});

	it('reset forgets an IP', () => {
		const limiter = createLoginLimiter(2, 1000);
		limiter.recordFailure('ip', 0);
		limiter.recordFailure('ip', 1);
		expect(limiter.blocked('ip', 2)).toBe(true);
		limiter.reset('ip');
		expect(limiter.blocked('ip', 2)).toBe(false);
	});
});

describe('authConfig', () => {
	const hash = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g';

	it('fails closed without an argon2id hash', () => {
		expect(authConfig({}).passwordHash).toBeNull();
		expect(authConfig({ APP_PASSWORD_HASH: 'plaintext' }).passwordHash).toBeNull();
		expect(authConfig({ APP_PASSWORD_HASH: hash }).passwordHash).toBe(hash);
		expect(authConfig({ APP_PASSWORD_HASH: 'plaintext' }).warnings.join(' ')).not.toContain('plaintext');
	});

	it('COOKIE_SECURE defaults to true', () => {
		expect(authConfig({})).toMatchObject({ cookieSecure: true, insecureRemote: false });
		expect(authConfig({ COOKIE_SECURE: 'true', ORIGIN: 'http://103.82.195.48:3000' })).toMatchObject({ cookieSecure: true, insecureRemote: false });
		expect(authConfig({ COOKIE_SECURE: 'yes' }).cookieSecure).toBe(true);
	});

	it('COOKIE_SECURE=false is allowed for a localhost ORIGIN without a login notice', () => {
		for (const origin of ['http://localhost:3000', 'http://127.0.0.1:4173', 'http://localhost']) {
			expect(authConfig({ COOKIE_SECURE: 'false', ORIGIN: origin }), origin).toMatchObject({ cookieSecure: false, insecureRemote: false });
		}
	});

	it('COOKIE_SECURE=false is allowed for any other ORIGIN, with a startup warning and a login notice', () => {
		for (const origin of ['http://103.82.195.48:3000', 'http://localhost.evil.com', 'https://english.example.com', '']) {
			const config = authConfig({ COOKIE_SECURE: 'false', ORIGIN: origin });
			expect(config, origin).toMatchObject({ cookieSecure: false, insecureRemote: true });
			expect(config.warnings.some((w) => w.includes('unencrypted'))).toBe(true);
		}
	});
});

describe('access guard', () => {
	it('allows exactly the public allowlist', () => {
		for (const p of ['/login', '/api/cron/prefetch', '/_app/immutable/x.js', '/_app/version.json', '/_app/env.js', '/favicon.svg', '/robots.txt']) {
			expect(isPublicPath(p), p).toBe(true);
		}
		for (const p of ['/', '/stats', '/settings', '/session', '/api/anything', '/api/cron', '/_app/remote/abc', '/login/extra', '/loginx', '/dev/components', '/offline', '/manifest.webmanifest', '/service-worker.js', '/icons/icon-192.png', '/%5Fapp/immutable/x']) {
			expect(isPublicPath(p), p).toBe(false);
		}
	});

	it('sends pages to login and answers /api with 401, or 503 when not configured', () => {
		expect(accessFor('/stats', { configured: true, authenticated: false })).toBe('login');
		expect(accessFor('/api/x', { configured: true, authenticated: false })).toBe('unauthorized');
		expect(accessFor('/api/x', { configured: true, authenticated: true })).toBe('allow');
		expect(accessFor('/stats', { configured: false, authenticated: false })).toBe('login');
		expect(accessFor('/api/x', { configured: false, authenticated: true })).toBe('not-configured');
		expect(accessFor('/login', { configured: false, authenticated: false })).toBe('allow');
	});
});
