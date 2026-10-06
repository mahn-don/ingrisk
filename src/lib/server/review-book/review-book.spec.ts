import { describe, expect, it } from 'vitest';
import { TEST_PROFILE } from '../db/test-db.ts';
import { type CardRow, cardsRepo } from '../db/repositories/cards.ts';
import { reviewLogsRepo } from '../db/repositories/review-logs.ts';
import { buildFormIndex } from '../generation/forms.ts';
import { finishSession, startSession } from '../session/engine.ts';
import { mineErrors } from '../session/mining.ts';
import { DAY, MINUTE, T0, setup } from '../session/test-fixtures.ts';
import { cardDetail, hardList, learnedList, nextReview, reviewNow, setSuspended } from './index.ts';

const forms = buildFormIndex([{ id: 1, headword: 'go', forms: ['go', 'goes', 'went', 'gone', 'going'], freqBand: 1, ngslRank: 1 }]);
const mine = (db: ReturnType<typeof setup>['db']) =>
	mineErrors(
		db,
		TEST_PROFILE,
		{ correctedText: 'Yesterday I went to school.', errors: [{ original: 'goed', correction: 'went', topic_code: 'TNS', explanation_vi: 'Quá khứ của go là went.' }], viText: 'Hôm qua tôi đi học.', levelBand: 1 },
		T0,
		forms
	);

describe('nextReview', () => {
	const card = (patch: Partial<CardRow>) => ({ state: 'Review', suspended: false, due: T0, ...patch }) as CardRow;
	it('words the next review plainly', () => {
		const now = new Date(T0.getTime() - MINUTE);
		expect(nextReview(card({ state: 'New' }), now)).toEqual({ kind: 'new' });
		expect(nextReview(card({ suspended: true }), now)).toEqual({ kind: 'suspended' });
		expect(nextReview(card({ due: new Date(now.getTime() - 1) }), now)).toEqual({ kind: 'now' });
		expect(nextReview(card({}), now)).toEqual({ kind: 'today' });
		expect(nextReview(card({ due: new Date(T0.getTime() + DAY) }), now)).toEqual({ kind: 'tomorrow' });
		expect(nextReview(card({ due: new Date(T0.getTime() + 9 * DAY) }), now)).toEqual({ kind: 'days', n: 9 });
		expect(nextReview(card({ due: new Date(T0.getTime() + 90 * DAY) }), now)).toEqual({ kind: 'months', n: 3 });
	});
});

