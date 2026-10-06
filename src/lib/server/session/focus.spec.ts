import { describe, expect, it } from 'vitest';
import { TEST_PROFILE } from '../db/test-db.ts';
import { cacheRepo } from '../db/repositories/cache.ts';
import { type CardRow, cardsRepo } from '../db/repositories/cards.ts';
import { reviewLogsRepo } from '../db/repositories/review-logs.ts';
import { counts } from '../srs/index.ts';
import type { SessionItem } from '../../session/types.ts';
import { homeCounts } from './counts.ts';
import { SessionError, finishSession, startSession } from './engine.ts';
import { HARD_FOCUS_CARDS, byHardness, byTopicPriority } from './focus.ts';
import { StartBody } from './http.ts';
import { DAY, MINUTE, T0, setup } from './test-fixtures.ts';

const at = (ms: number) => new Date(T0.getTime() + ms);
const ids = (items: readonly SessionItem[]) => items.map((i) => i.cardId).sort((a, b) => a - b);
const withLapses = (db: ReturnType<typeof setup>['db'], card: CardRow, lapses: number) => cardsRepo(db, TEST_PROFILE).save({ ...card, lapses });

describe('ordering', () => {
	const row = (id: number, lapses: number, dueDays = 0) => ({ card: { id, lapses, due: new Date(T0.getTime() + dueDays * DAY) } as CardRow });
	const r = (values: Record<number, number>) => (card: CardRow) => values[card.id];

	it('hardest first: most lapses, then the lowest retrievability', () => {
		const rows = [row(1, 0), row(2, 3), row(3, 1), row(4, 3)];
		expect(byHardness(rows, r({ 1: 0.2, 2: 0.9, 3: 0.5, 4: 0.4 })).map((x) => x.card.id)).toEqual([4, 2, 3, 1]);
	});

	it('a topic: due cards first (most overdue first), then the lowest retrievability', () => {
		const rows = [row(1, 0, 3), row(2, 0, -1), row(3, 0, 5), row(4, 0, -4)];
		expect(byTopicPriority(rows, T0, r({ 1: 0.9, 2: 0.5, 3: 0.6, 4: 0.5 })).map((x) => x.card.id)).toEqual([4, 2, 3, 1]);
	});
});

