import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { cardsRepo, type CardRow } from '../db/repositories/cards.ts';
import { reviewLogsRepo } from '../db/repositories/review-logs.ts';
import {
	fromFsrsCard,
	fromFsrsReviewLog,
	ratingFromName,
	ratingName,
	stateFromName,
	stateName,
	toFsrsCard,
	toFsrsReviewLog
} from './mapping.ts';
import { review } from './review.ts';
import { MINUTE, NO_FUZZ, T0, addNewCard, setupDb } from './test-helpers.ts';

describe('mapping', () => {
	it('round-trips cards losslessly in every state', () => {
		const db = setupDb();
		const id = addNewCard(db).id;
		const states: Record<string, CardRow> = { New: cardsRepo(db).byId(id)! };
		const steps: [Rating.Again | Rating.Good, number][] = [
			[Rating.Again, 0], // New -> Learning
			[Rating.Good, 1], // Learning -> Learning (10m step)
			[Rating.Good, 11], // -> Review
			[Rating.Again, 3 * 24 * 60] // Review -> Relearning
		];
		for (const [rating, minutes] of steps) {
			const at = new Date(T0.getTime() + minutes * MINUTE);
			const { card } = review(db, id, rating, at, at, NO_FUZZ);
			states[card.state] ??= card;
		}
		expect(Object.keys(states).sort()).toEqual(['Learning', 'New', 'Relearning', 'Review']);
		for (const row of Object.values(states)) {
			expect(fromFsrsCard(toFsrsCard(row), row)).toEqual(row);
		}
		// Every review log round-trips too.
		for (const { id: logId, ...log } of reviewLogsRepo(db).forCard(id)) {
			expect(logId).toBeGreaterThan(0);
			expect(fromFsrsReviewLog(toFsrsReviewLog(log), log)).toEqual(log);
		}
	});

	it('does not share Date objects with its input', () => {
		const row = addNewCard(setupDb());
		const card = toFsrsCard(row);
		card.due.setTime(0);
		expect(row.due.getTime()).toBe(T0.getTime());
	});

	it('maps enum names to the ts-fsrs numbers and back', () => {
		expect(stateFromName('Relearning')).toBe(3);
		expect(stateName(stateFromName('Review'))).toBe('Review');
		expect(ratingFromName('Easy')).toBe(Rating.Easy);
		expect(ratingName(Rating.Manual)).toBe('Manual');
	});
});