describe('review book', () => {
	it('"Hay sai": lapses first, then the weakest; mined errors always in, tagged', () => {
		const fx = setup();
		const save = (card: CardRow, lapses: number, stability: number) => cardsRepo(fx.db, TEST_PROFILE).save({ ...card, lapses, stability });
		const a = save(fx.addDueCard({ gapType: 'lexical' }), 1, 20);
		const b = save(fx.addDueCard({ gapType: 'article' }), 3, 5);
		const c = save(fx.addDueCard({ gapType: 'preposition' }), 1, 1);
		fx.addDueCard({ gapType: 'verb_form' }); // never lapsed: not listed
		mine(fx.db);
		const rows = hardList(fx.db, TEST_PROFILE, T0);
		expect(rows.map((r) => r.cardId).slice(0, 3)).toEqual([b.id, c.id, a.id]);
		expect(rows).toHaveLength(4);
		expect(rows[3]).toMatchObject({ mined: true, answer: 'went', next: { kind: 'new' } });
	});

	it('"Đã học": every introduced card, searchable by English, answer or Vietnamese', () => {
		const fx = setup();
		const a = fx.addDueCard({ gapType: 'lexical' });
		const b = fx.addDueCard({ gapType: 'preposition', overdueDays: 2 });
		fx.addItem(); // never introduced
		expect(learnedList(fx.db, TEST_PROFILE, T0, '').map((r) => r.cardId)).toEqual([b.id, a.id]);
		expect(learnedList(fx.db, TEST_PROFILE, T0, 'STORY').map((r) => r.cardId)).toEqual([b.id, a.id]); // English, any case
		expect(learnedList(fx.db, TEST_PROFILE, T0, 'câu chuyện').map((r) => r.cardId)).toEqual([a.id]); // answer_vi
		expect(learnedList(fx.db, TEST_PROFILE, T0, '(VI)').map((r) => r.cardId)).toEqual([b.id, a.id]); // the Vietnamese sentence
		expect(learnedList(fx.db, TEST_PROFILE, T0, 'zebra')).toEqual([]);
		expect(learnedList(fx.db, TEST_PROFILE, T0, '100%')).toEqual([]);
		expect(learnedList(fx.db, TEST_PROFILE, T0, '_')).toEqual([]);
	});

	it('the detail: sentence parts, source, history with the interval each review set', () => {
		const fx = setup();
		const card = fx.addDueCard({ gapType: 'preposition' });
		const start = startSession(fx.db, TEST_PROFILE, T0, { budgetMin: 5 });
		const item = start.items.find((i) => i.cardId === card.id)!;
		finishSession(fx.db, TEST_PROFILE, new Date(T0.getTime() + MINUTE), {
			sessionId: start.sessionId!,
			clientSessionId: 'book-detail-1',
			results: [{ cardId: card.id, correct: true, mode: item.mode, responseMs: 3000, hintUsed: false, answeredOffsetMs: 1000 }]
		});
		const detail = cardDetail(fx.db, TEST_PROFILE, new Date(T0.getTime() + MINUTE), card.id)!;
		expect(detail).toMatchObject({ answer: 'in', before: expect.stringMatching(/story $/), after: expect.stringMatching(/^ class/), source: 'llm', topicCode: 'PRE', gapType: 'preposition' });
		expect(detail.history).toHaveLength(1);
		const after = cardsRepo(fx.db, TEST_PROFILE).byId(card.id)!;
		const days = Math.round((after.due.getTime() - (T0.getTime() + 1000)) / DAY);
		expect(detail.history[0]).toMatchObject({ rating: expect.any(String), interval: { unit: 'day', value: days } });
		expect(cardDetail(fx.db, TEST_PROFILE, T0, 9999)).toBeNull();
		const minedDetail = (() => {
			mine(fx.db);
			const mined = hardList(fx.db, TEST_PROFILE, T0).find((r) => r.mined)!;
			return cardDetail(fx.db, TEST_PROFILE, T0, mined.cardId)!;
		})();
		expect(minedDetail).toMatchObject({ source: 'user', answer: 'went', answerVi: 'Quá khứ của go là went.', history: [] });
	});

	it('"Ôn ngay" makes a card due now; "Tạm ẩn" hides it (history kept), "Bỏ ẩn" brings it back', () => {
		const fx = setup();
		const card = fx.addDueCard({ overdueDays: -2 });
		expect(startSession(fx.db, TEST_PROFILE, T0).items).toEqual([]);
		expect(reviewNow(fx.db, TEST_PROFILE, T0, card.id)).toBe(true);
		expect(startSession(fx.db, TEST_PROFILE, T0).items.map((i) => i.cardId)).toEqual([card.id]);
		expect(setSuspended(fx.db, TEST_PROFILE, card.id, true)).toBe(true);
		expect(hardList(fx.db, TEST_PROFILE, T0)).toEqual([]);
		expect(learnedList(fx.db, TEST_PROFILE, T0, '')[0]).toMatchObject({ suspended: true, next: { kind: 'suspended' } });
		expect(startSession(fx.db, TEST_PROFILE, new Date(T0.getTime() + MINUTE)).items).toEqual([]);
		expect(reviewLogsRepo(fx.db, TEST_PROFILE).forCard(card.id)).toEqual([]);
		expect(setSuspended(fx.db, TEST_PROFILE, card.id, false)).toBe(true);
		expect(startSession(fx.db, TEST_PROFILE, new Date(T0.getTime() + 2 * MINUTE)).items.map((i) => i.cardId)).toEqual([card.id]);
		expect(reviewNow(fx.db, TEST_PROFILE, T0, 9999)).toBe(false);
	});
});
