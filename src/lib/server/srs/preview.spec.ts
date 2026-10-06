import { Rating } from 'ts-fsrs';
import { TEST_PROFILE } from '../db/test-db.ts';
import { describe, expect, it } from 'vitest';
import { cardsRepo } from '../db/repositories/cards.ts';
import { describeInterval, previewIntervals } from './preview.ts';
import { review } from './review.ts';
import { createScheduler } from './scheduler.ts';
import { DAY, MINUTE, NO_FUZZ, T0, addNewCard, setupDb } from './test-helpers.ts';

describe('describeInterval', () => {
	it.each([
		[1 * MINUTE, { value: 1, unit: 'minute' }],
		[59 * MINUTE, { value: 59, unit: 'minute' }],
		[60 * MINUTE, { value: 1, unit: 'hour' }],
		[23 * 60 * MINUTE, { value: 23, unit: 'hour' }],
		[1 * DAY, { value: 1, unit: 'day' }],
		[29 * DAY, { value: 29, unit: 'day' }],
		[45 * DAY, { value: 1.5, unit: 'month' }],
		[365 * DAY, { value: 1, unit: 'year' }],
		[730 * DAY, { value: 2, unit: 'year' }]
	])('%d ms', (ms, expected) => {
		expect(describeInterval(ms)).toEqual(expected);
	});
});

describe('previewIntervals', () => {
	it('gives the four ratings for a new card without changing it', () => {
		const db = setupDb();
		const card = addNewCard(db);
		const preview = previewIntervals(card, T0, createScheduler({ desiredRetention: 0.9 }, NO_FUZZ));
		expect(preview.map((p) => p.rating)).toEqual([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]);
		expect(preview[0].interval).toEqual({ value: 1, unit: 'minute' });
		expect(preview[2].interval).toEqual({ value: 10, unit: 'minute' });
		expect(preview[3].interval.unit).toBe('day');
		expect(cardsRepo(db, TEST_PROFILE).byId(card.id)).toEqual(card);
	});

	it('matches what review() then does', () => {
		const db = setupDb();
		const id = addNewCard(db).id;
		review(db, TEST_PROFILE, id, Rating.Good, T0, T0, NO_FUZZ);
		const card = cardsRepo(db, TEST_PROFILE).byId(id)!;
		const preview = previewIntervals(card, card.due, createScheduler({ desiredRetention: 0.9 }, NO_FUZZ));
		const { card: after } = review(db, TEST_PROFILE, id, Rating.Good, card.due, card.due, NO_FUZZ);
		expect(preview[2].due).toEqual(after.due);
	});
});
