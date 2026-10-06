import { describe, expect, it, vi } from 'vitest';
import { cacheRepo } from '../db/repositories/cache.ts';
import { cardsRepo } from '../db/repositories/cards.ts';
import { drillResultsRepo } from '../db/repositories/drill-results.ts';
import { grammarTopicsRepo } from '../db/repositories/grammar-topics.ts';
import { placementRepo } from '../db/repositories/placement.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { sentencesRepo } from '../db/repositories/sentences.ts';
import { sessionsRepo } from '../db/repositories/sessions.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import { lexemes } from '../db/schema.ts';
import { applyWritingGrade } from '../grading/apply.ts';
import type { GradedWriting } from '../placement/results.ts';
import type { Anchor, StartResponse } from '../../session/types.ts';
import { itemCount } from './compose.ts';
import { chooseDrillCodes, weaknessProfile } from './drills.ts';
import { type AnchorDeps, addGlossaryCard, finishSession, markFeedbackSeen, startSession, submitAnchor } from './engine.ts';
import { DAY, MINUTE, T0, setup } from './test-fixtures.ts';

const at = (ms: number) => new Date(T0.getTime() + ms);
const started = (s: StartResponse) => {
	if (s.sessionId === null) throw new Error('empty session');
	return s;
};
const graded = (over: Partial<GradedWriting> = {}): GradedWriting => ({
	cefr: 'A2',
	correctedText: 'Yesterday I went to the market. We bought fish.',
	errors: [{ original: 'buyed', correction: 'bought', topic_code: 'TNS', explanation_vi: 'Quá khứ của buy là bought.' }],
	onTopic: true,
	taskNoteVi: null,
	...over
});
/** A Viết session (provider present, no passage) with a writing task. */
function writeSession() {
	const fx = setup();
	fx.addProvider();
	for (let i = 0; i < 4; i++) fx.addItem();
	sentencesRepo(fx.db).insert({ enText: 'I like to read books at night.', viText: 'Tôi thích đọc sách vào ban đêm.', source: 'tatoeba', tatoebaIdEn: 9001, licenseTag: 'x', levelBand: 1 });
	const s = started(startSession(fx.db, T0, { budgetMin: 8 }));
	return { ...fx, s };
}
const deps = (db: AnchorDeps['db'], grade: AnchorDeps['grade'], timeoutMs = 50): AnchorDeps => ({ db, now: () => at(MINUTE), grade, timeoutMs });

describe('item budget per shape', () => {
	it('keeps about 3 minutes for the anchor of Đọc and Viết', () => {
		expect(itemCount(5, 'quick')).toBe(15);
		expect(itemCount(8, 'read')).toBe(15);
		expect(itemCount(10, 'write')).toBe(21);
		expect(itemCount(8, 'quick')).toBe(24);
		expect(itemCount(3, 'read')).toBe(1);
	});
});

describe('starting each shape', () => {
	it('quick: cards only; read: cards, 2 drills and a passage, all marked served', () => {
		const { db, addItem, addReading, addDrill } = setup();
		for (let i = 0; i < 30; i++) addItem();
		const reading = addReading(1);
		addDrill('ART');
		addDrill('PRE');
		addDrill('SVA');
		const quick = started(startSession(db, T0, { budgetMin: 5 }));
		expect(quick).toMatchObject({ shape: 'quick', drills: [], anchor: null });
		expect(quick.items).toHaveLength(Math.min(15, 10));
		const read = started(startSession(db, at(MINUTE), { budgetMin: 8 }));
		expect(read.shape).toBe('read');
		expect(read.drills).toHaveLength(2);
		expect(read.anchor).toMatchObject({ type: 'reading', cacheId: reading.id, questions: [{ answerIndex: 0 }, { answerIndex: 1 }] });
		expect(cacheRepo(db).byId(reading.id)?.servedAt).toEqual(at(MINUTE));
		for (const d of read.drills) expect(cacheRepo(db).byId(d.cacheId)?.servedAt).toEqual(at(MINUTE));
		expect(sessionsRepo(db).byId(read.sessionId)?.servedJson).toMatchObject({
			drills: read.drills.map((d) => ({ cacheId: d.cacheId, topicCode: d.topicCode })),
			anchor: { type: 'reading', cacheId: reading.id, questions: 2 }
		});
	});

	it('refuses an unavailable shape override, accepts an available one', () => {
		const { db, addItem } = setup();
		addItem();
		expect(() => startSession(db, T0, { budgetMin: 8, shape: 'write' })).toThrow(expect.objectContaining({ code: 'shape_unavailable' }));
		expect(() => startSession(db, T0, { budgetMin: 8, shape: 'read' })).toThrow(expect.objectContaining({ code: 'shape_unavailable' }));
		expect(startSession(db, T0, { budgetMin: 8, shape: 'quick' })).toMatchObject({ shape: 'quick' });
	});

	it('a passage two bands away is not "at the right band": Viết instead', () => {
		const { db, addItem, addReading, addProvider } = setup();
		addItem();
		addProvider();
		addReading(3);
		expect(startSession(db, T0, { budgetMin: 8 })).toMatchObject({ shape: 'write', anchor: { type: 'writing' } });
	});
});

