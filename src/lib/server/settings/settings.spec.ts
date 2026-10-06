import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { accessFor } from '../auth/guard.ts';
import { prefetchRunning, startBackgroundPrefetch } from '../cron/prefetch-endpoint.ts';
import { cardsRepo } from '../db/repositories/cards.ts';
import { jobLocksRepo } from '../db/repositories/job-locks.ts';
import { llmCallsRepo } from '../db/repositories/llm-calls.ts';
import { providersRepo } from '../db/repositories/providers.ts';
import { sessionsRepo } from '../db/repositories/sessions.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import { TEST_PROFILE, createTestDb } from '../db/test-db.ts';
import type { PrefetchSummary } from '../generation/prefetch.ts';
import { PREFETCH_LOCK } from '../generation/stock.ts';
import { cannedWorld, fixtureDb } from '../generation/test-fixtures.ts';
import { smokeTest } from '../llm/smoke.ts';
import { OPENAI_KEY, openaiProvider, scriptedFetch, setupProviders, testDeps } from '../llm/test-helpers.ts';
import { startSession } from '../session/engine.ts';
import { T0, setup } from '../session/test-fixtures.ts';
import { backupBytes, backupFileName } from './backup.ts';
import { stockOverview } from './content.ts';
import { credits } from './credits.ts';
import { parseLearningForm, saveLearningSettings } from './learning.ts';
import { deleteProvider, parseProviderForm, providerViews, saveProvider, setActiveProvider, setFallbackProvider } from './providers.ts';
import { usageLastDays } from './usage.ts';

const formOf = (values: Record<string, string>) => {
	const form = new FormData();
	for (const [k, v] of Object.entries(values)) form.set(k, v);
	return form;
};

describe('learning settings', () => {
	const valid = { desiredRetention: '0.9', newCardsPerDay: '10', defaultSessionBudget: '8', weeklyGoalDays: '5', feedbackMode: 'direct' };
	const accepts = (patch: Record<string, string>) => parseLearningForm(formOf({ ...valid, ...patch })).ok;

	it('accepts every bound and rejects just past it', () => {
		expect(accepts({})).toBe(true);
		expect([accepts({ desiredRetention: '0.7' }), accepts({ desiredRetention: '0.97' })]).toEqual([true, true]);
		expect([accepts({ desiredRetention: '0.69' }), accepts({ desiredRetention: '0.98' }), accepts({ desiredRetention: 'abc' })]).toEqual([false, false, false]);
		expect([accepts({ newCardsPerDay: '0' }), accepts({ newCardsPerDay: '50' })]).toEqual([true, true]);
		expect([accepts({ newCardsPerDay: '-1' }), accepts({ newCardsPerDay: '51' }), accepts({ newCardsPerDay: '2.5' })]).toEqual([false, false, false]);
		expect(['5', '8', '10'].map((b) => accepts({ defaultSessionBudget: b }))).toEqual([true, true, true]);
		expect(['4', '7', '15', '60'].map((b) => accepts({ defaultSessionBudget: b }))).toEqual([false, false, false, false]);
		expect([accepts({ weeklyGoalDays: '1' }), accepts({ weeklyGoalDays: '7' })]).toEqual([true, true]);
		expect([accepts({ weeklyGoalDays: '0' }), accepts({ weeklyGoalDays: '8' })]).toEqual([false, false]);
		expect([accepts({ feedbackMode: 'indirect' }), accepts({ feedbackMode: 'loud' })]).toEqual([true, false]);
	});

	it('names the invalid fields, and saved values pass the database CHECKs', () => {
		expect(parseLearningForm(formOf({ ...valid, newCardsPerDay: '99', weeklyGoalDays: '0' }))).toEqual({ ok: false, fields: ['newCardsPerDay', 'weeklyGoalDays'] });
		const db = createTestDb();
		const parsed = parseLearningForm(formOf({ desiredRetention: '0.8999999', newCardsPerDay: '50', defaultSessionBudget: '10', weeklyGoalDays: '7', feedbackMode: 'indirect' }));
		if (!parsed.ok) throw new Error('expected valid');
		expect(saveLearningSettings(db, TEST_PROFILE, parsed.value)).toMatchObject({ desiredRetention: 0.9, newCardsPerDay: 50, defaultSessionBudget: 10, weeklyGoalDays: 7, feedbackMode: 'indirect' });
	});

	it('changes apply to the next composition', () => {
		const fx = setup();
		for (let i = 0; i < 6; i++) fx.addItem({ gapType: 'lexical' });
		const save = (newCardsPerDay: string, defaultSessionBudget = '5') => {
			const parsed = parseLearningForm(formOf({ ...valid, newCardsPerDay, defaultSessionBudget }));
			if (!parsed.ok) throw new Error('expected valid');
			saveLearningSettings(fx.db, TEST_PROFILE, parsed.value);
		};
		save('2');
		const first = startSession(fx.db, TEST_PROFILE, T0);
		expect(first.items.filter((i) => i.isNew)).toHaveLength(2);
		save('0', '10');
		expect(startSession(fx.db, TEST_PROFILE, new Date(T0.getTime() + 60_000))).toMatchObject({ sessionId: null, items: [], reason: 'all_done' });
		save('4', '10');
		const next = startSession(fx.db, TEST_PROFILE, new Date(T0.getTime() + 120_000));
		expect(next.items.filter((i) => i.isNew)).toHaveLength(4);
		expect(sessionsRepo(fx.db, TEST_PROFILE).byId(next.sessionId!)?.budgetMin).toBe(10);
	});
});

