// The streak, replayed from the session history on every read (no stored streak state).
import type { Streak } from '../../progress/types.ts';
import { dayDate, dayIndex } from './days.ts';

/** A session counts towards a studied day when at least this many items were answered. */
export const STUDIED_MIN_ITEMS = 5;
/** One freeze is earned per this many finished sessions (of any size). */
export const SESSIONS_PER_FREEZE = 5;
export const MAX_FREEZES = 2;

export interface FinishedSessionFacts {
	finishedAt: Date;
	itemsDone: number;
	/** Sum of the answers' response times. */
	studyMs: number;
}

/** Learning days with at least one finished session of 5 or more answered items. */
export function studiedDays(sessions: readonly FinishedSessionFacts[]): Set<number> {
	return new Set(sessions.filter((s) => s.itemsDone >= STUDIED_MIN_ITEMS).map((s) => dayIndex(s.finishedAt)));
}

/**
 * Replay every learning day from the first session to today. A studied day extends the streak.
 * A missed day spends a banked freeze when the streak is running, else resets it. Today, not yet
 * studied, changes nothing. After each day, every 5th finished session earns a freeze (2 at most).
 */
export function computeStreak(sessions: readonly FinishedSessionFacts[], now: Date): Streak {
	const today = dayIndex(now);
	const studied = studiedDays(sessions);
	const finishedPerDay = new Map<number, number>();
	for (const s of sessions) finishedPerDay.set(dayIndex(s.finishedAt), (finishedPerDay.get(dayIndex(s.finishedAt)) ?? 0) + 1);
	const streak: Streak = { current: 0, longest: 0, freezesBanked: 0, freezesUsedDates: [], studiedToday: studied.has(today) };
	if (sessions.length === 0) return streak;
	const first = Math.min(...sessions.map((s) => dayIndex(s.finishedAt)));
	let finished = 0;
	for (let d = first; d <= today; d++) {
		if (studied.has(d)) {
			streak.current++;
			streak.longest = Math.max(streak.longest, streak.current);
		} else if (d < today) {
			if (streak.freezesBanked > 0 && streak.current > 0) {
				streak.freezesBanked--;
				streak.freezesUsedDates.push(dayDate(d));
			} else streak.current = 0;
		}
		const before = finished;
		finished += finishedPerDay.get(d) ?? 0;
		const earned = Math.floor(finished / SESSIONS_PER_FREEZE) - Math.floor(before / SESSIONS_PER_FREEZE);
		streak.freezesBanked = Math.min(MAX_FREEZES, streak.freezesBanked + earned);
	}
	return streak;
}
