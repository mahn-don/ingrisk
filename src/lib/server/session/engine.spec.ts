import { describe, expect, it } from 'vitest';
import { cardsRepo } from '../db/repositories/cards.ts';
import { reviewLogsRepo } from '../db/repositories/review-logs.ts';
import { sessionsRepo } from '../db/repositories/sessions.ts';
import type { SessionItem, SessionResult } from '../../session/types.ts';
import { finishSession, startSession } from './engine.ts';
import { MINUTE, T0, setup } from './test-fixtures.ts';

const at = (ms: number) => new Date(T0.getTime() + ms);
const result = (item: SessionItem, offset: number, extra: Partial<SessionResult> = {}): SessionResult => ({
	cardId: item.cardId,
	correct: true,
	mode: item.mode,
	responseMs: 4000,
	hintUsed: false,
	answeredOffsetMs: offset,
	...extra
});

/** A started session with 3 due cards (one strong) and 2 new ones. */
function started() {
	const fx = setup();
	fx.addDueCard({ gapType: 'lexical', stability: 20, overdueDays: 2 });
	fx.addDueCard({ gapType: 'preposition', overdueDays: 1 });
	fx.addDueCard({ gapType: 'verb_form', overdueDays: 3 });
	fx.addItem({ gapType: 'lexical' });
	fx.addItem({ gapType: 'article' });
	const start = startSession(fx.db, T0, { budgetMin: 5 });
	if (start.sessionId === null) throw new Error('empty session');
	return { ...fx, sessionId: start.sessionId, items: start.items };
}

const logsOf = (db: ReturnType<typeof setup>['db'], cardId: number) => reviewLogsRepo(db).forCard(cardId);

describe('startSession', () => {
	it('stores the served items and abandons the session in progress', () => {
		const { db, sessionId, items } = started();
		expect(items).toHaveLength(5);
		const row = sessionsRepo(db).byId(sessionId)!;
		expect(row).toMatchObject({ status: 'in_progress', shape: 'quick', budgetMin: 5, startedAt: T0 });
		expect(row.servedJson).toEqual({ cards: items.map((i) => ({ cardId: i.cardId, mode: i.mode, isNew: i.isNew })), drills: [], anchor: null });
		const next = startSession(db, at(MINUTE), {});
		expect(sessionsRepo(db).byId(sessionId)).toMatchObject({ status: 'abandoned', endedAt: at(MINUTE) });
		expect(sessionsRepo(db).byId(next.sessionId!)?.budgetMin).toBe(8); // settings default
	});

	it('stores nothing for an empty session', () => {
		const { db } = setup();
		expect(startSession(db, T0)).toEqual({ sessionId: null, startedAt: T0.getTime(), shape: 'quick', items: [], drills: [], anchor: null, feedback: [], reason: 'no_content' });
		expect(sessionsRepo(db).inProgress()).toBeUndefined();
	});
});

