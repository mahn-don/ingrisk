// What each rating would do to a card, as structured data (the UI formats it in Vietnamese).
import { type FSRS, type Grade, Rating } from 'ts-fsrs';
import type { CardRow } from '../db/repositories/cards.ts';
import { toFsrsCard } from './mapping.ts';

export type IntervalUnit = 'minute' | 'hour' | 'day' | 'month' | 'year';

export interface Interval {
	value: number;
	unit: IntervalUnit;
}

export interface RatingPreview {
	rating: Grade;
	due: Date;
	interval: Interval;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A duration in the largest sensible unit: minutes under an hour, hours under a day, days under
 * 30 days, months (30 days, one decimal) under 365 days, then years (365 days, one decimal).
 */
export function describeInterval(ms: number): Interval {
	const oneDecimal = (n: number) => Math.round(n * 10) / 10;
	if (ms < HOUR) return { value: Math.round(ms / MINUTE), unit: 'minute' };
	if (ms < DAY) return { value: Math.round(ms / HOUR), unit: 'hour' };
	if (ms < 30 * DAY) return { value: Math.round(ms / DAY), unit: 'day' };
	if (ms < 365 * DAY) return { value: oneDecimal(ms / (30 * DAY)), unit: 'month' };
	return { value: oneDecimal(ms / (365 * DAY)), unit: 'year' };
}

const GRADES: readonly Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

/** For Again, Hard, Good and Easy: the due date and interval the card would get if reviewed at `now`. */
export function previewIntervals(card: CardRow, now: Date, scheduler: FSRS): RatingPreview[] {
	const outcomes = scheduler.repeat(toFsrsCard(card), now);
	return GRADES.map((rating) => {
		const due = outcomes[rating].card.due;
		return { rating, due, interval: describeInterval(due.getTime() - now.getTime()) };
	});
}
