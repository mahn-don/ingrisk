// Shared e2e settings: the test password (its hash is computed when the config loads, never
// committed), the per-server databases, and the cron secret of the test server.
// playwright.config.ts repeats these values: keep them in sync.
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import type { Page } from '@playwright/test';

export const E2E_PASSWORD = 'e2e-only-password-not-real';
export const E2E_CRON_SECRET = 'e2e-only-cron-value';
export const E2E_DIR = 'tmp/e2e';
export const SERVERS = {
	main: { port: 4173, db: `${E2E_DIR}/main.db` },
	unconfigured: { port: 4174, db: `${E2E_DIR}/unconfigured.db` },
	rateLimit: { port: 4175, db: `${E2E_DIR}/rate-limit.db` }
} as const;

export async function login(page: Page, next = '/'): Promise<void> {
	await page.goto(`/login?next=${encodeURIComponent(next)}`);
	await page.getByLabel('Mật khẩu').fill(E2E_PASSWORD);
	await page.getByRole('button', { name: 'Đăng nhập' }).click();
	await page.waitForURL((url) => url.pathname !== '/login');
}

/** Move one session's expiry into the past, directly in the server's database. */
export function expireSession(dbPath: string, cookieValue: string): number {
	const db = new Database(dbPath);
	try {
		const id = createHash('sha256').update(cookieValue).digest('hex');
		return db.prepare('update auth_sessions set expires_at = ? where id = ?').run(Date.now() - 1000, id).changes;
	} finally {
		db.close();
	}
}
