import { describe, expect, it } from 'vitest';
import { llmCallsRepo } from '../db/repositories/llm-calls.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import { DailyCapError } from './budget.ts';
import { DRILL_CODES } from './drills/build.ts';
import { type StockLevels, bandsInRange, computeShortfall, orderCheapestFirst, prefetch, readStockLevels } from './prefetch.ts';
import { cannedWorld } from './test-fixtures.ts';

const empty = (ceiling: number): StockLevels => ({ ceiling, cloze: new Map(), drills: new Map(), reading: new Map() });
const targets = { clozePerBand: 60, readingPerBand: 4, drillsPerTopicPerBand: 8 };

describe('computeShortfall', () => {
	it('covers bands 1 .. ceiling + 1, every kind and every drill code', () => {
		expect(bandsInRange(1)).toEqual([1, 2]);
		expect(bandsInRange(8)).toHaveLength(8);
		const shortfall = computeShortfall(empty(1), targets);
		expect(shortfall).toHaveLength(2 * (1 + DRILL_CODES.length + 1));
		expect(shortfall[0]).toEqual({ kind: 'cloze', band: 1, have: 0, target: 60, missing: 60 });
	});

	it('subtracts current stock and drops full stocks', () => {
		const levels: StockLevels = {
			ceiling: 0,
			cloze: new Map([[1, 70]]),
			drills: new Map([['ART|1', 5], ...DRILL_CODES.filter((c) => c !== 'ART').map((c) => [`${c}|1`, 8] as [string, number])]),
			reading: new Map([[1, 1]])
		};
		expect(computeShortfall(levels, targets)).toEqual([
			{ kind: 'drill-injected', band: 1, topic: 'ART', have: 5, target: 8, missing: 3 },
			{ kind: 'reading', band: 1, have: 1, target: 4, missing: 3 }
		]);
	});

	it('orders cheapest first: cloze, injected drills, LLM drills, reading', () => {
		const shuffled = [...computeShortfall(empty(2), targets)].reverse();
		const kinds = orderCheapestFirst(shuffled).map((s) => s.kind);
		const firstOf = (k: string) => kinds.indexOf(k as never);
		const lastOf = (k: string) => kinds.lastIndexOf(k as never);
		expect(lastOf('cloze')).toBeLessThan(firstOf('drill-injected'));
		expect(lastOf('drill-injected')).toBeLessThan(firstOf('drill-llm'));
		expect(lastOf('drill-llm')).toBeLessThan(firstOf('reading'));
	});
});

describe('prefetch', () => {
	it('fills stock cheapest first and reports what it added', async () => {
		const { fx, llm, context, requests } = cannedWorld();
		expect(profileRepo(fx.db).get().knownBandCeiling).toBe(1); // bands 1-2
		const summary = await prefetch({ maxCalls: 100 }, { llm, context, dailyCap: 500, targets: { clozePerBand: 4, readingPerBand: 1, drillsPerTopicPerBand: 1 } });
		expect(summary.steps).toEqual(['cloze', 'drill-injected', 'drill-llm', 'reading']);
		const purposes = [...new Set(requests.map((r) => r.purpose))];
		expect(purposes.indexOf('cloze_critic')).toBeLessThan(purposes.indexOf('drill_explain'));
		expect(purposes.indexOf('drill_explain')).toBeLessThan(purposes.indexOf('drill_generate'));
		expect(purposes.indexOf('drill_generate')).toBeLessThan(purposes.indexOf('reading_passage'));
		expect(summary.added.cloze[1]).toBeGreaterThanOrEqual(4);
		expect(summary.added.reading).toEqual({ 1: 1, 2: 1 });
		expect(summary.llm.calls).toBe(requests.length);
		// A second run finds the stock it filled.
		const levels = readStockLevels(fx.db);
		expect(levels.reading.get(1)).toBe(1);
		expect(levels.cloze.get(1)).toBeGreaterThanOrEqual(4);
	});

	it('grades queued writings before filling the stock, on the same budget', async () => {
		const { fx, llm, context, requests } = cannedWorld();
		writingRepo(fx.db).queue({ sessionId: null, prompt: 'Viết về gia đình.', userText: 'I have one sister.', submittedAt: new Date(0) });
		const summary = await prefetch({ maxCalls: 2 }, { llm, context, dailyCap: 500 });
		expect(summary.writing).toEqual({ graded: 1, failed: 0, remaining: 0 });
		expect(requests[0].purpose).toBe('grade_writing');
		expect(summary.llm.calls).toBe(2);
	});

	it('stops at maxCalls', async () => {
		const { fx, llm, context, requests } = cannedWorld();
		const summary = await prefetch({ maxCalls: 3 }, { llm, context, dailyCap: 500 });
		expect(requests).toHaveLength(3);
		expect(llmCallsRepo(fx.db).all()).toHaveLength(3);
		expect(summary.llm.calls).toBe(3);
		expect(summary.budgetExhausted).toBe(true);
		expect(summary.steps).toEqual(['cloze']); // never reached the dearer kinds
	});

	it('refuses to start at the daily cap', async () => {
		const { fx, llm, context, requests } = cannedWorld();
		const row = { providerId: 1, model: 'm', purpose: 'p', mode: 'json_schema' as const, attempt: 1, ok: true, httpStatus: 200, errorCode: null, inputTokens: 1, outputTokens: 1, latencyMs: 1 };
		llmCallsRepo(fx.db).record({ ...row, createdAt: llm.now() });
		await expect(prefetch({ maxCalls: 10 }, { llm, context, dailyCap: 1 })).rejects.toThrow(DailyCapError);
		expect(requests).toHaveLength(0);
	});
});
