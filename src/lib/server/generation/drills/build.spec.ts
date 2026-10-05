import { describe, expect, it } from 'vitest';
import { cacheRepo } from '../../db/repositories/cache.ts';
import { unlimitedBudget } from '../batch.ts';
import { cannedWorld } from '../test-fixtures.ts';
import { buildDrills, drillParamsHash } from './build.ts';
import type { DrillPayload } from './rules.ts';

describe('buildDrills', () => {
	it('injects, explains, checks and critiques drills, then stores them', async () => {
		const { fx, llm, context, requests } = cannedWorld();
		const summary = await buildDrills(
			[
				{ topic: 'COP', band: 1, count: 2 },
				{ topic: 'COL', band: 1, count: 2 }
			],
			{ llm, ...context },
			{ budget: unlimitedBudget }
		);
		expect(summary.added).toEqual({ 'error:COP': { 1: 2 }, 'error:COL': { 1: 2 } });
		expect(requests.map((r) => r.purpose)).toEqual(['drill_generate', 'drill_explain', 'drill_critic']);
		const stored = cacheRepo(fx.db).byKind('error', true);
		expect(stored).toHaveLength(4);
		for (const item of stored) {
			const d = item.payloadJson as DrillPayload;
			expect(item.paramsHash).toBe(drillParamsHash(d.topic_code));
			expect(d.explanation_vi).not.toBe('');
			if (d.source === 'tatoeba') {
				expect(d.sentence_with_error).toMatch(/^The \w+ very big\.$/);
				expect(item.promptVersion).toBe('drill-explain@1+drill-critic@1');
				expect(d.sentence_id).toBeTypeOf('number');
			} else {
				expect(item.promptVersion).toBe('drill-generate@1+drill-critic@1');
			}
		}
	});

	it('the critic sees only the erroneous sentence', async () => {
		const { llm, context, requests } = cannedWorld();
		await buildDrills([{ topic: 'COP', band: 1, count: 1 }], { llm, ...context }, { budget: unlimitedBudget });
		const critic = requests.find((r) => r.purpose === 'drill_critic')!;
		expect(Object.keys((critic.payload.items as object[])[0]).sort()).toEqual(['n', 'sentence']);
	});

	it('stores critic rejections with their reason, and skips them on a rerun', async () => {
		const { fx, llm, context } = cannedWorld({ knownSentences: { has: () => true } }); // the critic finds nothing wrong
		const first = await buildDrills([{ topic: 'COP', band: 1, count: 2 }], { llm, ...context }, { budget: unlimitedBudget });
		expect(first.rejected).toEqual({ 'critic:no_error_found': 2 });
		const rejected = cacheRepo(fx.db).byKind('error', false);
		expect(JSON.parse(rejected[0].validationNotes!).reason).toBe('critic:no_error_found');
		await buildDrills([{ topic: 'COP', band: 1, count: 2 }], { llm, ...context }, { budget: unlimitedBudget });
		expect(new Set(cacheRepo(fx.db).byKind('error', false).map((i) => i.contentHash)).size).toBe(4);
	});

	it('does not store drills whose explanation call failed', async () => {
		const { fx, llm, context } = cannedWorld({ onRequest: (_p, purpose) => (purpose === 'drill_explain' ? 'invalid' : 'ok') });
		const summary = await buildDrills([{ topic: 'COP', band: 1, count: 2 }], { llm, ...context }, { budget: unlimitedBudget });
		expect(summary.llmFailed).toEqual({ 'llm:schema': 2 });
		expect(cacheRepo(fx.db).byKind('error', true)).toEqual([]);
		expect(cacheRepo(fx.db).byKind('error', false)).toEqual([]);
	});
});
