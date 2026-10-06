import { describe, expect, it } from 'vitest';
import { accessFor } from './auth/guard.ts';
import { createDb, migrate, migrationsFolder } from './db/client.ts';
import { createTestDb } from './db/test-db.ts';
import { readdirSync } from 'node:fs';
import { checkHealth } from './health.ts';

describe('/healthz', () => {
	it('200 with the number of applied migrations', () => {
		const db = createTestDb();
		const applied = readdirSync(migrationsFolder()).filter((f) => f.endsWith('.sql')).length;
		expect(checkHealth(() => db)).toEqual({ status: 200, body: { ok: true, db: 'ok', migrations: applied } });
	});

	it('503 without details when the database is unavailable', () => {
		expect(checkHealth(() => { throw new Error('Database migration failed: secret detail'); })).toEqual({ status: 503, body: { ok: false, db: 'error' } });
		const closed = createTestDb();
		closed.$client.close();
		expect(checkHealth(() => closed)).toEqual({ status: 503, body: { ok: false, db: 'error' } });
		const unmigrated = createDb(':memory:');
		expect(checkHealth(() => unmigrated).status).toBe(503);
		migrate(unmigrated);
		expect(checkHealth(() => unmigrated).status).toBe(200);
	});

	it('is reachable without a session, even when login is not configured', () => {
		expect(accessFor('/healthz', { configured: true, authenticated: false })).toBe('allow');
		expect(accessFor('/healthz', { configured: false, authenticated: false })).toBe('allow');
		expect(accessFor('/healthz/x', { configured: true, authenticated: false })).toBe('login');
	});
});
