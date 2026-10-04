// Applying reviews: one card, or a whole session's batch atomically.
import { type Grade, Rating } from 'ts-fsrs';
import type { DbOrTx } from '../db/client.ts';
import { cardsRepo, type CardRow } from '../db/repositories/cards.ts';
import { reviewLogsRepo, type ReviewLogRow } from '../db/repositories/review-logs.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import { CardNotFoundError, InvalidRatingError, ReviewTimeError } from './errors.ts';
import { fromFsrsCard, fromFsrsReviewLog, toFsrsCard } from './mapping.ts';
import { createScheduler, type SchedulerOptions } from './scheduler.ts';

/** How far a client-recorded review time may run ahead of the server clock (clock skew). */
export const MAX_FUTURE_SKEW_MS = 5 * 60_000;

export interface ReviewResult {
	card: CardRow;
	log: ReviewLogRow;
}

export interface ReviewInput {
	cardId: number;
	rating: Grade;
	reviewedAt: Date;
}

function assertGrade(rating: unknown): asserts rating is Grade {
	if (rating !== Rating.Again && rating !== Rating.Hard && rating !== Rating.Good && rating !== Rating.Easy) {
		throw new InvalidRatingError(rating);
	}
}

/**
 * Review one card at the client-recorded time `reviewedAt`, inside a transaction: schedule it with
 * ts-fsrs, save the card and append the review log. `serverNow` is only used to reject review
 * times in the future. Works on a db or inside a caller's transaction.
 */
export function review(
	dbOrTx: DbOrTx,
	cardId: number,
	rating: Grade,
	reviewedAt: Date,
	serverNow: Date,
	options: SchedulerOptions = {}
): ReviewResult {
	assertGrade(rating);
	return dbOrTx.transaction((tx) => {
		const cards = cardsRepo(tx);
		const row = cards.byId(cardId);
		if (row === undefined) throw new CardNotFoundError(cardId);
		if (row.lastReview !== null && reviewedAt.getTime() < row.lastReview.getTime()) {
			throw new ReviewTimeError('before_last_review', cardId, reviewedAt, row.lastReview);
		}
		const latest = new Date(serverNow.getTime() + MAX_FUTURE_SKEW_MS);
		if (reviewedAt.getTime() > latest.getTime()) {
			throw new ReviewTimeError('in_future', cardId, reviewedAt, latest);
		}

		const scheduler = createScheduler(settingsRepo(tx).get(), options);
		// ts-fsrs's log records the card as it was before this review.
		const next = scheduler.next(toFsrsCard(row), reviewedAt, rating);
		const card = cards.save(fromFsrsCard(next.card, row));
		const log = reviewLogsRepo(tx).append(
			fromFsrsReviewLog(next.log, {
				cardId,
				oldS: row.stability,
				newS: next.card.stability,
				oldD: row.difficulty,
				newD: next.card.difficulty
			})
		);
		return { card, log };
	});
}

/**
 * Apply a batch of reviews (e.g. a finished offline session) in chronological order of
 * `reviewedAt`, in one transaction: if any review fails, none is applied.
 */
export function reviewBatch(
	dbOrTx: DbOrTx,
	reviews: readonly ReviewInput[],
	serverNow: Date,
	options: SchedulerOptions = {}
): ReviewResult[] {
	const ordered = [...reviews].sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime());
	return dbOrTx.transaction((tx) =>
		ordered.map((r) => review(tx, r.cardId, r.rating, r.reviewedAt, serverNow, options))
	);
}
