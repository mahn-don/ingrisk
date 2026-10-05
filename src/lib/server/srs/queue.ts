// What to review now: due cards, then a daily ration of new cards.
import type { DbOrTx } from '../db/client.ts';
import { cardsRepo, type CardRow } from '../db/repositories/cards.ts';
import { reviewLogsRepo } from '../db/repositories/review-logs.ts';
import { settingsRepo } from '../db/repositories/settings.ts';

/** Asia/Ho_Chi_Minh is UTC+7 all year (no daylight saving time). */
export const TIME_ZONE_OFFSET_HOURS = 7;
/** A learning day starts at 04:00 local time: studying at 1 a.m. still counts for the evening before. */
export const LEARNING_DAY_START_HOUR = 4;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SHIFT = (TIME_ZONE_OFFSET_HOURS - LEARNING_DAY_START_HOUR) * HOUR;

/** Start of the learning day containing `now` (04:00 Asia/Ho_Chi_Minh, i.e. 21:00 UTC). */
export function learningDayStart(now: Date): Date {
	const shifted = now.getTime() + SHIFT;
	return new Date(Math.floor(shifted / DAY) * DAY - SHIFT);
}

export interface QueueLimits {
	reviewLimit: number;
	/** New cards allowed per learning day (normally settings.newCardsPerDay). */
	newLimit: number;
}

export interface Queue {
	/** Due cards (most overdue first), then new cards. */
	cards: CardRow[];
	dueCount: number;
	newCount: number;
	/** New cards already introduced in the current learning day. */
	introducedToday: number;
}

function newCardsLeftToday(db: DbOrTx, now: Date, newLimit: number): { left: number; introduced: number } {
	const start = learningDayStart(now);
	const introduced = reviewLogsRepo(db).countIntroducedBetween(start, new Date(start.getTime() + DAY));
	return { left: Math.max(0, newLimit - introduced), introduced };
}

export function buildQueue(db: DbOrTx, now: Date, { reviewLimit, newLimit }: QueueLimits): Queue {
	const cards = cardsRepo(db);
	const due = cards.dueCards(now, reviewLimit);
	const { left, introduced } = newCardsLeftToday(db, now, newLimit);
	const fresh = left > 0 ? cards.newCards(left) : [];
	return { cards: [...due, ...fresh], dueCount: due.length, newCount: fresh.length, introducedToday: introduced };
}

export interface HomeCounts {
	due: number;
	/** New cards that can still be introduced this learning day. */
	newAvailableToday: number;
	learning: number;
}

/** Counts for the home screen; the daily new-card limit comes from settings unless given. */
export function counts(db: DbOrTx, now: Date, newLimit = settingsRepo(db).get().newCardsPerDay): HomeCounts {
	const totals = cardsRepo(db).counts(now);
	const { left } = newCardsLeftToday(db, now, newLimit);
	return { due: totals.due, newAvailableToday: Math.min(totals.new, left), learning: totals.learning };
}
