// Phase 12: two profiles with data; every main read path sees only its own learner's rows
// (plus the shared content). One fixture, then one check per read path.
import { describe, expect, it } from 'vitest';
import { cardsRepo } from '../db/repositories/cards.ts';
import { learnerClozeRepo } from '../db/repositories/cloze-items.ts';
import { placementRepo } from '../db/repositories/placement.ts';
import { profilesRepo } from '../db/repositories/profiles.ts';
import { reviewLogsRepo } from '../db/repositories/review-logs.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import { TEST_PROFILE } from '../db/test-db.ts';
import { applyWritingGrade } from '../grading/apply.ts';
import { placementOverview } from '../placement/engine.ts';
import { resultView } from '../placement/results.ts';
import { loadProgress, loadToday } from '../progress/index.ts';
import { cardDetail, hardList, learnedList, reviewNow, setSuspended } from '../review-book/index.ts';
import { homeCounts } from '../session/counts.ts';
import { finishSession, markFeedbackSeen, startSession } from '../session/engine.ts';
import { unseenFeedbackCards } from '../session/feedback.ts';
import { DAY, MINUTE, T0, setup } from '../session/test-fixtures.ts';
import { buildQueue } from '../srs/index.ts';

const A = TEST_PROFILE;
const at = (ms: number) => new Date(T0.getTime() + ms);

function twoLearners() {
	const fx = setup();
	const B = profilesRepo(fx.db).create({ name: 'Bé', emoji: '🐱' }, T0).id;
	// A: two due cards, a graded writing with mined errors, a placement result.
	const aCards = [fx.addDueCard({ gapType: 'lexical', profileId: A }), fx.addDueCard({ gapType: 'preposition', profileId: A })];
	const submission = writingRepo(fx.db, A).queue({ sessionId: null, prompt: 'Hôm qua bạn làm gì?', userText: 'Yesterday I goed to school.', submittedAt: T0 });
	applyWritingGrade(
		fx.db,
		A,
		submission.id,
		{
			cefr: 'A2',
			correctedText: 'Yesterday I went to school.',
			errors: [{ original: 'goed', correction: 'went', topic_code: 'TNS', explanation_vi: 'Quá khứ của go là went.' }],
			onTopic: null,
			taskNoteVi: null,
			meaningOk: null
		},
		T0
	);
	const result = placementRepo(fx.db, A).insertResult({
		takenAt: T0,
		theta: 3,
		cefr: 'A2',
		subscoresJson: { vocab: 3, falseAlarmRate: 0, lexical: null, grammar: null, grammarByType: {}, writing: null },
		itemLogJson: [],
		writingStatus: 'none',
		vocabBand: 3,
		clozeTheta: null,
		abilityBand: 3,
		writingSubmissionId: null,
		reliabilityFlags: []
	});
	// B: due cards, reviewed in a finished session of 5+ items (a streak of one day). The session
	// may also create B's own new cards on the shared items A has cards on: shared content.
	const bCard = fx.addDueCard({ gapType: 'verb_form', profileId: B });
	for (let i = 0; i < 4; i++) fx.addDueCard({ gapType: 'lexical', profileId: B });
	const started = startSession(fx.db, B, at(MINUTE), { budgetMin: 5 });
	finishSession(fx.db, B, at(2 * MINUTE), {
		sessionId: started.sessionId!,
		clientSessionId: 'b-1',
		results: started.items.map((i, k) => ({ cardId: i.cardId, mode: i.mode, correct: true, responseMs: 3000, hintUsed: false, answeredOffsetMs: 5000 * (k + 1) }))
	});
	const mined = cardsRepo(fx.db, A).newMinedCards(10);
	return { ...fx, B, aCards, bCard, served: started.items, submission, result, mined };
}

