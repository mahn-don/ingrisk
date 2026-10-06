import { type Grade, Rating } from 'ts-fsrs';
import { TEST_PROFILE } from '../db/test-db.ts';
import { describe, expect, it } from 'vitest';
import { cardsRepo } from '../db/repositories/cards.ts';
import { reviewLogsRepo } from '../db/repositories/review-logs.ts';
import { learningSettingsRepo, settingsRepo } from '../db/repositories/settings.ts';
import { CardNotFoundError, InvalidRatingError, ReviewTimeError } from './errors.ts';
import { review, reviewBatch } from './review.ts';
import { DAY, MINUTE, NO_FUZZ, T0, addNewCard, setupDb } from './test-helpers.ts';
import type { Db } from '../db/client.ts';

/** Review at each due time; returns the interval (due - review time, ms) after every step. */
function runAtDueTimes(db: Db, cardId: number, ratings: Grade[]) {
	let at = cardsRepo(db, TEST_PROFILE).byId(cardId)!.due;
	return ratings.map((rating) => {
		const { card, log } = review(db, TEST_PROFILE, cardId, rating, at, at, NO_FUZZ);
		const interval = card.due.getTime() - at.getTime();
		at = card.due;
		return { card, log, interval };
	});
}

describe('interval growth', () => {
	it('Again, Good, Good, Easy: success never shrinks the interval and the card graduates', () => {
		const db = setupDb();
		const id = addNewCard(db).id;
		const steps = runAtDueTimes(db, id, [Rating.Again, Rating.Good, Rating.Good, Rating.Easy]);
		expect(steps.map((s) => s.card.state)).toEqual(['Learning', 'Learning', 'Review', 'Review']);
		expect(steps[0].interval).toBe(1 * MINUTE);
		expect(steps[1].interval).toBe(10 * MINUTE);
		for (let i = 2; i < steps.length; i++) {
			expect(steps[i].interval).toBeGreaterThanOrEqual(steps[i - 1].interval);
		}
		expect(steps[3].interval).toBeGreaterThan(steps[2].interval);
		expect(steps[2].interval).toBeGreaterThanOrEqual(DAY);
	});

	it('a lapse on a long-interval card relearns with a far shorter interval', () => {
		const db = setupDb();
		const id = addNewCard(db).id;
		const goods = runAtDueTimes(db, id, [Rating.Good, Rating.Good, Rating.Good, Rating.Good, Rating.Good]);
		const before = goods.at(-1)!;
		expect(before.card.state).toBe('Review');
		expect(before.interval).toBeGreaterThan(30 * DAY);

		const [lapse] = runAtDueTimes(db, id, [Rating.Again]);
		expect(lapse.card.state).toBe('Relearning');
		expect(lapse.card.lapses).toBe(1);
		expect(lapse.interval).toBe(10 * MINUTE);
		expect(lapse.card.stability).toBeLessThan(before.card.stability / 4);
	});
});

describe('retention setting', () => {
	it('a lower desired retention gives a longer next interval for the same history', () => {
		const intervalWith = (retention: number) => {
			const db = setupDb();
			learningSettingsRepo(db, TEST_PROFILE).update({ desiredRetention: retention });
			const id = addNewCard(db).id;
			return runAtDueTimes(db, id, [Rating.Good, Rating.Good, Rating.Good, Rating.Good]).at(-1)!.interval;
		};
		expect(intervalWith(0.8)).toBeGreaterThan(intervalWith(0.95));
	});
});

