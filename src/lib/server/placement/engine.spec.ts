import { describe, expect, it, vi } from 'vitest';
import { TEST_PROFILE } from '../db/test-db.ts';
import type { PlacementView } from '../../placement.ts';
import { placementRepo } from '../db/repositories/placement.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import {
	type EngineDeps,
	MIN_CLOZE_POOL,
	PlacementError,
	answerPlacement,
	currentPlacement,
	placementOverview,
	startPlacement,
	submitPlacementWriting
} from './engine.ts';
import { resultView } from './results.ts';
import { bandOfWord, correctIndex, engineDeps, isPseudo, seedClozePool } from './test-fixtures.ts';

type Policy = { knowsUpTo: number; falseAlarms?: boolean; clozeCorrect?: boolean };

/** Answer Parts A and B by policy until Part C (or the end). Returns the last view and the requests made. */
function runTo(deps: EngineDeps, view: PlacementView, policy: Policy): { view: PlacementView; answers: number } {
	let answers = 0;
	while (view.part === 'A' || view.part === 'B') {
		const answer =
			view.part === 'A'
				? isPseudo(view.word)
					? (policy.falseAlarms ?? false)
					: bandOfWord(view.word) <= policy.knowsUpTo
				: policy.clozeCorrect === false
					? (correctIndex(view.options) + 1) % 4
					: correctIndex(view.options);
		view = answerPlacement(deps, { attemptId: view.attemptId, itemRef: view.ref, answer, responseMs: 1500 });
		answers++;
	}
	return { view, answers };
}

const expectError = (fn: () => unknown, status: number, code: string) => {
	try {
		fn();
	} catch (error) {
		expect(error).toBeInstanceOf(PlacementError);
		expect(error).toMatchObject({ status, code });
		return;
	}
	throw new Error('expected a PlacementError');
};

