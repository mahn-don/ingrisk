// Lossless conversion between our rows and ts-fsrs objects. Pure functions.
import { type Card, type ReviewLog, Rating, State, createEmptyCard } from 'ts-fsrs';
import type { CardRow, NewCard } from '../db/repositories/cards.ts';
import type { NewReviewLog, ReviewLogRow } from '../db/repositories/review-logs.ts';
import { FSRS_RATINGS, FSRS_STATES } from '../db/schema.ts';

export type StateName = (typeof FSRS_STATES)[number];
export type RatingName = (typeof FSRS_RATINGS)[number];

// The name arrays are ordered like the ts-fsrs enums (New = 0 ... Relearning = 3,
// Manual = 0 ... Easy = 4), so index <-> enum value is exact.
export const stateFromName = (name: StateName): State => FSRS_STATES.indexOf(name) as State;
export const stateName = (state: State): StateName => FSRS_STATES[state];
export const ratingFromName = (name: RatingName): Rating => FSRS_RATINGS.indexOf(name) as Rating;
export const ratingName = (rating: Rating): RatingName => FSRS_RATINGS[rating];

const copy = (date: Date) => new Date(date.getTime());

/** The ts-fsrs view of a card row. */
export function toFsrsCard(row: CardRow): Card {
	return {
		due: copy(row.due),
		stability: row.stability,
		difficulty: row.difficulty,
		elapsed_days: row.elapsedDays,
		scheduled_days: row.scheduledDays,
		learning_steps: row.learningSteps,
		reps: row.reps,
		lapses: row.lapses,
		state: stateFromName(row.state),
		last_review: row.lastReview === null ? undefined : copy(row.lastReview)
	};
}

/** `row` with its scheduling fields replaced by `card`'s; identity and item columns are kept. */
export function fromFsrsCard(card: Card, row: CardRow): CardRow {
	return {
		...row,
		due: copy(card.due),
		stability: card.stability,
		difficulty: card.difficulty,
		elapsedDays: card.elapsed_days,
		scheduledDays: card.scheduled_days,
		learningSteps: card.learning_steps,
		reps: card.reps,
		lapses: card.lapses,
		state: stateName(card.state),
		lastReview: card.last_review === undefined || card.last_review === null ? null : copy(card.last_review)
	};
}

/** Scheduling fields for a brand-new card created at `now` (ts-fsrs createEmptyCard). */
export function newCardFields(now: Date): Omit<NewCard, 'kind' | 'lexemeId' | 'sentenceId' | 'grammarTopicId' | 'promptMode'> {
	const card = createEmptyCard(now);
	return {
		due: copy(card.due),
		stability: card.stability,
		difficulty: card.difficulty,
		elapsedDays: card.elapsed_days,
		scheduledDays: card.scheduled_days,
		learningSteps: card.learning_steps,
		reps: card.reps,
		lapses: card.lapses,
		state: stateName(card.state),
		lastReview: null
	};
}

/** The ts-fsrs view of a stored review log. */
export function toFsrsReviewLog(row: ReviewLogRow | NewReviewLog): ReviewLog {
	return {
		rating: ratingFromName(row.rating),
		state: stateFromName(row.state),
		due: copy(row.due),
		stability: row.stability,
		difficulty: row.difficulty,
		elapsed_days: row.elapsedDays,
		last_elapsed_days: row.lastElapsedDays,
		scheduled_days: row.scheduledDays,
		learning_steps: row.learningSteps,
		review: copy(row.review)
	};
}

export type ReviewLogContext = Pick<NewReviewLog, 'cardId' | 'oldS' | 'newS' | 'oldD' | 'newD'>;

/** A review log row from a ts-fsrs log plus the card id and before/after stability and difficulty. */
export function fromFsrsReviewLog(log: ReviewLog, context: ReviewLogContext): NewReviewLog {
	return {
		cardId: context.cardId,
		rating: ratingName(log.rating),
		state: stateName(log.state),
		due: copy(log.due),
		stability: log.stability,
		difficulty: log.difficulty,
		elapsedDays: log.elapsed_days,
		lastElapsedDays: log.last_elapsed_days,
		scheduledDays: log.scheduled_days,
		learningSteps: log.learning_steps,
		review: copy(log.review),
		oldS: context.oldS,
		newS: context.newS,
		oldD: context.oldD,
		newD: context.newD
	};
}
