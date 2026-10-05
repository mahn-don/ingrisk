// The production wiring of prefetch: the app database, the active provider (or LLM_CANNED in
// tests), LLM_DAILY_CALL_CAP.
import { getDb } from '../db/client.ts';
import { appLlmDeps } from '../generation/app-llm.ts';
import { dailyCapFromEnv } from '../generation/budget.ts';
import { loadGenerationContext } from '../generation/context.ts';
import { type PrefetchSummary, prefetch } from '../generation/prefetch.ts';

export function runPrefetch(options: { maxCalls: number }): Promise<PrefetchSummary> {
	const db = getDb();
	return prefetch(options, {
		llm: appLlmDeps(db),
		context: loadGenerationContext(db),
		dailyCap: dailyCapFromEnv(process.env)
	});
}