describe('the placement flow', () => {
	it('runs Part A, Part B and Part C, and stores the result and the profile', async () => {
		const deps = engineDeps();
		seedClozePool(deps.db, [1, 2, 3, 4, 5, 6, 7, 8], 12);
		const first = startPlacement(deps);
		expect(first).toMatchObject({ part: 'A', progress: { part: 1, answered: 0, total: 42 } });

		const { view, answers } = runTo(deps, first, { knowsUpTo: 4 });
		expect(view.part).toBe('C');
		if (view.part !== 'C') return;
		expect(view.clozeSkipped).toBe(false);
		const state = placementRepo(deps.db, TEST_PROFILE).attempt(view.attemptId)!.stateJson as { log: { part: string; item: unknown }[] };
		const partA = state.log.filter((e) => e.part === 'A');
		const partB = state.log.filter((e) => e.part === 'B');
		expect(partB).toHaveLength(12);
		expect(answers).toBe(partA.length + 12);
		expect(partA.length % 6).toBe(0);
		expect(partA.length).toBeLessThanOrEqual(42);
		// Never a word or an item twice.
		expect(new Set(partA.map((e) => e.item)).size).toBe(partA.length);
		expect(new Set(partB.map((e) => e.item)).size).toBe(12);

		const { resultId } = await submitPlacementWriting(deps, { attemptId: view.attemptId, skip: true });
		const result = placementRepo(deps.db, TEST_PROFILE).result(resultId)!;
		expect(result.vocabBand).toBe(4);
		expect(result.clozeTheta).toBeGreaterThan(4);
		expect(result.writingStatus).toBe('none');
		expect(result.reliabilityFlags).toEqual([]);
		expect(result.itemLogJson).toHaveLength(answers);
		expect(result.subscoresJson.lexical).toEqual({ correct: 6, total: 6 });
		expect(result.subscoresJson.grammar).toEqual({ correct: 6, total: 6 });
		expect(Object.values(result.subscoresJson.grammarByType).reduce((n, s) => n + s.total, 0)).toBe(6);
		expect(profileRepo(deps.db, TEST_PROFILE).get()).toMatchObject({
			cefrEstimate: result.cefr,
			knownBandCeiling: 4,
			vocabTheta: 4,
			theta: result.theta
		});
		expect(placementRepo(deps.db, TEST_PROFILE).attempt(view.attemptId)).toMatchObject({ status: 'completed', part: 'done', resultId });
		expect(placementOverview(deps.db, TEST_PROFILE)).toEqual({ completed: true, inProgress: false });
	});

	it('alternates lexical and grammar items in Part B', () => {
		const deps = engineDeps();
		seedClozePool(deps.db, [1, 2, 3, 4, 5, 6, 7, 8], 12);
		const { view } = runTo(deps, startPlacement(deps), { knowsUpTo: 3 });
		const items = (placementRepo(deps.db, TEST_PROFILE).attempt(view.attemptId)!.stateJson as { b: { items: { type: string }[] } }).b.items;
		expect(items.map((i) => i.type)).toEqual([
			'lexical', 'article', 'lexical', 'preposition', 'lexical', 'verb_form',
			'lexical', 'article', 'lexical', 'preposition', 'lexical', 'verb_form'
		]);
	});

	it('skips Part B when the bands around vocab_band hold too few validated items', async () => {
		const deps = engineDeps();
		// 29 items within vocab_band ± 2 (vocab_band will be 3), plenty elsewhere.
		seedClozePool(deps.db, [1], MIN_CLOZE_POOL - 1);
		seedClozePool(deps.db, [6, 7, 8], 20);
		const { view } = runTo(deps, startPlacement(deps), { knowsUpTo: 3 });
		expect(view).toMatchObject({ part: 'C', clozeSkipped: true });
		const { resultId } = await submitPlacementWriting(deps, { attemptId: view.attemptId, skip: true });
		const result = placementRepo(deps.db, TEST_PROFILE).result(resultId)!;
		expect(result).toMatchObject({ vocabBand: 3, clozeTheta: null, abilityBand: 3, cefr: 'A2', reliabilityFlags: ['cloze_skipped'] });
		expect(result.subscoresJson).toMatchObject({ lexical: null, grammar: null });
	});

	it('flags many false alarms and caps vocab_band at 2', async () => {
		const deps = engineDeps();
		const { view } = runTo(deps, startPlacement(deps), { knowsUpTo: 8, falseAlarms: true });
		const { resultId } = await submitPlacementWriting(deps, { attemptId: view.attemptId, skip: true });
		const result = placementRepo(deps.db, TEST_PROFILE).result(resultId)!;
		// f = 1 corrects every hit rate to 0, so band 1 (the cap of 2 is tested in staircase.spec.ts).
		expect(result.vocabBand).toBe(1);
		expect(result.subscoresJson.falseAlarmRate).toBe(1);
		expect(result.reliabilityFlags).toContain('many_false_alarms');
	});
});

