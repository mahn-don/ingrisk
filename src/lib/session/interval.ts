// Durations in the largest sensible unit; shared by the scheduler previews and the session page.
import type { IntervalUnit } from './types.ts';

export interface Interval {
	value: number;
	unit: IntervalUnit;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Minutes under an hour, hours under a day, days under 30 days, months (30 days, one decimal)
 * under 365 days, then years (365 days, one decimal).
 */
export function describeInterval(ms: number): Interval {
	const oneDecimal = (n: number) => Math.round(n * 10) / 10;
	if (ms < HOUR) return { value: Math.round(ms / MINUTE), unit: 'minute' };
	if (ms < DAY) return { value: Math.round(ms / HOUR), unit: 'hour' };
	if (ms < 30 * DAY) return { value: Math.round(ms / DAY), unit: 'day' };
	if (ms < 365 * DAY) return { value: oneDecimal(ms / (30 * DAY)), unit: 'month' };
	return { value: oneDecimal(ms / (365 * DAY)), unit: 'year' };
}