describe('persistence', () => {
	it('writes exactly one log with the stability and difficulty before and after', () => {
		const db = setupDb();
		const id = addNewCard(db).id;
		const first = review(db, TEST_PROFILE, id, Rating.Good, T0, T0, NO_FUZZ);
		const at = first.card.due;
		const { card, log } = review(db, TEST_PROFILE, id, Rating.Good, at, at, NO_FUZZ);
		const logs = reviewLogsRepo(db, TEST_PROFILE).forCard(id);
		expect(logs).toHaveLength(2);
		expect(logs[1]).toEqual(log);
		expect(log).toMatchObject({
			cardId: id,
			rating: 'Good',
			state: 'Learning', // state before the review
			review: at,
			oldS: first.card.stability,
			oldD: first.card.difficulty,
			newS: card.stability,
			newD: card.difficulty
		});
		expect(cardsRepo(db, TEST_PROFILE).byId(id)).toEqual(card);
	});

	it('rolls back the whole batch when one review fails', () => {
		const db = setupDb();
		const a = addNewCard(db).id;
		const b = addNewCard(db).id;
		expect(() =>
			reviewBatch(
				db,
				TEST_PROFILE,
				[
					{ cardId: a, rating: Rating.Good, reviewedAt: T0 },
					{ cardId: b, rating: Rating.Good, reviewedAt: new Date(T0.getTime() + MINUTE) },
					{ cardId: 9999, rating: Rating.Good, reviewedAt: new Date(T0.getTime() + 2 * MINUTE) }
				],
				T0,
				NO_FUZZ
			)
		).toThrow(CardNotFoundError);
		expect(reviewLogsRepo(db, TEST_PROFILE).forCard(a)).toEqual([]);
		expect(reviewLogsRepo(db, TEST_PROFILE).forCard(b)).toEqual([]);
		expect(cardsRepo(db, TEST_PROFILE).byId(a)?.state).toBe('New');
	});

	it('applies out-of-order input in chronological order', () => {
		const db = setupDb();
		const id = addNewCard(db).id;
		const t1 = T0;
		const t2 = new Date(T0.getTime() + 10 * MINUTE);
		const t3 = new Date(T0.getTime() + 2 * DAY);
		// Applied as given, t3 then t1 would fail the "before last review" check.
		const results = reviewBatch(
			db,
			TEST_PROFILE,
			[
				{ cardId: id, rating: Rating.Good, reviewedAt: t3 },
				{ cardId: id, rating: Rating.Good, reviewedAt: t1 },
				{ cardId: id, rating: Rating.Again, reviewedAt: t2 }
			],
			t3,
			NO_FUZZ
		);
		expect(results.map((r) => r.log.review)).toEqual([t1, t2, t3]);
		expect(reviewLogsRepo(db, TEST_PROFILE).forCard(id).map((l) => l.rating)).toEqual(['Good', 'Again', 'Good']);
	});

	it('works inside a caller transaction and rolls back with it', () => {
		const db = setupDb();
		const id = addNewCard(db).id;
		expect(() =>
			db.transaction((tx) => {
				review(tx, TEST_PROFILE, id, Rating.Good, T0, T0, NO_FUZZ);
				throw new Error('session write failed');
			})
		).toThrow('session write failed');
		expect(reviewLogsRepo(db, TEST_PROFILE).forCard(id)).toEqual([]);
	});
});

describe('timestamps and input checks', () => {
	it('rejects a review earlier than the last review', () => {
		const db = setupDb();
		const id = addNewCard(db).id;
		review(db, TEST_PROFILE, id, Rating.Good, T0, T0, NO_FUZZ);
		const earlier = new Date(T0.getTime() - 1);
		const error = (() => {
			try {
				review(db, TEST_PROFILE, id, Rating.Good, earlier, T0, NO_FUZZ);
			} catch (e) {
				return e;
			}
		})();
		expect(error).toBeInstanceOf(ReviewTimeError);
		expect(error).toMatchObject({ problem: 'before_last_review', code: 'review_before_last_review' });
		expect(reviewLogsRepo(db, TEST_PROFILE).forCard(id)).toHaveLength(1);
	});

	it('rejects a review more than 5 minutes in the future, accepts exactly 5', () => {
		const db = setupDb();
		const id = addNewCard(db).id;
		const tooLate = new Date(T0.getTime() + 5 * MINUTE + 1);
		expect(() => review(db, TEST_PROFILE, id, Rating.Good, tooLate, T0, NO_FUZZ)).toThrow(
			expect.objectContaining({ problem: 'in_future' })
		);
		expect(review(db, TEST_PROFILE, id, Rating.Good, new Date(T0.getTime() + 5 * MINUTE), T0, NO_FUZZ).log).toBeDefined();
	});

	it('rejects a missing card and a Manual rating with typed errors', () => {
		const db = setupDb();
		const id = addNewCard(db).id;
		expect(() => review(db, TEST_PROFILE, 12345, Rating.Good, T0, T0)).toThrow(CardNotFoundError);
		expect(() => review(db, TEST_PROFILE, id, Rating.Manual as unknown as Grade, T0, T0)).toThrow(InvalidRatingError);
	});
});