describe('the server is authoritative', () => {
	it('accepts only the item it served, and the answer kind of the part', () => {
		const deps = engineDeps();
		const view = startPlacement(deps);
		if (view.part !== 'A') throw new Error('expected Part A');
		expectError(() => answerPlacement(deps, { attemptId: view.attemptId, itemRef: 'A0.5', answer: true, responseMs: 1 }), 409, 'stale');
		expectError(() => answerPlacement(deps, { attemptId: view.attemptId, itemRef: 'B0', answer: 1, responseMs: 1 }), 409, 'stale');
		expectError(() => answerPlacement(deps, { attemptId: view.attemptId, itemRef: view.ref, answer: 2, responseMs: 1 }), 400, 'invalid');
		expectError(() => answerPlacement(deps, { attemptId: 999, itemRef: view.ref, answer: true, responseMs: 1 }), 404, 'not_found');
	});

	it('treats a repeated submit as idempotent', () => {
		const deps = engineDeps();
		const view = startPlacement(deps);
		const next = answerPlacement(deps, { attemptId: view.attemptId, itemRef: (view as { ref: string }).ref, answer: true, responseMs: 900 });
		const again = answerPlacement(deps, { attemptId: view.attemptId, itemRef: (view as { ref: string }).ref, answer: false, responseMs: 900 });
		expect(again).toEqual(next);
		const state = placementRepo(deps.db, TEST_PROFILE).attempt(view.attemptId)!.stateJson as { log: unknown[] };
		expect(state.log).toHaveLength(1);
	});

	it('rejects answers to a finished attempt; a repeated writing submit returns the same result', async () => {
		const deps = engineDeps();
		const { view } = runTo(deps, startPlacement(deps), { knowsUpTo: 2 });
		expectError(() => answerPlacement(deps, { attemptId: view.attemptId, itemRef: 'C', answer: true, responseMs: 1 }), 409, 'stale');
		const first = await submitPlacementWriting(deps, { attemptId: view.attemptId, skip: true });
		const second = await submitPlacementWriting(deps, { attemptId: view.attemptId, text: 'Another try.' });
		expect(second).toEqual(first);
		expect(placementRepo(deps.db, TEST_PROFILE).resultCount()).toBe(1);
		expect(writingRepo(deps.db, TEST_PROFILE).queued()).toEqual([]);
		expectError(() => answerPlacement(deps, { attemptId: view.attemptId, itemRef: 'A0.0', answer: true, responseMs: 1 }), 409, 'finished');
	});

	it('refuses the writing before Part C and an empty text', async () => {
		const deps = engineDeps();
		const view = startPlacement(deps);
		await expect(submitPlacementWriting(deps, { attemptId: view.attemptId, skip: true })).rejects.toMatchObject({ status: 409, code: 'stale' });
		const { view: c } = runTo(deps, view, { knowsUpTo: 2 });
		await expect(submitPlacementWriting(deps, { attemptId: c.attemptId, text: '  ... ' })).rejects.toMatchObject({ status: 400 });
	});

	it('records the timing the server saw, and clamps the reported response time', () => {
		const deps = engineDeps();
		const view = startPlacement(deps);
		answerPlacement(deps, { attemptId: view.attemptId, itemRef: (view as { ref: string }).ref, answer: true, responseMs: 1e9 });
		const [entry] = (placementRepo(deps.db, TEST_PROFILE).attempt(view.attemptId)!.stateJson as { log: Record<string, number>[] }).log;
		expect(entry.answeredAt - entry.shownAt).toBe(1000);
		expect(entry.responseMs).toBe(600_000);
	});
});

describe('resume and retake', () => {
	it('resumes the attempt after a restart (new deps, same database)', () => {
		const deps = engineDeps();
		let view = startPlacement(deps);
		for (let i = 0; i < 8 && view.part === 'A'; i++) {
			view = answerPlacement(deps, { attemptId: view.attemptId, itemRef: view.ref, answer: !isPseudo(view.word), responseMs: 1 });
		}
		const restarted: EngineDeps = { ...engineDeps(), db: deps.db };
		expect(currentPlacement(restarted)).toEqual(view);
		expect(startPlacement(restarted)).toEqual(view);
		expect(placementOverview(deps.db, TEST_PROFILE)).toEqual({ completed: false, inProgress: true });
	});

	it('restart abandons the attempt in progress', () => {
		const deps = engineDeps();
		const first = startPlacement(deps);
		const second = startPlacement(deps, { restart: true });
		expect(second.attemptId).not.toBe(first.attemptId);
		expect(placementRepo(deps.db, TEST_PROFILE).attempt(first.attemptId)?.status).toBe('abandoned');
		expect(currentPlacement(deps)?.attemptId).toBe(second.attemptId);
	});

	it('a retake adds a result, keeps the old one, and the profile follows the latest', async () => {
		const deps = engineDeps();
		seedClozePool(deps.db, [1, 2, 3, 4, 5, 6, 7, 8], 12);
		const one = runTo(deps, startPlacement(deps), { knowsUpTo: 2, clozeCorrect: false }).view;
		const first = await submitPlacementWriting(deps, { attemptId: one.attemptId, skip: true });
		const two = runTo(deps, startPlacement(deps), { knowsUpTo: 6 }).view;
		const second = await submitPlacementWriting(deps, { attemptId: two.attemptId, skip: true });

		const repo = placementRepo(deps.db, TEST_PROFILE);
		expect(repo.resultCount()).toBe(2);
		const old = repo.result(first.resultId)!;
		const latest = repo.result(second.resultId)!;
		expect(latest.abilityBand).toBeGreaterThan(old.abilityBand);
		expect(profileRepo(deps.db, TEST_PROFILE).get()).toMatchObject({ knownBandCeiling: latest.vocabBand, cefrEstimate: latest.cefr });
		expect(resultView(deps.db, TEST_PROFILE, second.resultId)?.previous).toEqual({
			id: old.id,
			takenAt: old.takenAt.getTime(),
			cefr: old.cefr,
			abilityBand: old.abilityBand
		});
		expect(resultView(deps.db, TEST_PROFILE, first.resultId)?.previous).toBeNull();
	});
});

