import { describe, expect, it } from 'vitest';
import { TEST_PROFILE } from '../db/test-db.ts';
import { cardsRepo } from '../db/repositories/cards.ts';
import { learningSettingsRepo, settingsRepo } from '../db/repositories/settings.ts';
import { arrange, capStockNames, composeSession, interleave, itemCount, newItemsWanted, promptMode } from './compose.ts';
import { finishSession, startSession } from './engine.ts';
import { DAY, MINUTE, T0, setup } from './test-fixtures.ts';

describe('itemCount', () => {
	it('is about 20 s per item, capped at 30', () => {
		expect(itemCount(5)).toBe(15);
		expect(itemCount(8)).toBe(24);
		expect(itemCount(10)).toBe(30);
		expect(itemCount(20)).toBe(30);
		expect(itemCount(0.1)).toBe(1);
	});
});

describe('the pure ordering rules', () => {
	it('interleaves one new item after every 3 reviews, leftovers at the end', () => {
		expect(interleave(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'], ['n1', 'n2', 'n3'])).toEqual(['r1', 'r2', 'r3', 'n1', 'r4', 'r5', 'r6', 'n2', 'r7', 'n3']);
		expect(interleave([], ['n1', 'n2'])).toEqual(['n1', 'n2']);
		expect(interleave(['r1', 'r2'], [])).toEqual(['r1', 'r2']);
		expect(newItemsWanted(9, 10, 15)).toBe(6);
		expect(newItemsWanted(30, 10, 15)).toBe(3);
		expect(newItemsWanted(0, 4, 15)).toBe(4);
	});

	it('never puts one sentence twice in a row, nor more than 3 of a gap type in a row', () => {
		const x = (sentenceId: number, gapType: 'lexical' | 'article') => ({ sentenceId, gapType });
		const planned = [x(1, 'lexical'), x(1, 'article'), x(2, 'lexical'), x(3, 'lexical'), x(4, 'lexical'), x(5, 'lexical'), x(6, 'article')];
		const out = arrange(planned);
		expect(out).toHaveLength(planned.length);
		for (let i = 1; i < out.length; i++) expect(out[i].sentenceId).not.toBe(out[i - 1].sentenceId);
		for (let i = 3; i < out.length; i++) expect(new Set(out.slice(i - 3, i + 1).map((o) => o.gapType)).size).toBeGreaterThan(1);
		// Already fine: unchanged.
		const fine = [x(1, 'lexical'), x(2, 'article'), x(3, 'lexical')];
		expect(arrange(fine)).toEqual(fine);
	});

	it('caps stock-name items at 30%, also of a short list', () => {
		const items = Array.from({ length: 20 }, (_, i) => ({ id: i, hasStockNames: i < 6 }));
		const kept = capStockNames(items, 10);
		expect(kept.map((k) => k.id)).toEqual([0, 1, 2, 6, 7, 8, 9, 10, 11, 12]);
		// Too little content: 3 stock of 7 is 43%; dropping cascades until the share holds (1 of 5).
		const short = capStockNames(items.slice(0, 10), 10);
		expect(short.map((k) => k.id)).toEqual([0, 6, 7, 8, 9]);
	});

	it('chooses the mode per card: choice while new, learning or weak; articles always choice', () => {
		expect(promptMode({ state: 'New', stability: 0 }, 'lexical')).toBe('choice');
		expect(promptMode({ state: 'Learning', stability: 10 }, 'lexical')).toBe('choice');
		expect(promptMode({ state: 'Review', stability: 6.9 }, 'lexical')).toBe('choice');
		expect(promptMode({ state: 'Review', stability: 7 }, 'lexical')).toBe('typing');
		expect(promptMode({ state: 'Review', stability: 30 }, 'preposition')).toBe('typing');
		expect(promptMode({ state: 'Review', stability: 30 }, 'article')).toBe('choice');
	});
});

describe('composeSession', () => {
	it('returns the item count for the budget and creates the new cards', () => {
		const { db, addItem } = setup();
		for (let i = 0; i < 40; i++) addItem({ gapType: (['lexical', 'article', 'preposition', 'verb_form'] as const)[i % 4] });
		learningSettingsRepo(db, TEST_PROFILE).update({ newCardsPerDay: 50 });
		const session = composeSession(db, TEST_PROFILE, T0, { budgetMin: 5 });
		expect(session.items).toHaveLength(15);
		expect(session.created).toBe(15);
		expect(session.items.every((i) => i.isNew && i.mode === 'choice')).toBe(true);
		expect(cardsRepo(db, TEST_PROFILE).counts(T0).new).toBe(15);
		// About half lexical; the rest spread over the grammar types.
		const lexical = session.items.filter((i) => i.gapType === 'lexical').length;
		expect(lexical).toBeGreaterThanOrEqual(7);
		expect(lexical).toBeLessThanOrEqual(8);
		expect(new Set(session.items.filter((i) => i.gapType !== 'lexical').map((i) => i.gapType)).size).toBe(3);
	});

	it('fills an item for the client: gap, options, answer, translation and intervals', () => {
		const { db, addItem } = setup();
		addItem({ gapType: 'lexical' });
		const [item] = composeSession(db, TEST_PROFILE, T0, { budgetMin: 5 }).items;
		expect(item).toMatchObject({
			mode: 'choice',
			gapType: 'lexical',
			isNew: true,
			sentenceWithGap: expect.stringMatching(/^The teacher reads a ___ in class number \d+\.$/),
			before: 'The teacher reads a ',
			after: expect.stringMatching(/^ in class/),
			options: ['story', 'table', 'river', 'shoe'],
			answer: 'story',
			filled: expect.stringMatching(/a story in class/),
			viTranslation: expect.stringContaining('(vi)'),
			answerVi: 'câu chuyện'
		});
		expect(item.intervals[1]).toEqual({ value: 1, unit: 'minute' });
		expect(Object.keys(item.intervals)).toEqual(['1', '2', '3', '4']);
	});

	it('respects the daily new-card limit across two sessions in one learning day', () => {
		const { db, addItem } = setup();
		for (let i = 0; i < 20; i++) addItem({ gapType: i % 2 === 0 ? 'lexical' : 'preposition' });
		learningSettingsRepo(db, TEST_PROFILE).update({ newCardsPerDay: 4 });
		const first = startSession(db, TEST_PROFILE, T0, { budgetMin: 5 });
		expect(first.items.filter((i) => i.isNew)).toHaveLength(4);
		// Abandoned (a new start): the same New cards come back, no more are created.
		const again = startSession(db, TEST_PROFILE, new Date(T0.getTime() + MINUTE), { budgetMin: 5 });
		expect(again.items.map((i) => i.cardId).sort()).toEqual(first.items.map((i) => i.cardId).sort());
		expect(cardsRepo(db, TEST_PROFILE).counts(T0).new).toBe(4);
		finishSession(db, TEST_PROFILE, new Date(T0.getTime() + 2 * MINUTE), {
			sessionId: again.sessionId!,
			clientSessionId: 'c1',
			results: again.items.map((i, k) => ({ cardId: i.cardId, correct: true, mode: i.mode, responseMs: 3000, hintUsed: false, answeredOffsetMs: 1000 * (k + 1) }))
		});
		// Later the same learning day: the learning cards are due again, but nothing new.
		const later = startSession(db, TEST_PROFILE, new Date(T0.getTime() + 3 * 3_600_000), { budgetMin: 5 });
		expect(later.items.length).toBeGreaterThan(0);
		expect(later.items.filter((i) => i.isNew)).toEqual([]);
		// The next learning day (04:00 ICT) allows new cards again.
		const tomorrow = startSession(db, TEST_PROFILE, new Date(T0.getTime() + DAY), { budgetMin: 5 });
		expect(tomorrow.items.filter((i) => i.isNew).length).toBe(4);
	});

	it('opens with the 3 most retrievable due cards, then the most overdue, a new card after every 3', () => {
		const { db, addDueCard, addItem } = setup();
		const types = ['lexical', 'preposition', 'verb_form'] as const;
		const due = [5, 1, 9, 2, 7, 3, 8, 4, 6].map((overdueDays, i) => ({ overdueDays, card: addDueCard({ overdueDays, gapType: types[i % 3] }) }));
		for (let i = 0; i < 6; i++) addItem({ gapType: 'article' });
		const { items } = composeSession(db, TEST_PROFILE, T0, { budgetMin: 5 });
		const byId = new Map(due.map((d) => [d.card.id, d.overdueDays]));
		const reviews = items.filter((i) => !i.isNew).map((i) => byId.get(i.cardId));
		expect(reviews.slice(0, 3).sort()).toEqual([1, 2, 3]);
		expect(reviews.slice(3)).toEqual([9, 8, 7, 6, 5, 4]);
		expect(items.map((i) => i.isNew)).toEqual([false, false, false, true, false, false, false, true, false, false, false, true, true, true, true]);
	});

	it('never serves one sentence twice in a row, and no more than 3 of a gap type in a row', () => {
		const { db, addDueCard } = setup();
		for (let s = 0; s < 6; s++) {
			const first = addDueCard({ gapType: 'preposition', overdueDays: s + 1 });
			addDueCard({ gapType: 'verb_form', sentenceId: first.sentenceId!, overdueDays: s + 1 });
		}
		for (let s = 0; s < 4; s++) addDueCard({ gapType: 'lexical', overdueDays: 20 + s });
		const { items } = composeSession(db, TEST_PROFILE, T0, { budgetMin: 10 });
		const sentence = new Map(cardsRepo(db, TEST_PROFILE).byIds(items.map((i) => i.cardId)).map((c) => [c.id, c.sentenceId]));
		expect(items).toHaveLength(16);
		for (let i = 1; i < items.length; i++) expect(sentence.get(items[i].cardId)).not.toBe(sentence.get(items[i - 1].cardId));
		for (let i = 3; i < items.length; i++) expect(new Set(items.slice(i - 3, i + 1).map((x) => x.gapType)).size).toBeGreaterThan(1);
	});

	it('takes at most 30% of the items from stock-name sentences', () => {
		const { db, addDueCard, addItem } = setup();
		for (let i = 0; i < 10; i++) addDueCard({ stock: true, gapType: i % 2 ? 'lexical' : 'preposition', overdueDays: i + 1 });
		for (let i = 0; i < 30; i++) addItem({ gapType: i % 2 ? 'lexical' : 'verb_form', stock: i < 10 });
		learningSettingsRepo(db, TEST_PROFILE).update({ newCardsPerDay: 50 });
		const { items } = composeSession(db, TEST_PROFILE, T0, { budgetMin: 5 });
		const stock = items.filter((i) => i.before.startsWith('Tom') || i.sentenceWithGap.startsWith('Tom'));
		expect(items).toHaveLength(15);
		expect(stock.length).toBeLessThanOrEqual(4);
	});

	it('serves due strong cards as typing, articles as choice', () => {
		const { db, addDueCard } = setup();
		const strong = addDueCard({ gapType: 'lexical', stability: 20 });
		const article = addDueCard({ gapType: 'article', stability: 20 });
		const weak = addDueCard({ gapType: 'preposition', stability: 2 });
		const { items } = composeSession(db, TEST_PROFILE, T0, { budgetMin: 5 });
		const mode = new Map(items.map((i) => [i.cardId, i]));
		expect(mode.get(strong.id)).toMatchObject({ mode: 'typing' });
		expect(mode.get(strong.id)?.options).toBeUndefined();
		expect(mode.get(article.id)?.mode).toBe('choice');
		expect(mode.get(weak.id)?.mode).toBe('choice');
		expect(cardsRepo(db, TEST_PROFILE).byId(strong.id)?.promptMode).toBe('typing');
	});

	it('says why a session is empty', () => {
		const empty = setup();
		expect(composeSession(empty.db, TEST_PROFILE, T0, { budgetMin: 5 })).toEqual({ items: [], created: 0, reason: 'no_content' });
		const done = setup();
		done.addItem();
		learningSettingsRepo(done.db, TEST_PROFILE).update({ newCardsPerDay: 0 });
		expect(composeSession(done.db, TEST_PROFILE, T0, { budgetMin: 5 })).toMatchObject({ items: [], reason: 'all_done' });
	});
});

describe('homeCounts', () => {
	it('counts the cloze items a session would introduce, within the daily limit', async () => {
		const { homeCounts } = await import('./counts.ts');
		const { db, addItem, addDueCard } = setup();
		for (let i = 0; i < 6; i++) addItem({ band: 1 });
		addItem({ band: 5 }); // above known_band_ceiling + 1
		addDueCard();
		learningSettingsRepo(db, TEST_PROFILE).update({ newCardsPerDay: 4 });
		expect(homeCounts(db, TEST_PROFILE, T0)).toEqual({ due: 1, newAvailableToday: 4, learning: 0 });
		learningSettingsRepo(db, TEST_PROFILE).update({ newCardsPerDay: 50 });
		expect(homeCounts(db, TEST_PROFILE, T0).newAvailableToday).toBe(6);
	});
});
