// What each rating would do to a card, as structured data (the UI formats it in Vietnamese).
import { type FSRS, type Grade, Rating } from 'ts-fsrs';
import type { CardRow } from '../db/repositories/cards.ts';
import { type Interval, describeInterval } from '../../session/interval.ts';
import { toFsrsCard } from './mapping.ts';

export type { IntervalUnit } from '../../session/types.ts';
export { type Interval, describeInterval } from '../../session/interval.ts';

export interface RatingPreview {
	rating: Grade;
	due: Date;
	interval: Interval;
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
