// Learning days as integers: day d starts at 04:00 Asia/Ho_Chi_Minh on calendar date d (days since
// 1970-01-01), i.e. at 21:00 UTC the evening before. Weeks start on Monday.
import { LEARNING_DAY_START_HOUR, TIME_ZONE_OFFSET_HOURS } from '../srs/queue.ts';
import type { LearningDate } from '../../progress/types.ts';

export const DAY_MS = 86_400_000;
const SHIFT = (TIME_ZONE_OFFSET_HOURS - LEARNING_DAY_START_HOUR) * 3_600_000;

/** The learning day containing `t`. */
export function dayIndex(t: Date | number): number {
	return Math.floor((Number(t) + SHIFT) / DAY_MS);
}

/** When learning day `d` starts. */
export function dayStart(d: number): Date {
	return new Date(d * DAY_MS - SHIFT);
}

/** 'YYYY-MM-DD' of learning day `d`. */
export function dayDate(d: number): LearningDate {
	return new Date(d * DAY_MS).toISOString().slice(0, 10);
}

/** Monday-start week of learning day `d` (1970-01-01 was a Thursday). */
export function weekIndex(d: number): number {
	return Math.floor((d + 3) / 7);
}

/** The first learning day (Monday) of week `w`. */
export function weekStartDay(w: number): number {
	return w * 7 - 3;
}
