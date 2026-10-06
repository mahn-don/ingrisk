// POST /api/cron/prefetch: authenticated, one run at a time, within the daily LLM call cap.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DbOrTx } from '../db/client.ts';
import { jobLocksRepo } from '../db/repositories/job-locks.ts';
import { llmCallsRepo } from '../db/repositories/llm-calls.ts';
import { DailyCapError } from '../generation/budget.ts';
import type { PrefetchSummary } from '../generation/prefetch.ts';
import { DEFAULT_PREFETCH_MAX_CALLS, PREFETCH_LOCK, PREFETCH_STALE_LOCK_MS } from '../generation/stock.ts';
import { bearerMatches } from './auth.ts';

export interface PrefetchEndpointDeps {
	env: Readonly<Record<string, string | undefined>>;
	db: DbOrTx;
	now: () => Date;
	run: (options: { maxCalls: number }) => Promise<PrefetchSummary>;
	/** Logs failures (never request headers or secrets). */
	log?: (message: string) => void;
}

const Body = z.object({ maxCalls: z.number().int().min(1).max(1000).optional() }).strict();

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function handlePrefetch(request: Request, deps: PrefetchEndpointDeps): Promise<Response> {
	const secret = deps.env.CRON_SECRET;
	if (secret === undefined || secret.trim() === '') return json(503, { error: 'CRON_SECRET is not configured' });
	if (!bearerMatches(request.headers.get('authorization'), secret)) return json(401, { error: 'unauthorized' });

	const text = await request.text();
	let body: unknown = {};
	if (text.trim() !== '') {
		try {
			body = JSON.parse(text);
		} catch {
			return json(400, { error: 'body must be JSON' });
		}
	}
	const parsed = Body.safeParse(body);
	if (!parsed.success) return json(400, { error: 'body may only hold maxCalls (1-1000)' });

	const locks = jobLocksRepo(deps.db);
	const holder = randomUUID();
	if (!locks.acquire(PREFETCH_LOCK, holder, deps.now(), PREFETCH_STALE_LOCK_MS)) {
		return json(409, { error: 'a prefetch run is already in progress' });
	}
	try {
		const summary = await deps.run({ maxCalls: parsed.data.maxCalls ?? DEFAULT_PREFETCH_MAX_CALLS });
		return json(200, summary);
	} catch (error) {
		if (error instanceof DailyCapError) return json(429, { error: error.message });
		deps.log?.(`prefetch failed: ${(error as Error).message}`);
		return json(500, { error: 'prefetch failed' });
	} finally {
		locks.release(PREFETCH_LOCK, holder);
	}
}

/** "Tạo thêm bài tập" on the settings page: this many calls at most. */
export const SETTINGS_PREFETCH_MAX_CALLS = 30;

export type BackgroundPrefetch =
	| { status: 'started'; done: Promise<PrefetchSummary | null> }
	| { status: 'locked' }
	| { status: 'capped'; used: number; cap: number };

export interface BackgroundPrefetchDeps {
	db: DbOrTx;
	now: () => Date;
	dailyCap: number;
	run: (options: { maxCalls: number }) => Promise<PrefetchSummary>;
	log?: (message: string) => void;
}

/**
 * Start a prefetch run in the background (the settings button): the same lock as the cron
 * endpoint, and refused up front when the daily cap is reached. `done` settles when the run ends
 * (null on failure); the lock is released then.
 */
export function startBackgroundPrefetch(deps: BackgroundPrefetchDeps, maxCalls = SETTINGS_PREFETCH_MAX_CALLS): BackgroundPrefetch {
	const now = deps.now();
	const used = llmCallsRepo(deps.db).countSince(new Date(now.getTime() - 86_400_000));
	if (used >= deps.dailyCap) return { status: 'capped', used, cap: deps.dailyCap };
	const locks = jobLocksRepo(deps.db);
	const holder = randomUUID();
	if (!locks.acquire(PREFETCH_LOCK, holder, now, PREFETCH_STALE_LOCK_MS)) return { status: 'locked' };
	const done = (async () => {
		try {
			return await deps.run({ maxCalls });
		} catch (error) {
			deps.log?.(`prefetch failed: ${(error as Error).message}`);
			return null;
		} finally {
			locks.release(PREFETCH_LOCK, holder);
		}
	})();
	return { status: 'started', done };
}

/** Whether a prefetch run holds the lock now (a stale lock does not count). */
export function prefetchRunning(db: DbOrTx, now: Date): boolean {
	const lock = jobLocksRepo(db).get(PREFETCH_LOCK);
	return lock !== undefined && now.getTime() - lock.acquiredAt.getTime() < PREFETCH_STALE_LOCK_MS;
}
