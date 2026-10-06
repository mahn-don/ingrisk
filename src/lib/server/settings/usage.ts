// "Sử dụng AI": LLM calls and tokens per day for the last 7 days, by purpose.
import type { DbOrTx } from '../db/client.ts';
import { llmCallsRepo } from '../db/repositories/llm-calls.ts';

export const USAGE_DAYS = 7;
const DAY = 86_400_000;
const ICT = 7 * 3_600_000;

export interface UsageDay {
	/** YYYY-MM-DD in Asia/Ho_Chi_Minh. */
	day: string;
	calls: number;
	inputTokens: number;
	outputTokens: number;
	purposes: { purpose: string; calls: number; inputTokens: number; outputTokens: number }[];
}

/**
 * The last 7 calendar days (today included, newest first), every day listed even without calls.
 * With `profileId`: only the calls made for that learner (grading); shared content has no profile.
 */
export function usageLastDays(db: DbOrTx, now: Date, options: { days?: number; profileId?: number } = {}): UsageDay[] {
	const days = options.days ?? USAGE_DAYS;
	const todayStart = Math.floor((now.getTime() + ICT) / DAY) * DAY - ICT;
	const since = new Date(todayStart - (days - 1) * DAY);
	const rows = llmCallsRepo(db).usageByDay(since, options.profileId);
	return Array.from({ length: days }, (_, i) => {
		const day = new Date(todayStart - i * DAY + ICT).toISOString().slice(0, 10);
		const byPurpose = new Map<string, UsageDay['purposes'][number]>();
		for (const r of rows.filter((r) => r.day === day)) {
			const p = byPurpose.get(r.purpose) ?? { purpose: r.purpose, calls: 0, inputTokens: 0, outputTokens: 0 };
			p.calls += r.calls;
			p.inputTokens += r.inputTokens;
			p.outputTokens += r.outputTokens;
			byPurpose.set(r.purpose, p);
		}
		const purposes = [...byPurpose.values()].sort((a, b) => b.calls - a.calls || a.purpose.localeCompare(b.purpose));
		return {
			day,
			calls: purposes.reduce((n, p) => n + p.calls, 0),
			inputTokens: purposes.reduce((n, p) => n + p.inputTokens, 0),
			outputTokens: purposes.reduce((n, p) => n + p.outputTokens, 0),
			purposes
		};
	});
}
