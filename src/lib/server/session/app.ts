// The session engine wired to the app: the app database, live (or canned) grading.
import { getDb } from '../db/client.ts';
import { appLlmDeps, llmConfigured } from '../generation/app-llm.ts';
import { gradeSubmission } from '../grading/queued.ts';
import type { AnchorDeps } from './engine.ts';

/** Redacted: the error's name and code only, never the learner's text or a provider message. */
const logError = (message: string, error: unknown) => {
	const e = error as { name?: string; code?: string };
	console.error(`${message}: ${e?.name ?? 'Error'}${e?.code ? ` (${e.code})` : ''}`);
};

export function appAnchorDeps(profileId: number): AnchorDeps {
	const db = getDb();
	return {
		db,
		profileId,
		now: () => new Date(),
		grade: llmConfigured(db) ? (submission, band) => gradeSubmission(submission, band, appLlmDeps(db)) : null,
		logError
	};
}
