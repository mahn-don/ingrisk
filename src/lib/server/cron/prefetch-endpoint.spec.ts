import { afterEach, describe, expect, it, vi } from 'vitest';

// Wrap timingSafeEqual (keeping its behaviour) to prove it is what compares the secret.
vi.mock('node:crypto', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:crypto')>();
	return { ...original, timingSafeEqual: vi.fn(original.timingSafeEqual) };
});

const { timingSafeEqual } = await import('node:crypto');
const { createTestDb } = await import('../db/test-db.ts');
const { jobLocksRepo } = await import('../db/repositories/job-locks.ts');
const { DailyCapError } = await import('../generation/budget.ts');
const { handlePrefetch } = await import('./prefetch-endpoint.ts');
const { PREFETCH_LOCK, PREFETCH_STALE_LOCK_MS } = await import('../generation/stock.ts');

const SECRET = 'not-a-real-secret';
const NOW = new Date('2026-10-05T20:00:00Z');
const summary = { added: {}, rejected: {}, llmFailed: {}, notRun: 0, shortfall: [], steps: [], budgetExhausted: false, llm: { calls: 0, usage: [] } };

function setup(env: Record<string, string | undefined> = { CRON_SECRET: SECRET }, run = vi.fn(async () => summary)) {
	const db = createTestDb();
	const deps = { env, db, now: () => NOW, run, log: vi.fn() };
	const call = (auth: string | null = `Bearer ${SECRET}`, body?: string) =>
		handlePrefetch(new Request('http://localhost/api/cron/prefetch', { method: 'POST', headers: auth === null ? {} : { authorization: auth }, body }), deps);
	return { db, deps, run, call };
}

afterEach(() => vi.mocked(timingSafeEqual).mockClear());

describe('POST /api/cron/prefetch', () => {
	it('runs prefetch with a valid secret and returns the summary', async () => {
		const { call, run, db } = setup();
		const response = await call(`Bearer ${SECRET}`, JSON.stringify({ maxCalls: 7 }));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(summary);
		expect(run).toHaveBeenCalledWith({ maxCalls: 7 });
		expect(jobLocksRepo(db).get(PREFETCH_LOCK)).toBeUndefined();
	});

	it('401 with a wrong or missing secret, compared with crypto.timingSafeEqual', async () => {
		const { call, run } = setup();
		expect((await call('Bearer wrong-secret')).status).toBe(401);
		expect(timingSafeEqual).toHaveBeenCalledTimes(1);
		expect((await call(null)).status).toBe(401);
		expect((await call(SECRET)).status).toBe(401); // no "Bearer "
		expect(run).not.toHaveBeenCalled();
	});

	it('503 when CRON_SECRET is not configured', async () => {
		const { call } = setup({});
		expect((await call()).status).toBe(503);
		expect((await setup({ CRON_SECRET: '  ' }).call()).status).toBe(503);
	});

	it('400 on a malformed body', async () => {
		const { call } = setup();
		expect((await call(`Bearer ${SECRET}`, '{"maxCalls": 0}')).status).toBe(400);
		expect((await call(`Bearer ${SECRET}`, 'not json')).status).toBe(400);
	});

	it('409 while another run holds the lock', async () => {
		const { call, db, run } = setup();
		jobLocksRepo(db).acquire(PREFETCH_LOCK, 'other-run', new Date(NOW.getTime() - 60_000), PREFETCH_STALE_LOCK_MS);
		expect((await call()).status).toBe(409);
		expect(run).not.toHaveBeenCalled();
		expect(jobLocksRepo(db).get(PREFETCH_LOCK)?.holder).toBe('other-run'); // not released by the refused call
	});

	it('reclaims a lock older than 30 minutes', async () => {
		const { call, db, run } = setup();
		jobLocksRepo(db).acquire(PREFETCH_LOCK, 'crashed-run', new Date(NOW.getTime() - PREFETCH_STALE_LOCK_MS - 1), PREFETCH_STALE_LOCK_MS);
		expect((await call()).status).toBe(200);
		expect(run).toHaveBeenCalledOnce();
		expect(jobLocksRepo(db).get(PREFETCH_LOCK)).toBeUndefined();
	});

	it('releases the lock after a thrown error', async () => {
		const { call, db, deps } = setup(undefined, vi.fn(async () => Promise.reject(new Error('boom'))));
		const response = await call();
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: 'prefetch failed' });
		expect(deps.log).toHaveBeenCalledWith('prefetch failed: boom');
		expect(jobLocksRepo(db).get(PREFETCH_LOCK)).toBeUndefined();
	});

	it('429 at the daily LLM call cap', async () => {
		const { call, db } = setup(undefined, vi.fn(async () => Promise.reject(new DailyCapError(500, 500))));
		expect((await call()).status).toBe(429);
		expect(jobLocksRepo(db).get(PREFETCH_LOCK)).toBeUndefined();
	});
});