describe('providers', () => {
	const form = (patch: Record<string, string> = {}) =>
		formOf({ name: 'Local', baseUrl: 'http://localhost:11434/v1', model: 'llama', wireFormat: 'openai', structuredMode: 'json_prompt', envKeyName: '', ...patch });

	it('validates with the Phase 4 rules: base URL, env variable NAME, Anthropic needs a key', () => {
		const ok = (patch: Record<string, string>) => parseProviderForm(form(patch)).ok;
		expect(ok({})).toBe(true);
		expect(ok({ baseUrl: 'https://api.example.com/v1', envKeyName: 'EXAMPLE_API_KEY' })).toBe(true);
		expect(ok({ baseUrl: 'http://api.example.com/v1' })).toBe(false);
		expect(ok({ baseUrl: 'not a url' })).toBe(false);
		expect(ok({ envKeyName: 'openai_api_key' })).toBe(false);
		expect(ok({ envKeyName: OPENAI_KEY })).toBe(false);
		expect(ok({ envKeyName: '1KEY' })).toBe(false);
		expect(ok({ wireFormat: 'anthropic', baseUrl: 'https://api.anthropic.com' })).toBe(false);
		expect(ok({ wireFormat: 'gemini' })).toBe(false);
		expect(ok({ name: '' })).toBe(false);
		// Only its own fields are read: a stray key field is never stored.
		const parsed = parseProviderForm(formOf({ ...Object.fromEntries(form()), apiKey: OPENAI_KEY }));
		expect(parsed.ok && JSON.stringify(parsed.value)).not.toContain(OPENAI_KEY);
		expect(parseProviderForm(form({ envKeyName: '  ' }))).toMatchObject({ ok: true, value: { envKeyName: null } });
	});

	it('add, edit, delete; one active; a single fallback', () => {
		const db = createTestDb();
		const value = (patch: Record<string, string> = {}) => {
			const parsed = parseProviderForm(form(patch));
			if (!parsed.ok) throw new Error(parsed.fields.join());
			return parsed.value;
		};
		const a = saveProvider(db, value());
		const b = saveProvider(db, value({ name: 'Remote', baseUrl: 'https://api.example.com/v1', envKeyName: 'REMOTE_KEY' }));
		if (!a.ok || !b.ok) throw new Error('not saved');
		expect(saveProvider(db, value({ name: 'Remote' }))).toEqual({ ok: false, error: 'name_taken' });
		expect(saveProvider(db, value({ model: 'llama-2' }), a.id)).toEqual({ ok: true, id: a.id });
		expect(saveProvider(db, value({ name: 'Ghost' }), 999)).toEqual({ ok: false, error: 'not_found' });
		expect(providersRepo(db).byId(a.id)?.model).toBe('llama-2');

		expect(setActiveProvider(db, b.id)).toBe(true);
		expect(setActiveProvider(db, 999)).toBe(false);
		expect(settingsRepo(db).get().activeProviderId).toBe(b.id);

		setFallbackProvider(db, a.id);
		setFallbackProvider(db, b.id);
		expect(providersRepo(db).list().map((p) => p.isFallback)).toEqual([false, true]);
		setFallbackProvider(db, null);
		expect(providersRepo(db).list().some((p) => p.isFallback)).toBe(false);

		expect(deleteProvider(db, b.id)).toBe(true);
		expect(settingsRepo(db).get().activeProviderId).toBeNull();
		expect(providerViews(db).map((p) => p.name)).toEqual(['Local']);
	});

	it('shows whether the key variable is set, never its value', () => {
		const { db } = setupProviders(openaiProvider);
		providersRepo(db).upsert({ ...openaiProvider, name: 'Keyless', envKeyName: null });
		const set = providerViews(db, { OPENAI_API_KEY: OPENAI_KEY });
		expect(set.map((p) => p.keySet)).toEqual([true, null]);
		expect(JSON.stringify(set)).not.toContain(OPENAI_KEY);
		expect(providerViews(db, { OPENAI_API_KEY: '  ' })[0].keySet).toBe(false);
		expect(providerViews(db, {})[0]).toMatchObject({ keySet: false, active: true, envKeyName: 'OPENAI_API_KEY' });
	});

	it('test connection: OK with latency in canned mode, never the fallback', async () => {
		const { fx, llm } = cannedWorld();
		const result = await smokeTest(fx.providerId, llm);
		expect(result).toMatchObject({ ok: true, data: { word: 'borrow', cefr: 'B1' } });
		expect(result.latencyMs).toBeGreaterThanOrEqual(0);
		// A missing key fails without trying the fallback.
		const fallback = providersRepo(fx.db).upsert({ ...openaiProvider, name: 'Spare', envKeyName: null, isFallback: true });
		const before = llmCallsRepo(fx.db).countSince(new Date(0));
		const failed = await smokeTest(fx.providerId, { ...llm, env: {} });
		expect(failed).toMatchObject({ ok: false, code: 'missing_key' });
		expect(llmCallsRepo(fx.db).countSince(new Date(0))).toBe(before);
		expect(fallback.isFallback).toBe(true);
	});

	it('a failed test never carries the key', async () => {
		const { db, primaryId } = setupProviders(openaiProvider);
		const { fetch } = scriptedFetch([{ status: 401, body: { error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } } }]);
		const { deps } = testDeps(db, fetch);
		const result = await smokeTest(primaryId, deps);
		expect(result).toMatchObject({ ok: false, code: 'http' });
		expect(JSON.stringify(result)).not.toContain(OPENAI_KEY);
		expect(JSON.stringify(result)).not.toContain('sk-proj');
	});
});

