import { describe, expect, it } from 'vitest';
import { placementRepo } from '../db/repositories/placement.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import { cannedWorld } from '../generation/test-fixtures.ts';
import { startPlacement, submitPlacementWriting, answerPlacement } from '../placement/engine.ts';
import type { PlacementView } from '../../placement.ts';
import { engineDeps, isPseudo } from '../placement/test-fixtures.ts';
import { gradeQueuedWritings } from './queued.ts';

const TEXT = 'On Saturday I went to the market with my sister. We bought some fish.';

/** A placement finished with its writing queued (the live grading failed). */
async function queuedPlacement(db: ReturnType<typeof cannedWorld>['fx']['db']) {
	const deps = { ...engineDeps({ grade: () => Promise.reject(new Error('timeout')) }), db };
	let view: PlacementView = startPlacement(deps);
	while (view.part === 'A') view = answerPlacement(deps, { attemptId: view.attemptId, itemRef: view.ref, answer: !isPseudo(view.word), responseMs: 1 });
	return submitPlacementWriting(deps, { attemptId: view.attemptId, text: TEXT });
}

describe('gradeQueuedWritings', () => {
	it('grades a queued placement writing and refines the result and the profile', async () => {
		const { fx, llm, requests } = cannedWorld();
		const { resultId } = await queuedPlacement(fx.db);
		const repo = placementRepo(fx.db);
		const before = repo.result(resultId)!;
		expect(before.writingStatus).toBe('queued');

		const summary = await gradeQueuedWritings({ maxCalls: 5 }, { llm, dailyCap: 100 });
		expect(summary).toEqual({ graded: 1, failed: 0, remaining: 0 });
		expect(requests.map((r) => r.purpose)).toEqual(['grade_writing']);
		const after = repo.result(resultId)!;
		// The canned grader answers with the CEFR of the level it is given (band 8 → B2).
		expect(after).toMatchObject({ writingStatus: 'scored', subscoresJson: { writing: 'B2' } });
		expect(after.itemLogJson).toEqual(before.itemLogJson);
		expect(writingRepo(fx.db).byId(after.writingSubmissionId!)).toMatchObject({ status: 'scored', cefrEstimate: 'B2' });
		expect(profileRepo(fx.db).get().writingTheta).toBe(4);
	});

	it('does nothing (no budget, no call) when nothing is queued', async () => {
		const { llm, requests } = cannedWorld();
		expect(await gradeQueuedWritings({ maxCalls: 5 }, { llm, dailyCap: 100 })).toEqual({ graded: 0, failed: 0, remaining: 0 });
		expect(requests).toEqual([]);
	});

	it('stops at the first LLM failure and leaves the rest queued', async () => {
		const { fx, llm } = cannedWorld({ onRequest: () => 'invalid' });
		await queuedPlacement(fx.db);
		writingRepo(fx.db).queue({ sessionId: null, prompt: 'Viết về gia đình.', userText: 'I have a sister.', submittedAt: new Date(0) });
		const summary = await gradeQueuedWritings({ maxCalls: 20 }, { llm, dailyCap: 100 });
		expect(summary).toEqual({ graded: 0, failed: 1, remaining: 2 });
	});

	it('respects the call budget', async () => {
		const { fx, llm } = cannedWorld();
		for (const n of [1, 2]) writingRepo(fx.db).queue({ sessionId: null, prompt: 'Viết.', userText: `Text number ${n}.`, submittedAt: new Date(n) });
		expect(await gradeQueuedWritings({ maxCalls: 1 }, { llm, dailyCap: 100 })).toEqual({ graded: 1, failed: 0, remaining: 1 });
	});
});