describe('drills follow the weakness profile', () => {
	it('orders codes by errors, then a seeded random order; one code twice when alone', () => {
		const profile = new Map([
			['PRE', 3],
			['ART', 5]
		]);
		expect(chooseDrillCodes(profile, ['ART', 'PRE', 'SVA'], 2, 's')).toEqual(['ART', 'PRE']);
		expect(chooseDrillCodes(profile, ['PRE', 'SVA'], 2, 's')).toEqual(['PRE', 'SVA']);
		expect(chooseDrillCodes(new Map(), ['ART'], 2, 's')).toEqual(['ART', 'ART']);
		expect(chooseDrillCodes(new Map(), [], 2, 's')).toEqual([]);
		const random = chooseDrillCodes(new Map(), ['ART', 'PRE', 'SVA', 'TNS'], 2, 'x');
		expect(new Set(random).size).toBe(2);
	});

	it('counts writing errors, lapses on grammar cards and missed drills of the last 30 days', () => {
		const { db, addDueCard, addDrill, addItem, addReading } = setup();
		for (let i = 0; i < 4; i++) addItem();
		const sub = writingRepo(db).queue({ sessionId: null, prompt: 'p', userText: 't', submittedAt: T0 });
		writingRepo(db).markScored(
			sub.id,
			{ correctedText: 'x', errors: [1, 2].map(() => ({ original: 'of', correction: 'on', topic_code: 'PRE', explanation_vi: '.' })), cefrEstimate: 'A2' },
			T0
		);
		const old = writingRepo(db).queue({ sessionId: null, prompt: 'p', userText: 't', submittedAt: at(-40 * DAY) });
		writingRepo(db).markScored(old.id, { correctedText: 'x', errors: [{ original: 'a', correction: 'the', topic_code: 'ART', explanation_vi: '.' }], cefrEstimate: 'A2' }, at(-40 * DAY));
		// Three lapses on an article card.
		const card = addDueCard({ gapType: 'article' });
		const s = started(startSession(db, T0, { budgetMin: 5 }));
		const item = s.items.find((i) => i.cardId === card.id)!;
		finishSession(db, at(MINUTE), { sessionId: s.sessionId, clientSessionId: 'w1', results: [{ cardId: item.cardId, correct: false, mode: item.mode, responseMs: 1000, hintUsed: false, answeredOffsetMs: 1000 }] });
		expect(weaknessProfile(db, at(2 * MINUTE))).toEqual(
			new Map([
				['PRE', 2],
				['ART', 1]
			])
		);
		// The drills then come from PRE, then ART; a quick session has none.
		addDrill('SVA');
		addDrill('PRE');
		addDrill('ART');
		addDrill('ART');
		addReading(1);
		expect(started(startSession(db, at(3 * MINUTE), { budgetMin: 8, shape: 'quick' })).drills).toEqual([]);
		const read = started(startSession(db, at(4 * MINUTE), { budgetMin: 8, shape: 'read' }));
		expect(read.drills.map((d) => d.topicCode)).toEqual(['PRE', 'ART']);
	});
});

