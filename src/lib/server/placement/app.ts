// The placement engine wired to the app: the app database, the content, live (or canned) grading.
import { getDb } from '../db/client.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import { appLlmDeps, llmConfigured } from '../generation/app-llm.ts';
import { dailyCapFromEnv } from '../generation/budget.ts';
import { gradeWriting } from '../grading/grading.ts';
import { gradeQueuedWritings, toGradedWriting } from '../grading/queued.ts';
import { loadPlacementContent } from './content.ts';
import type { EngineDeps } from './engine.ts';

/** Redacted: the error's name and code only, never the learner's text or a provider message. */
const logError = (message: string, error: unknown) => {
	const e = error as { name?: string; code?: string };
	console.error(`${message}: ${e?.name ?? 'Error'}${e?.code ? ` (${e.code})` : ''}`);
};

export function appEngineDeps(): EngineDeps {
	const db = getDb();
	return {
		db,
		now: () => new Date(),
		content: loadPlacementContent(db),
		grade: llmConfigured(db)
			? async (request) => toGradedWriting((await gradeWriting({ ...request, feedback_mode: 'direct' }, appLlmDeps(db))).feedback)
			: null,
		logError
	};
}

/** Calls one background run may make (each grading is one call plus retries). */
const BACKGROUND_MAX_CALLS = 3;
/** At most one background run per this interval. */
const BACKGROUND_INTERVAL_MS = 10 * 60_000;
let lastBackgroundRun = 0;
let backgroundRunning = false;

/**
 * Fire-and-forget grading of queued writings (Home load), when a provider is configured. Throttled
 * and never concurrent; errors are logged, never thrown at the page.
 */
export function gradeQueuedInBackground(now = Date.now()): void {
	if (backgroundRunning || now - lastBackgroundRun < BACKGROUND_INTERVAL_MS) return;
	const db = getDb();
	if (!llmConfigured(db) || writingRepo(db).queued().length === 0) return;
	lastBackgroundRun = now;
	backgroundRunning = true;
	void gradeQueuedWritings({ maxCalls: BACKGROUND_MAX_CALLS }, { llm: appLlmDeps(db), dailyCap: dailyCapFromEnv(process.env) })
		.catch((error: unknown) => logError('background writing grading failed', error))
		.finally(() => {
			backgroundRunning = false;
		});
}