describe('focus sessions', () => {
	it('hard: the 15 hardest non-suspended cards, due or not, and nothing new', () => {
		const fx = setup();
		const cards = Array.from({ length: 20 }, (_, k) => withLapses(fx.db, fx.addDueCard({ gapType: 'lexical', overdueDays: k % 2 === 0 ? 2 : -2 }), k));
		cardsRepo(fx.db, TEST_PROFILE).setSuspended(cards[19].id, true);
		fx.addItem({ gapType: 'lexical' }); // a new-card candidate: never in a focus session
		const start = startSession(fx.db, TEST_PROFILE, T0, { focus: { kind: 'hard' } });
		expect(start).toMatchObject({ shape: 'quick', drills: [], anchor: null });
		expect(start.items).toHaveLength(HARD_FOCUS_CARDS);
		// Lapses 18 down to 4 (19 is suspended).
		expect(ids(start.items)).toEqual(cards.slice(4, 19).map((c) => c.id));
		expect(start.items.every((i) => !i.isNew)).toBe(true);
	});

	it('topic: only that grammar topic, plus its cached drills', () => {
		const fx = setup();
		const art = [fx.addDueCard({ gapType: 'article' }), fx.addDueCard({ gapType: 'article', overdueDays: -2 })];
		fx.addDueCard({ gapType: 'preposition' });
		fx.addDueCard({ gapType: 'lexical' });
		const drills = [fx.addDrill('ART'), fx.addDrill('ART'), fx.addDrill('ART')];
		const pre = fx.addDrill('PRE');
		const start = startSession(fx.db, TEST_PROFILE, T0, { focus: { kind: 'topic', code: 'ART' } });
		expect(start.shape).toBe('quick');
		expect(ids(start.items)).toEqual(art.map((c) => c.id));
		expect(start.drills.map((d) => d.topicCode)).toEqual(['ART', 'ART']);
		expect(drills.map((d) => d.id)).toEqual(expect.arrayContaining(start.drills.map((d) => d.cacheId)));
		expect(cacheRepo(fx.db).byId(pre.id)?.servedAt).toBeNull();
		// The results are applied like any session's.
		const summary = finishSession(fx.db, TEST_PROFILE, at(MINUTE), {
			sessionId: start.sessionId!,
			clientSessionId: 'focus-topic-1',
			results: start.items.map((i, k) => ({ cardId: i.cardId, correct: true, mode: i.mode, responseMs: 3000, hintUsed: false, answeredOffsetMs: 1000 * (k + 1) })),
			drills: start.drills.map((d) => ({ cacheId: d.cacheId, correct: true, responseMs: 3000 }))
		});
		expect(summary).toMatchObject({ answered: 2, drillsTotal: 2, drillsCorrect: 2 });
	});

	it('an empty focus says so', () => {
		const fx = setup();
		fx.addDueCard({ gapType: 'lexical' });
		expect(startSession(fx.db, TEST_PROFILE, T0, { focus: { kind: 'topic', code: 'SVA' } })).toMatchObject({ sessionId: null, reason: 'focus_empty' });
	});

	it('an invalid focus is rejected', () => {
		expect(StartBody.safeParse({ focus: { kind: 'hard' } }).success).toBe(true);
		expect(StartBody.safeParse({ focus: { kind: 'topic', code: 'ART' } }).success).toBe(true);
		expect(StartBody.safeParse({ focus: { kind: 'topic', code: 'XYZ' } }).success).toBe(false);
		expect(StartBody.safeParse({ focus: { kind: 'topic' } }).success).toBe(false);
		expect(StartBody.safeParse({ focus: { kind: 'easy' } }).success).toBe(false);
		expect(StartBody.safeParse({ focus: { kind: 'hard', code: 'ART' } }).success).toBe(false);
		const fx = setup();
		expect(() => startSession(fx.db, TEST_PROFILE, T0, { focus: { kind: 'hard' }, shape: 'read' })).toThrow(SessionError);
	});
});

describe('suspension', () => {
	it('takes a card out of every queue and count, and keeps its history', () => {
		const fx = setup();
		const kept = fx.addDueCard({ gapType: 'lexical' });
		const hidden = fx.addDueCard({ gapType: 'preposition' });
		const first = startSession(fx.db, TEST_PROFILE, T0, { budgetMin: 5 });
		finishSession(fx.db, TEST_PROFILE, at(MINUTE), {
			sessionId: first.sessionId!,
			clientSessionId: 'suspend-1',
			results: first.items.map((i, k) => ({ cardId: i.cardId, correct: false, mode: i.mode, responseMs: 3000, hintUsed: false, answeredOffsetMs: 1000 * (k + 1) }))
		});
		const later = at(3 * DAY);
		expect(counts(fx.db, TEST_PROFILE, later, 0).due).toBe(2);

		expect(cardsRepo(fx.db, TEST_PROFILE).setSuspended(hidden.id, true)).toBe(true);
		expect(counts(fx.db, TEST_PROFILE, later, 0).due).toBe(1);
		expect(homeCounts(fx.db, TEST_PROFILE, later).due).toBe(1);
		expect(cardsRepo(fx.db, TEST_PROFILE).introducedDue()).toHaveLength(1);
		const next = startSession(fx.db, TEST_PROFILE, later, { budgetMin: 5 });
		expect(ids(next.items)).toEqual([kept.id]);
		expect(ids(startSession(fx.db, TEST_PROFILE, later, { focus: { kind: 'hard' } }).items)).toEqual([kept.id]);
		expect(reviewLogsRepo(fx.db, TEST_PROFILE).forCard(hidden.id)).toHaveLength(1);

		cardsRepo(fx.db, TEST_PROFILE).setSuspended(hidden.id, false);
		expect(counts(fx.db, TEST_PROFILE, later, 0).due).toBe(2);
	});
});
