import { Rating } from 'ts-fsrs';
import { TEST_PROFILE } from '../db/test-db.ts';
import { describe, expect, it } from 'vitest';
import { learningSettingsRepo, settingsRepo } from '../db/repositories/settings.ts';
import { buildQueue, counts, learningDayStart } from './queue.ts';
import { review } from './review.ts';
import { DAY, MINUTE, NO_FUZZ, T0, addNewCard, setupDb } from './test-helpers.ts';

/** A UTC instant from a wall-clock time in Asia/Ho_Chi_Minh (UTC+7). */
const ict = (local: string) => new Date(`${local}+07:00`);

describe('learningDayStart', () => {
	it('starts the day at 04:00 ICT: 03:59 and 04:00 are different days', () => {
		expect(learningDayStart(ict('2026-10-05T03:59:59'))).toEqual(ict('2026-10-04T04:00:00'));
		expect(learningDayStart(ict('2026-10-05T04:00:00'))).toEqual(ict('2026-10-05T04:00:00'));
	});

	it('keeps late-night study on the evening before: 23:30 and 03:00 next day are the same day', () => {
		const evening = learningDayStart(ict('2026-10-05T23:30:00'));
		expect(learningDayStart(ict('2026-10-06T03:00:00'))).toEqual(evening);
		expect(evening).toEqual(ict('2026-10-05T04:00:00'));
	});

	it('works across a month boundary', () => {
		expect(learningDayStart(ict('2026-11-01T02:30:00'))).toEqual(ict('2026-10-31T04:00:00'));
		expect(learningDayStart(ict('2026-11-01T04:30:00'))).toEqual(ict('2026-11-01T04:00:00'));
	});

	it('is 21:00 UTC', () => {
		expect(learningDayStart(new Date('2026-10-05T12:00:00Z')).toISOString()).toBe('2026-10-04T21:00:00.000Z');
	});
});

describe('buildQueue', () => {
	it('puts due cards first, most overdue first, then new cards', () => {
		const db = setupDb();
		const [a, b, c] = [addNewCard(db), addNewCard(db), addNewCard(db)];
		addNewCard(db);
		review(db, TEST_PROFILE, a.id, Rating.Good, T0, T0, NO_FUZZ); // due T0 + 10 min
		review(db, TEST_PROFILE, b.id, Rating.Again, T0, T0, NO_FUZZ); // due T0 + 1 min
		const now = new Date(T0.getTime() + 30 * MINUTE);
		const queue = buildQueue(db, TEST_PROFILE, now, { reviewLimit: 10, newLimit: 10 });
		expect(queue.cards.slice(0, 2).map((x) => x.id)).toEqual([b.id, a.id]);
		expect(queue.cards.slice(2).every((x) => x.state === 'New')).toBe(true);
		expect(queue).toMatchObject({ dueCount: 2, newCount: 2, introducedToday: 2 });
		expect(queue.cards[2].id).toBe(c.id);
		expect(buildQueue(db, TEST_PROFILE, now, { reviewLimit: 1, newLimit: 2 }).cards.map((x) => x.id)).toEqual([b.id]);
	});

	it('stops new cards after the daily limit and allows them again the next learning day', () => {
		const db = setupDb();
		const cards = Array.from({ length: 25 }, () => addNewCard(db));
		const morning = ict('2026-10-05T08:00:00');
		cards.slice(0, 10).forEach((card, i) => {
			const at = new Date(morning.getTime() + i * MINUTE);
			review(db, TEST_PROFILE, card.id, Rating.Good, at, at, NO_FUZZ);
		});
		const lateNight = ict('2026-10-06T03:30:00'); // still the 2026-10-05 learning day
		const today = buildQueue(db, TEST_PROFILE, lateNight, { reviewLimit: 0, newLimit: 10 });
		expect(today).toMatchObject({ newCount: 0, introducedToday: 10 });

		const tomorrow = buildQueue(db, TEST_PROFILE, ict('2026-10-06T04:00:00'), { reviewLimit: 0, newLimit: 10 });
		expect(tomorrow).toMatchObject({ newCount: 10, introducedToday: 0 });
		expect(tomorrow.cards.map((c) => c.id)).toEqual(cards.slice(10, 20).map((c) => c.id));
	});

	it('counts a card as introduced once, by its first review only', () => {
		const db = setupDb();
		const card = addNewCard(db);
		review(db, TEST_PROFILE, card.id, Rating.Again, T0, T0, NO_FUZZ);
		const later = new Date(T0.getTime() + 2 * MINUTE);
		review(db, TEST_PROFILE, card.id, Rating.Good, later, later, NO_FUZZ); // pre-review state Learning
		expect(buildQueue(db, TEST_PROFILE, later, { reviewLimit: 0, newLimit: 5 }).introducedToday).toBe(1);
	});
});

describe('counts', () => {
	it('reports due, new available today and learning, using the setting by default', () => {
		const db = setupDb();
		expect(learningSettingsRepo(db, TEST_PROFILE).get().newCardsPerDay).toBe(10);
		const cards = Array.from({ length: 4 }, () => addNewCard(db));
		review(db, TEST_PROFILE, cards[0].id, Rating.Again, T0, T0, NO_FUZZ);
		const now = new Date(T0.getTime() + 5 * MINUTE);
		expect(counts(db, TEST_PROFILE, now)).toEqual({ due: 1, newAvailableToday: 3, learning: 1 });
		learningSettingsRepo(db, TEST_PROFILE).update({ newCardsPerDay: 2 });
		expect(counts(db, TEST_PROFILE, now)).toEqual({ due: 1, newAvailableToday: 1, learning: 1 });
		expect(counts(db, TEST_PROFILE, now, 0).newAvailableToday).toBe(0);
		expect(counts(db, TEST_PROFILE, new Date(now.getTime() + DAY)).newAvailableToday).toBe(2);
	});
});