describe('finishSession', () => {
	it('reviews each card at started_at + offset, and records the session', () => {
		const { db, sessionId, items } = started();
		const summary = finishSession(db, at(2 * MINUTE), { sessionId, clientSessionId: 'client-1', results: items.map((i, k) => result(i, 10_000 * (k + 1))) });
		items.forEach((item, k) => expect(logsOf(db, item.cardId).map((l) => l.review)).toEqual([at(10_000 * (k + 1))]));
		expect(sessionsRepo(db).byId(sessionId)).toMatchObject({ status: 'finished', clientSessionId: 'client-1', itemsDone: 5, finishedAt: at(2 * MINUTE), summaryJson: summary });
		expect(summary).toMatchObject({ answered: 5, correct: 5, accuracy: 1, newIntroduced: 2, studyMs: 20_000, todayMinutes: 0 });
	});

	it('rejects negative offsets and offsets past the elapsed time plus 5 s', () => {
		const { db, sessionId, items } = started();
		const finish = (offset: number) => () => finishSession(db, at(10_000), { sessionId, clientSessionId: 'c', results: [result(items[0], offset)] });
		expect(finish(-1)).toThrow(/offset out of range/);
		expect(finish(15_001)).toThrow(/offset out of range/);
		expect(finish(15_000)).not.toThrow();
	});

	it('rejects decreasing offsets', () => {
		const { db, sessionId, items } = started();
		expect(() => finishSession(db, at(MINUTE), { sessionId, clientSessionId: 'c', results: [result(items[0], 5000), result(items[1], 4000)] })).toThrow(/must not decrease/);
	});

	it('rejects a card that was not served, a card twice, and a different mode', () => {
		const { db, sessionId, items, addDueCard } = started();
		const other = addDueCard();
		const finish = (results: SessionResult[]) => () => finishSession(db, at(MINUTE), { sessionId, clientSessionId: 'c', results });
		expect(finish([{ ...result(items[0], 1000), cardId: other.id }])).toThrow(/was not served/);
		expect(finish([result(items[0], 1000), result(items[0], 2000)])).toThrow(/appears twice/);
		const typed = items.find((i) => i.mode === 'typing')!;
		expect(finish([result(typed, 1000, { mode: 'choice' })])).toThrow(/typing mode/);
		expect(sessionsRepo(db).byId(sessionId)?.status).toBe('in_progress');
	});

	it('is atomic: a review failing mid-batch leaves nothing written', () => {
		const { db, sessionId, items } = started();
		// The fourth card was "reviewed" after the session's answers: its review must be refused.
		const victim = cardsRepo(db).byId(items[3].cardId)!;
		cardsRepo(db).save({ ...victim, lastReview: at(MINUTE) });
		const before = cardsRepo(db).byIds(items.map((i) => i.cardId));
		expect(() =>
			finishSession(db, at(2 * MINUTE), { sessionId, clientSessionId: 'c', results: items.map((i, k) => result(i, 1000 * (k + 1))) })
		).toThrow(expect.objectContaining({ status: 409, code: 'review_rejected' }));
		for (const item of items) expect(logsOf(db, item.cardId)).toEqual([]);
		expect(cardsRepo(db).byIds(items.map((i) => i.cardId))).toEqual(before);
		expect(sessionsRepo(db).byId(sessionId)?.status).toBe('in_progress');
	});

	it('is idempotent on clientSessionId', () => {
		const { db, sessionId, items } = started();
		const request = { sessionId, clientSessionId: 'client-1', results: items.map((i, k) => result(i, 1000 * (k + 1))) };
		const first = finishSession(db, at(MINUTE), request);
		const second = finishSession(db, at(5 * MINUTE), request);
		expect(second).toEqual(first);
		for (const item of items) expect(logsOf(db, item.cardId)).toHaveLength(1);
		// The same client id for another session is refused.
		const next = startSession(db, at(10 * MINUTE), {});
		if (next.sessionId !== null) {
			expect(() => finishSession(db, at(11 * MINUTE), { sessionId: next.sessionId!, clientSessionId: 'client-1', results: [] })).toThrow(
				expect.objectContaining({ status: 409, code: 'client_id_taken' })
			);
		}
	});

	it('refuses to finish an abandoned session', () => {
		const { db, sessionId } = started();
		startSession(db, at(MINUTE), {});
		expect(() => finishSession(db, at(2 * MINUTE), { sessionId, clientSessionId: 'c', results: [] })).toThrow(
			expect.objectContaining({ status: 409, code: 'not_in_progress' })
		);
	});

	it('a partial finish reviews only the answered cards', () => {
		const { db, sessionId, items } = started();
		const summary = finishSession(db, at(MINUTE), { sessionId, clientSessionId: 'c', results: [result(items[0], 1000), result(items[1], 2000, { correct: false })] });
		expect(summary).toMatchObject({ answered: 2, correct: 1, accuracy: 0.5 });
		expect(items.map((i) => logsOf(db, i.cardId).length)).toEqual([1, 1, 0, 0, 0]);
		expect(sessionsRepo(db).byId(sessionId)?.itemsDone).toBe(2);
	});

	it('uses ratingOverride over the inferred rating', () => {
		const { db, sessionId, items } = started();
		finishSession(db, at(MINUTE), {
			sessionId,
			clientSessionId: 'c',
			results: [result(items[0], 1000, { correct: false, ratingOverride: 4 }), result(items[1], 2000, { correct: false }), result(items[2], 3000, { hintUsed: true })]
		});
		expect(items.slice(0, 3).map((i) => logsOf(db, i.cardId)[0].rating)).toEqual(['Easy', 'Again', 'Hard']);
	});

	it('counts strengthened cards (stability up, new cards excluded), next due and minutes today', () => {
		const { db, sessionId, items } = started();
		const review = items.filter((i) => !i.isNew);
		const results = items.map((i, k) => result(i, 1000 * (k + 1), { correct: i !== review[0], responseMs: 30_000 }));
		const summary = finishSession(db, at(5 * MINUTE), { sessionId, clientSessionId: 'c1', results });
		// Two of the three due cards were right (stability up); the wrong one lapsed.
		expect(summary.strengthened).toBe(2);
		const introduced = cardsRepo(db).byIds(items.map((i) => i.cardId));
		expect(summary.nextDueAt).toBe(Math.min(...introduced.map((c) => c.due.getTime())));
		expect(summary.todayMinutes).toBe(3); // 5 × 30 s = 2.5 min, rounded
		// A second session the same learning day adds its time.
		const next = startSession(db, at(30 * MINUTE), { budgetMin: 5 });
		const second = finishSession(db, at(32 * MINUTE), {
			sessionId: next.sessionId!,
			clientSessionId: 'c2',
			results: next.items.slice(0, 2).map((i, k) => result(i, 1000 * (k + 1), { responseMs: 60_000 }))
		});
		expect(second.todayMinutes).toBe(5); // 2.5 + 2 = 4.5, rounded
	});
});