describe('content, usage and credits', () => {
	it('stock overview: cloze and passages per band, drills per topic', () => {
		const fx = setup();
		fx.addItem({ band: 1 });
		fx.addItem({ band: 2 });
		fx.addReading(1);
		fx.addDrill('ART');
		fx.addDrill('ART', 2);
		const stock = stockOverview(fx.db);
		expect(stock.bands).toEqual([
			{ band: 1, cloze: 1, reading: 1 },
			{ band: 2, cloze: 1, reading: 0 }
		]);
		expect(stock.drills.find((d) => d.code === 'ART')?.count).toBe(2);
		expect(stock.targets.drillsPerTopic).toBe(16);
	});

	it('AI usage per day for the last 7 days, by purpose', async () => {
		const { fx, llm } = cannedWorld();
		await smokeTest(fx.providerId, llm);
		await smokeTest(fx.providerId, llm);
		const days = usageLastDays(fx.db, llm.now());
		expect(days).toHaveLength(7);
		expect(days[0]).toMatchObject({ day: '2026-10-05', calls: 2, purposes: [{ purpose: 'smoke', calls: 2 }] });
		expect(days.slice(1).every((d) => d.calls === 0)).toBe(true);
	});

	it('credits from the license tags present and the word-list package', () => {
		const fx = fixtureDb();
		expect(credits(fx.db)).toMatchObject({
			sources: [
				{ id: 'tatoeba', license: 'CC BY 2.0 FR', url: 'https://tatoeba.org' },
				{ id: 'ngsl', license: 'CC BY-SA 4.0' }
			],
			packages: [{ name: 'word-list', license: 'MIT' }],
			other: []
		});
		expect(credits(createTestDb())).toMatchObject({ sources: [], other: [] });
	});
});