describe('the Đọc anchor', () => {
	function readSession(glossary?: { word: string; vi: string }[]) {
		const fx = setup();
		const teacher = fx.db.insert(lexemes).values({ headword: 'teacher', forms: ['teacher', 'teachers'], source: 'test', licenseTag: 'x', freqBand: 1, ngslRank: 500 }).returning().get();
		const item = fx.addItem({ gapType: 'lexical', lexemeId: teacher.id });
		for (let i = 0; i < 5; i++) fx.addItem();
		fx.addReading(1, glossary);
		// No new cards today: the session must not turn the teacher item into a card itself.
		settingsRepo(fx.db).update({ newCardsPerDay: 0 });
		const s = started(startSession(fx.db, T0, { budgetMin: 8 }));
		return { ...fx, s, item };
	}

	it('marks a glossary word addable when a validated item for its lexeme has no card', () => {
		const { s } = readSession([
			{ word: 'teacher', vi: 'giáo viên' },
			{ word: 'children', vi: 'trẻ em' }
		]);
		const anchor = s.anchor as Extract<Anchor, { type: 'reading' }>;
		expect(anchor.glossary).toEqual([
			{ word: 'teacher', vi: 'giáo viên', addable: true },
			{ word: 'children', vi: 'trẻ em', addable: false }
		]);
	});

	it('"Thêm vào ôn tập" creates a New card that waits for the daily limit; refused without an item', () => {
		const { db, s, item } = readSession([
			{ word: 'teacher', vi: 'giáo viên' },
			{ word: 'children', vi: 'trẻ em' }
		]);
		const { cardId } = addGlossaryCard(db, at(MINUTE), { sessionId: s.sessionId, word: 'teacher' });
		expect(cardsRepo(db).byId(cardId)).toMatchObject({ state: 'New', clozeItemId: item.id });
		expect(() => addGlossaryCard(db, at(MINUTE), { sessionId: s.sessionId, word: 'teacher' })).toThrow(expect.objectContaining({ code: 'not_addable' }));
		expect(() => addGlossaryCard(db, at(MINUTE), { sessionId: s.sessionId, word: 'children' })).toThrow(expect.objectContaining({ code: 'not_addable' }));
		// It counts toward the daily limit (0 today): it waits; with room, it is served first.
		expect(startSession(db, at(2 * MINUTE), { budgetMin: 5 }).items.map((i) => i.cardId)).not.toContain(cardId);
		settingsRepo(db).update({ newCardsPerDay: 1 });
		const tomorrow = startSession(db, at(DAY), { budgetMin: 5 });
		expect(tomorrow.items.filter((i) => i.isNew).map((i) => i.cardId)).toEqual([cardId]);
	});

	it('validates the reading result against what was served and scores it', () => {
		const { db, s } = readSession();
		const anchor = s.anchor as Extract<Anchor, { type: 'reading' }>;
		const finish = (anchorResult: object) => () =>
			finishSession(db, at(MINUTE), { sessionId: s.sessionId, clientSessionId: 'r1', results: [], anchor: anchorResult as never });
		expect(finish({ type: 'reading', cacheId: anchor.cacheId + 99, answers: [0] })).toThrow(/not the passage served/);
		expect(finish({ type: 'reading', cacheId: anchor.cacheId, answers: [0, 1, 2] })).toThrow(/too many answers/);
		expect(finish({ type: 'writing' })).toThrow(/no writing anchor/);
		const summary = finish({ type: 'reading', cacheId: anchor.cacheId, answers: [0, 3] })();
		expect(summary).toMatchObject({ shape: 'read', anchor: { type: 'reading', correct: 1, total: 2 } });
	});
});

