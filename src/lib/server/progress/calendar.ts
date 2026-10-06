// The weekly goal, the 12-week heat-map and the 7-day review forecast: pure, over learning days.
import type { ForecastDay, HeatBucket, HeatMap, WeekGoal, WeeklyGoal } from '../../progress/types.ts';
import { dayDate, dayIndex, weekIndex, weekStartDay } from './days.ts';
import { type FinishedSessionFacts, studiedDays } from './streak.ts';

export const PAST_WEEKS = 8;
export const HEAT_WEEKS = 12;
export const FORECAST_DAYS = 7;

/** This week's studied days against the goal, and hit or miss for each of the 8 weeks before. */
export function weeklyGoal(sessions: readonly FinishedSessionFacts[], goal: number, now: Date): WeeklyGoal {
	const studied = studiedDays(sessions);
	const thisWeek = weekIndex(dayIndex(now));
	const firstWeek = sessions.length === 0 ? Infinity : Math.min(...sessions.map((s) => weekIndex(dayIndex(s.finishedAt))));
	const week = (w: number): WeekGoal => {
		const start = weekStartDay(w);
		let days = 0;
		for (let d = start; d < start + 7; d++) if (studied.has(d)) days++;
		return { weekStart: dayDate(start), studiedDays: days, goal, hit: w < firstWeek ? null : days >= goal };
	};
	return {
		goal,
		thisWeek: week(thisWeek),
		past: Array.from({ length: PAST_WEEKS }, (_, i) => week(thisWeek - PAST_WEEKS + i))
	};
}

/** Minutes of study in a day → the heat-map intensity. */
export function heatBucket(ms: number): HeatBucket {
	if (ms <= 0) return 0;
	const minutes = ms / 60_000;
	return minutes < 5 ? 1 : minutes < 10 ? 2 : 3;
}

/** The last 12 Monday-start weeks up to this one; minutes are the answers' response times. */
export function heatMap(sessions: readonly FinishedSessionFacts[], now: Date): HeatMap {
	const today = dayIndex(now);
	const msPerDay = new Map<number, number>();
	for (const s of sessions) msPerDay.set(dayIndex(s.finishedAt), (msPerDay.get(dayIndex(s.finishedAt)) ?? 0) + s.studyMs);
	const lastWeek = weekIndex(today);
	return Array.from({ length: HEAT_WEEKS }, (_, i) => {
		const start = weekStartDay(lastWeek - HEAT_WEEKS + 1 + i);
		return Array.from({ length: 7 }, (_, k) => {
			const d = start + k;
			const ms = d > today ? 0 : (msPerDay.get(d) ?? 0);
			return { date: dayDate(d), minutes: Math.round(ms / 60_000), bucket: heatBucket(ms), future: d > today };
		});
	});
}

/** Cards due on each of the next 7 learning days (today includes everything overdue). */
export function forecast(dueDates: readonly Date[], now: Date): ForecastDay[] {
	const today = dayIndex(now);
	const days = Array.from({ length: FORECAST_DAYS }, (_, i) => ({ date: dayDate(today + i), due: 0 }));
	for (const due of dueDates) {
		const offset = Math.max(0, dayIndex(due) - today);
		if (offset < FORECAST_DAYS) days[offset].due++;
	}
	return days;
}