describe('backup', () => {
	const dir = mkdtempSync(join(tmpdir(), 'se-backup-test-'));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it('a valid SQLite file with the cards; the temp file is removed', async () => {
		const fx = setup();
		const card = fx.addDueCard();
		const bytes = await backupBytes(fx.db, dir);
		expect(readdirSync(dir)).toEqual([]);
		expect(bytes.subarray(0, 16).toString('latin1')).toBe('SQLite format 3\0');
		const file = join(dir, 'copy.db');
		writeFileSync(file, bytes);
		const copy = new Database(file, { readonly: true });
		expect(copy.prepare('select id from cards').all()).toEqual([{ id: card.id }]);
		copy.close();
		expect(backupFileName(new Date('2026-10-05T20:00:00Z'))).toBe('silentenglish-2026-10-06.db');
	});

	it('needs a login', () => {
		expect(accessFor('/api/backup', { configured: true, authenticated: false })).toBe('unauthorized');
	});
});

describe('Tạo thêm bài tập (background prefetch)', () => {
	const summary = { expiredSessionsDeleted: 0 } as PrefetchSummary;

	it('runs under the prefetch lock and releases it', async () => {
		const db = createTestDb();
		let finish!: () => void;
		const run = vi.fn(() => new Promise<PrefetchSummary>((resolve) => (finish = () => resolve(summary))));
		const deps = { db, now: () => T0, dailyCap: 10, run };
		const started = startBackgroundPrefetch(deps);
		expect(started.status).toBe('started');
		expect(run).toHaveBeenCalledWith({ maxCalls: 30 });
		expect(prefetchRunning(db, T0)).toBe(true);
		expect(startBackgroundPrefetch(deps).status).toBe('locked');
		finish();
		if (started.status === 'started') expect(await started.done).toBe(summary);
		expect(jobLocksRepo(db).get(PREFETCH_LOCK)).toBeUndefined();
	});

	it('is refused at the daily cap, and a failure releases the lock', async () => {
		const db = createTestDb();
		llmCallsRepo(db).record({ createdAt: T0, providerId: 1, model: 'm', purpose: 'smoke', mode: 'json_schema', attempt: 1, ok: true, latencyMs: 5 });
		expect(startBackgroundPrefetch({ db, now: () => T0, dailyCap: 1, run: vi.fn() })).toEqual({ status: 'capped', used: 1, cap: 1 });
		const log = vi.fn();
		const failing = startBackgroundPrefetch({ db, now: () => T0, dailyCap: 5, run: () => Promise.reject(new Error('boom')), log });
		if (failing.status !== 'started') throw new Error('not started');
		expect(await failing.done).toBeNull();
		expect(log).toHaveBeenCalledWith('prefetch failed: boom');
		expect(prefetchRunning(db, T0)).toBe(false);
	});
});

describe('suspended cards and settings', () => {
	it('cardsRepo.dueNow brings a card forward', () => {
		const fx = setup();
		const card = fx.addDueCard({ overdueDays: -2 });
		expect(cardsRepo(fx.db, TEST_PROFILE).dueNow(card.id, T0)).toBe(true);
		expect(cardsRepo(fx.db, TEST_PROFILE).byId(card.id)?.due).toEqual(T0);
	});
});