describe('Part C grading', () => {
	const text = 'On Saturday I went to the market with my sister. We bought fruit and fish.';

	it('a grade within the time limit is folded into the result', async () => {
		const grade = vi.fn(async () => ({ cefr: 'B1' as const, correctedText: text, errors: [] }));
		const deps = engineDeps({ grade });
		const { view } = runTo(deps, startPlacement(deps), { knowsUpTo: 4 });
		const { resultId } = await submitPlacementWriting(deps, { attemptId: view.attemptId, text: `  ${text} ` });
		expect(grade).toHaveBeenCalledWith({ prompt_vi: expect.stringContaining('Đề bài'), user_text: text, level_band: 4 });
		const result = placementRepo(deps.db, TEST_PROFILE).result(resultId)!;
		expect(result.writingStatus).toBe('scored');
		expect(result.subscoresJson.writing).toBe('B1');
		const submission = writingRepo(deps.db, TEST_PROFILE).byId(result.writingSubmissionId!)!;
		expect(submission).toMatchObject({ status: 'scored', sessionId: null, userText: text, cefrEstimate: 'B1' });
		expect(profileRepo(deps.db, TEST_PROFILE).get().writingTheta).toBe(3);
	});

	it('a failed grade leaves the writing queued', async () => {
		const logError = vi.fn();
		const deps = engineDeps({ grade: async () => Promise.reject(new Error('provider down')), logError });
		const { view } = runTo(deps, startPlacement(deps), { knowsUpTo: 4 });
		const { resultId } = await submitPlacementWriting(deps, { attemptId: view.attemptId, text });
		expect(placementRepo(deps.db, TEST_PROFILE).result(resultId)?.writingStatus).toBe('queued');
		expect(writingRepo(deps.db, TEST_PROFILE).queued()).toHaveLength(1);
		expect(logError).toHaveBeenCalledOnce();
	});

	it('no provider: queued without trying', async () => {
		const deps = engineDeps({ grade: null });
		const { view } = runTo(deps, startPlacement(deps), { knowsUpTo: 4 });
		const { resultId } = await submitPlacementWriting(deps, { attemptId: view.attemptId, text });
		expect(placementRepo(deps.db, TEST_PROFILE).result(resultId)?.writingStatus).toBe('queued');
	});

	it('a timeout finishes queued; a late grade still refines the result', async () => {
		let release: (value: { cefr: 'C1'; correctedText: string; errors: [] }) => void = () => {};
		const late = new Promise<{ cefr: 'C1'; correctedText: string; errors: [] }>((resolve) => (release = resolve));
		const deps = engineDeps({ grade: () => late, gradeTimeoutMs: 10 });
		seedClozePool(deps.db, [6, 7, 8], 12);
		const { view } = runTo(deps, startPlacement(deps), { knowsUpTo: 8 });
		const { resultId } = await submitPlacementWriting(deps, { attemptId: view.attemptId, text });
		const repo = placementRepo(deps.db, TEST_PROFILE);
		expect(repo.result(resultId)).toMatchObject({ writingStatus: 'queued', cefr: 'B2' });
		release({ cefr: 'C1', correctedText: text, errors: [] });
		await late;
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(repo.result(resultId)).toMatchObject({ writingStatus: 'scored', cefr: 'C1' });
		expect(profileRepo(deps.db, TEST_PROFILE).get().cefrEstimate).toBe('C1');
	});
});