describe('no cross-profile leakage', () => {
	const fx = twoLearners();
	const { db, B, aCards, bCard, served, submission, result, mined } = fx;
	const now = at(DAY);
	const aIds = new Set([...aCards.map((c) => c.id), ...mined.map((c) => c.id)]);
	const owner = (cardId: number) => (db.$client.prepare('select profile_id from cards where id = ?').pluck().get(cardId) as number);

	it('the fixture has data on both sides', () => {
		expect(mined).toHaveLength(1);
		expect(served.length).toBeGreaterThanOrEqual(5);
		expect(served.map((i) => i.cardId)).toContain(bCard.id);
		expect(served.every((i) => owner(i.cardId) === B)).toBe(true);
	});

	it('due queue and Home counts', () => {
		const queueA = buildQueue(db, A, now, { reviewLimit: 50, newLimit: 50 }).cards;
		const queueB = buildQueue(db, B, now, { reviewLimit: 50, newLimit: 50 }).cards;
		expect(queueA.map((c) => c.profileId)).toEqual(queueA.map(() => A));
		expect(queueB.map((c) => c.profileId)).toEqual(queueB.map(() => B));
		expect(queueA.filter((c) => c.state !== 'New').map((c) => c.id)).toEqual(aCards.map((c) => c.id).sort((x, y) => x - y));
		expect(homeCounts(db, A, now).due).toBe(2);
		// B reviewed everything that was due a minute after T0; the next due is days away.
		expect(homeCounts(db, B, at(2 * MINUTE)).due).toBe(0);
	});

	it('session composition never serves the other learner\'s cards or mined items', () => {
		const forA = startSession(db, A, now, { budgetMin: 10 });
		expect(forA.items.length).toBeGreaterThan(0);
		expect(forA.items.every((i) => owner(i.cardId) === A)).toBe(true);
		const forB = startSession(db, B, now, { budgetMin: 10 });
		expect(forB.items.every((i) => owner(i.cardId) === B)).toBe(true);
		// A's mined item is invisible to B (and never a new-card candidate for anyone).
		expect(learnerClozeRepo(db, B).byId(mined[0].clozeItemId!)).toBeUndefined();
		expect(learnerClozeRepo(db, A).byId(mined[0].clozeItemId!)).toBeDefined();
		// Finishing B's session as A is refused.
		expect(() => finishSession(db, A, now, { sessionId: forB.sessionId!, clientSessionId: 'x', results: [] })).toThrow(/no such session/);
	});

	it('progress: streak, history, totals, levels', () => {
		expect(loadProgress(db, B, at(2 * MINUTE)).streak.current).toBe(1);
		expect(loadProgress(db, A, at(2 * MINUTE)).streak.current).toBe(0);
		expect(loadProgress(db, A, now).totals.sessions).toBe(0);
		expect(loadProgress(db, B, now).totals).toMatchObject({ sessions: 1, minedAdded: 0 });
		expect(loadProgress(db, A, now).totals.minedAdded).toBe(1);
		expect(loadProgress(db, A, now).levels).toHaveLength(1);
		expect(loadProgress(db, B, now).levels).toEqual([]);
		expect(loadToday(db, B, now).minedWaiting).toBe(0);
	});

	it('review book: lists, detail and actions', () => {
		expect(hardList(db, B, now).every((r) => owner(r.cardId) === B)).toBe(true);
		expect(hardList(db, B, now).some((r) => aIds.has(r.cardId))).toBe(false);
		expect(hardList(db, A, now).map((r) => r.cardId)).toContain(mined[0].id);
		expect(learnedList(db, B, now, '').map((r) => owner(r.cardId))).toEqual(learnedList(db, B, now, '').map(() => B));
		expect(learnedList(db, B, now, '').map((r) => r.cardId)).toContain(bCard.id);
		expect(learnedList(db, A, now, '').every((r) => owner(r.cardId) === A)).toBe(true);
		expect(cardDetail(db, B, now, aCards[0].id)).toBeNull();
		expect(reviewNow(db, B, now, aCards[0].id)).toBe(false);
		expect(setSuspended(db, B, aCards[0].id, true)).toBe(false);
		expect(reviewLogsRepo(db, A).forCard(bCard.id)).toEqual([]);
	});

	it('writing history and feedback', () => {
		expect(writingRepo(db, B).scoredSince(new Date(0))).toEqual([]);
		expect(writingRepo(db, B).byId(submission.id)).toBeUndefined();
		expect(writingRepo(db, A).scoredSince(new Date(0)).map((s) => s.id)).toEqual([submission.id]);
		expect(unseenFeedbackCards(db, B)).toEqual([]);
		expect(unseenFeedbackCards(db, A)).toHaveLength(1);
		expect(() => markFeedbackSeen(db, B, now, submission.id)).toThrow(/no such feedback/);
	});

	it('placement result', () => {
		expect(resultView(db, A, result.id)).not.toBeNull();
		expect(resultView(db, B, result.id)).toBeNull();
		expect(placementRepo(db, B).latestResult()).toBeUndefined();
		expect(placementOverview(db, A)).toEqual({ completed: true, inProgress: false });
		expect(placementOverview(db, B)).toEqual({ completed: false, inProgress: false });
	});
});
