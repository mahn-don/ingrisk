// The production wiring of prefetch: the app database, the active provider, LLM_DAILY_CALL_CAP.
import { getDb } from '../db/client.ts';
import { dailyCapFromEnv } from '../generation/budget.ts';
import { loadGenerationContext } from '../generation/context.ts';
import { type PrefetchSummary, prefetch } from '../generation/prefetch.ts';
import { defaultLlmDeps } from '../llm/client.ts';

export function runPrefetch(options: { maxCalls: number }): Promise<PrefetchSummary> {
	const db = getDb();
	return prefetch(options, {
		llm: { ...defaultLlmDeps(), db },
		context: loadGenerationContext(db),
		dailyCap: dailyCapFromEnv(process.env)
	});
}
