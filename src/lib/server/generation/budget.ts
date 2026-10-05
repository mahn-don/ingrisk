// The cost guards shared by every generation run: --max-calls and LLM_DAILY_CALL_CAP.
// One budget can span several pipelines (prefetch runs cloze, drills and reading on one budget).
import type { DbOrTx } from '../db/client.ts';
import { type UsageEntry, llmCallsRepo } from '../db/repositories/llm-calls.ts';
import type { CallBudget } from './batch.ts';

export const DEFAULT_DAILY_CALL_CAP = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export class DailyCapError extends Error {
	readonly used: number;
	readonly cap: number;
	constructor(used: number, cap: number) {
		super(`Refusing to start: ${used} LLM calls in the last 24 h (LLM_DAILY_CALL_CAP is ${cap})`);
		this.name = 'DailyCapError';
		this.used = used;
		this.cap = cap;
	}
}

/** LLM_DAILY_CALL_CAP from the environment (default 500). Throws on a malformed value. */
export function dailyCapFromEnv(env: Readonly<Record<string, string | undefined>>): number {
	const raw = env.LLM_DAILY_CALL_CAP;
	if (raw === undefined || raw.trim() === '') return DEFAULT_DAILY_CALL_CAP;
	const cap = Number(raw);
	if (!Number.isInteger(cap) || cap < 1) throw new Error('LLM_DAILY_CALL_CAP must be a positive integer');
	return cap;
}

export interface RunBudget extends CallBudget {
	/** HTTP attempts (llm_calls rows) made since the budget started. */
	calls(): number;
	/** Token totals per provider and model since the budget started. */
	usage(): UsageEntry[];
	/** The highest llm_calls id when the budget started; count from a later mark with `since`. */
	mark(): number;
}

/**
 * Start a budget: refuses (DailyCapError) when the last 24 h already hold `dailyCap` llm_calls
 * rows; afterwards `canCall()` is false once this run made `maxCalls` attempts or would reach the
 * daily cap. Checked before each batch, so one batch's retries can overshoot by a few attempts.
 */
export function startBudget(db: DbOrTx, now: Date, limits: { maxCalls: number; dailyCap: number }): RunBudget {
	const calls = llmCallsRepo(db);
	const usedToday = calls.countSince(new Date(now.getTime() - DAY_MS));
	if (usedToday >= limits.dailyCap) throw new DailyCapError(usedToday, limits.dailyCap);
	const baseline = calls.maxId();
	return {
		canCall: () => {
			const used = calls.countAfterId(baseline);
			return used < limits.maxCalls && usedToday + used < limits.dailyCap;
		},
		calls: () => calls.countAfterId(baseline),
		usage: () => calls.usageAfterId(baseline),
		mark: () => calls.maxId()
	};
}