describe('the Viết anchor', () => {
	it('alternates writing and translation on successive Viết sessions', () => {
		const { db, s } = writeSession();
		expect(s.anchor).toMatchObject({ type: 'writing' });
		finishSession(db, at(MINUTE), { sessionId: s.sessionId, clientSessionId: 'v1', results: [] });
		// A Đọc session would come next; force Viết.
		const second = started(startSession(db, at(2 * MINUTE), { budgetMin: 8, shape: 'write' }));
		expect(second.anchor).toMatchObject({ type: 'translation', vi: 'Tôi thích đọc sách vào ban đêm.', referenceEn: 'I like to read books at night.' });
		finishSession(db, at(3 * MINUTE), { sessionId: second.sessionId, clientSessionId: 'v2', results: [] });
		expect(started(startSession(db, at(4 * MINUTE), { budgetMin: 8, shape: 'write' })).anchor).toMatchObject({ type: 'writing' });
	});

	it('grades in time: feedback inline (marked seen), errors mined, summary counts them', async () => {
		const { db, s } = writeSession();
		const grade = vi.fn(async () => graded());
		const response = await submitAnchor(deps(db, grade), { sessionId: s.sessionId, text: 'Yesterday I goed to the market. We buyed fish.' });
		expect(response.queued).toBe(false);
		if (response.queued) return;
		expect(response.feedback).toMatchObject({ taskKind: 'writing', correctedText: graded().correctedText, mined: 1, onTopic: true });
		expect(response.feedback.errors[0]).toMatchObject({ topicCode: 'TNS', topicNameVi: grammarTopicsRepo(db).byCode('TNS')!.nameVi });
		const submission = writingRepo(db).forSession(s.sessionId)!;
		expect(submission).toMatchObject({ status: 'scored', taskKind: 'writing', minedCount: 1, feedbackSeenAt: at(MINUTE) });
		expect(writingRepo(db).unseenFeedback()).toEqual([]);
		// A repeated submit returns the same feedback, grading nothing again.
		expect(await submitAnchor(deps(db, grade), { sessionId: s.sessionId, text: 'other' })).toEqual(response);
		expect(grade).toHaveBeenCalledOnce();
		const summary = finishSession(db, at(2 * MINUTE), { sessionId: s.sessionId, clientSessionId: 'w', results: [], anchor: { type: 'writing' } });
		expect(summary).toMatchObject({ anchor: { type: 'writing', status: 'scored' }, minedErrors: 1 });
	});

	it('a timeout goes on queued; the late grade mines and surfaces at the next start', async () => {
		const { db, s } = writeSession();
		let release: (g: GradedWriting) => void = () => {};
		const late = new Promise<GradedWriting>((resolve) => (release = resolve));
		expect(await submitAnchor(deps(db, () => late, 10), { sessionId: s.sessionId, text: 'We buyed fish.' })).toEqual({ queued: true, reason: 'timeout' });
		expect(finishSession(db, at(2 * MINUTE), { sessionId: s.sessionId, clientSessionId: 'q', results: [], anchor: { type: 'writing' } })).toMatchObject({
			anchor: { status: 'queued' },
			minedErrors: 0
		});
		release(graded());
		await late;
		await new Promise((r) => setTimeout(r, 0));
		const submission = writingRepo(db).forSession(s.sessionId)!;
		expect(submission).toMatchObject({ status: 'scored', minedCount: 1, feedbackSeenAt: null });
		const next = startSession(db, at(DAY), { budgetMin: 5 });
		expect(next.feedback.map((f) => f.submissionId)).toEqual([submission.id]);
		expect(next.items.some((i) => i.isMined)).toBe(true);
	});

	it('no provider: stored and queued without trying', async () => {
		const { db, s } = writeSession();
		expect(await submitAnchor(deps(db, null), { sessionId: s.sessionId, text: 'Hello there.' })).toEqual({ queued: true, reason: 'no_provider' });
		expect(writingRepo(db).queued()).toHaveLength(1);
	});

	it('the LLM fails: stored, queued, and the reason says so (the learner sees "AI is down")', async () => {
		const { db, s } = writeSession();
		const failing = () => Promise.reject(new Error('503 from provider'));
		expect(await submitAnchor(deps(db, failing), { sessionId: s.sessionId, text: 'Hello there.' })).toEqual({ queued: true, reason: 'llm_error' });
		expect(writingRepo(db).queued()).toHaveLength(1);
		// A repeated submit says it is still pending.
		expect(await submitAnchor(deps(db, failing), { sessionId: s.sessionId, text: 'Hello there.' })).toEqual({ queued: true, reason: 'pending' });
	});

	it('refuses a writing for a session without one, and an empty text', async () => {
		const { db, addItem } = setup();
		addItem();
		const quick = started(startSession(db, T0, { budgetMin: 5 }));
		await expect(submitAnchor(deps(db, null), { sessionId: quick.sessionId, text: 'Hello.' })).rejects.toMatchObject({ code: 'invalid' });
		const { db: db2, s } = writeSession();
		await expect(submitAnchor(deps(db2, null), { sessionId: s.sessionId, text: '  12 ' })).rejects.toMatchObject({ code: 'invalid' });
	});
});

describe('off-topic writing', () => {
	it('keeps its CEFR out of the placement result and the profile', () => {
		const { db } = setup();
		const submission = writingRepo(db).queue({ sessionId: null, prompt: 'Hôm nay bạn đã ăn gì?', userText: 'I like football.', submittedAt: T0 });
		const result = placementRepo(db).insertResult({
			takenAt: T0,
			theta: 4,
			cefr: 'B1',
			subscoresJson: { vocab: 4, falseAlarmRate: 0, lexical: null, grammar: null, grammarByType: {}, writing: null },
			itemLogJson: [],
			writingStatus: 'queued',
			vocabBand: 4,
			clozeTheta: null,
			abilityBand: 7,
			writingSubmissionId: submission.id,
			reliabilityFlags: []
		});
		applyWritingGrade(db, submission.id, graded({ cefr: 'C1', onTopic: false, taskNoteVi: 'Đề hỏi về bữa ăn.', errors: [] }), at(MINUTE));
		expect(placementRepo(db).result(result.id)).toMatchObject({ cefr: 'B1', writingStatus: 'scored', subscoresJson: { writing: null }, reliabilityFlags: ['writing_off_topic'] });
		expect(profileRepo(db).get()).toMatchObject({ writingTheta: null });
		expect(profileRepo(db).get().cefrEstimate).not.toBe('C1');
		expect(writingRepo(db).byId(submission.id)).toMatchObject({ onTopic: false, taskNoteVi: 'Đề hỏi về bữa ăn.', cefrEstimate: 'C1' });
	});
});

describe('feedback surfacing', () => {
	it('unseen placement and session feedback appears at start once, then is marked seen', () => {
		const { db, addItem } = setup();
		addItem();
		const placement = writingRepo(db).queue({ sessionId: null, prompt: 'Placement', userText: 'I goed home.', submittedAt: T0 });
		applyWritingGrade(db, placement.id, graded({ correctedText: 'I went home.', errors: [] }), T0);
		const first = startSession(db, at(MINUTE), { budgetMin: 5 });
		expect(first.feedback.map((f) => f.submissionId)).toEqual([placement.id]);
		expect(first.feedback[0]).toMatchObject({ correctedText: 'I went home.', userText: 'I goed home.', mined: 0 });
		markFeedbackSeen(db, at(2 * MINUTE), placement.id);
		expect(startSession(db, at(3 * MINUTE), { budgetMin: 5 }).feedback).toEqual([]);
		// Indirect mode withholds the corrected text.
		const other = writingRepo(db).queue({ sessionId: null, prompt: 'P', userText: 'x y', submittedAt: T0 });
		applyWritingGrade(db, other.id, graded({ errors: [] }), T0);
		settingsRepo(db).update({ feedbackMode: 'indirect' });
		expect(startSession(db, at(4 * MINUTE), { budgetMin: 5 }).feedback[0].correctedText).toBeNull();
	});
});

describe('graded errors: 3 shown (distinct codes first), every one mined', () => {
	it('SVA, SVA, ART, COP shows SVA (×2), ART and COP, and mines all four', () => {
		const { db, addItem } = setup();
		addItem();
		const text = 'My sister go to school. She like music. We have cat. She very happy.';
		const submission = writingRepo(db).queue({ sessionId: null, prompt: 'Viết về gia đình.', userText: text, submittedAt: T0 });
		const e = (original: string, correction: string, topic_code: 'SVA' | 'ART' | 'COP') => ({ original, correction, topic_code, explanation_vi: 'Giải thích.' });
		applyWritingGrade(
			db,
			submission.id,
			graded({
				correctedText: 'My sister goes to school. She likes music. We have a cat. She is very happy.',
				errors: [e('go', 'goes', 'SVA'), e('like', 'likes', 'SVA'), e('have cat', 'have a cat', 'ART'), e('She very', 'She is very', 'COP')]
			}),
			T0
		);
		const card = startSession(db, at(MINUTE), { budgetMin: 5 }).feedback[0];
		expect(card.errors.map((x) => [x.topicCode, x.repeats])).toEqual([
			['SVA', 2],
			['ART', 1],
			['COP', 1]
		]);
		expect(card.totalErrors).toBe(4);
		expect(card.mined).toBe(4);
	});
});

describe('finish with drills', () => {
	it('validates drills against what was served, stores them once, keeps idempotency', () => {
		const { db, addItem, addReading, addDrill } = setup();
		for (let i = 0; i < 5; i++) addItem();
		addReading(1);
		addDrill('ART');
		const other = addDrill('PRE');
		const s = started(startSession(db, T0, { budgetMin: 8 }));
		const [served] = s.drills;
		const notServed = [addDrill('SVA')].find((d) => d.id !== served.cacheId)!;
		const finish = (drills: object[], id = 'd1') => () => finishSession(db, at(MINUTE), { sessionId: s.sessionId, clientSessionId: id, results: [], drills: drills as never });
		expect(finish([{ cacheId: notServed.id, correct: true, responseMs: 1 }])).toThrow(/was not served/);
		expect(finish([{ cacheId: served.cacheId, correct: true, responseMs: 1 }, { cacheId: served.cacheId, correct: true, responseMs: 1 }])).toThrow(/appears twice/);
		const results = s.drills.map((d, i) => ({ cacheId: d.cacheId, correct: i === 0, responseMs: 5000 }));
		const summary = finish(results)();
		expect(summary).toMatchObject({ drillsCorrect: 1, drillsTotal: 2, studyMs: 10_000 });
		expect(finish(results)()).toEqual(summary);
		expect(drillResultsRepo(db).forSession(s.sessionId).map((r) => [r.cacheId, r.correct])).toEqual(results.map((r) => [r.cacheId, r.correct]));
		expect(other.id).toBeGreaterThan(0);
	});
});
