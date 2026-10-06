import { describe, expect, it } from 'vitest';
import { clozeItemsRepo } from '../../db/repositories/cloze-items.ts';
import { llmCallsRepo } from '../../db/repositories/llm-calls.ts';
import { sentencesRepo } from '../../db/repositories/sentences.ts';
import { testDeps } from '../../llm/test-helpers.ts';
import { type Fixture, fixtureDb } from '../test-fixtures.ts';
import { tokenize, withGap } from '../tokens.ts';
import { unlimitedBudget } from '../batch.ts';
import { DailyCapError } from '../budget.ts';
import { type BuildOptions, buildCloze, formatSummary } from './build.ts';
import { type CannedOptions, cannedFetch } from '../canned-llm.ts';
import { type Candidate, candidateHash } from './candidates.ts';
import { fetchDistractors } from './distractors.ts';

function setup(overrides: Partial<CannedOptions> = {}) {
	const fx = fixtureDb();
	const corpus = sentencesRepo(fx.db).all().map((s) => s.enText);
	const requests: { items: unknown[] }[] = [];
	const fetch = cannedFetch({
		forms: fx.forms,
		blocklist: fx.blocklist,
		isWord: fx.isWord,
		corpus,
		...overrides,
		onRequest: (payload, purpose) => {
			requests.push(payload);
			return overrides.onRequest?.(payload, purpose) ?? 'ok';
		}
	});
	const { deps } = testDeps(fx.db, fetch);
	return { fx, llm: deps, requests, buildDeps: { llm: deps, isWord: fx.isWord, blocklist: fx.blocklist } };
}

const options = (o: Partial<BuildOptions> = {}): BuildOptions => ({ limit: 200, maxCalls: 50, dailyCap: 500, ...o });

/** 23 synthetic lexical candidates over the fixture sentences. */
function lexicalCandidates(fx: Fixture, n: number): Candidate[] {
	const sentences = sentencesRepo(fx.db).all().filter((s) => s.enText.startsWith('The '));
	return Array.from({ length: n }, (_, i) => {
		const s = sentences[i % sentences.length];
		const answer = i < sentences.length ? 'big' : 'very';
		const tokenIndex = tokenize(s.enText).findIndex((t) => t.text === answer);
		return {
			sentenceId: s.id,
			enText: s.enText,
			viText: s.viText,
			gapType: 'lexical',
			tokenIndex,
			answer,
			options: null,
			initial: false,
			lexemeId: null,
			topicCode: null,
			levelBand: 1,
			contentHash: candidateHash(s.id, 'lexical', tokenIndex, `${answer}${i}`)
		};
	});
}

describe('batching', () => {
	it('sends 23 items in 3 calls of 10, 10 and 3', async () => {
		const { fx, llm, requests } = setup();
		const run = await fetchDistractors(lexicalCandidates(fx, 23), llm, { budget: unlimitedBudget });
		expect(requests.map((r) => r.items.length)).toEqual([10, 10, 3]);
		expect(run.calls).toBe(3);
		expect(run.results.size).toBe(23);
		expect(llmCallsRepo(fx.db).all()).toHaveLength(3);
		const first = requests[0].items[0] as Record<string, unknown>;
		expect(first).toEqual({ n: 1, sentence: withGap('The dog is very big.', tokenize('The dog is very big.'), 4), answer: 'big', vi: '(vi) The dog is very big.' });
	});

	it('a schema failure in one batch does not lose the others', async () => {
		const cands = lexicalCandidates(fx0(), 23);
		const secondBatchFirst = withGap(cands[10].enText, tokenize(cands[10].enText), cands[10].tokenIndex);
		const { fx, llm, requests } = setup({
			onRequest: (payload) => ((payload.items[0] as { sentence?: string }).sentence === secondBatchFirst && payload.items.length === 10 ? 'invalid' : 'ok')
		});
		const run = await fetchDistractors(lexicalCandidates(fx, 23), llm, { budget: unlimitedBudget });
		expect(run.failures).toHaveLength(1);
		expect(run.failures[0].reason).toBe('llm:schema');
		expect(run.failures[0].items.map((c) => c.contentHash)).toEqual(cands.slice(10, 20).map((c) => c.contentHash));
		expect(run.results.size).toBe(13);
		// batch 2 was tried twice (the repair round), then the run moved on to batch 3
		expect(requests.map((r) => r.items.length)).toEqual([10, 10, 10, 3]);
	});
});

// Content hashes depend only on sentence ids, which are the same in every fresh fixture.
const fx0 = () => fixtureDb();

describe('buildCloze', () => {
	it('runs candidates -> distractors -> rules -> critic -> store', async () => {
		const { fx, buildDeps } = setup();
		const summary = await buildCloze(options(), buildDeps);
		const repo = clozeItemsRepo(fx.db);
		const validated = repo.byValidated(true);
		const rejected = repo.byValidated(false);
		// Article gaps only where a rule fixes the answer (Phase 11), so fewer items than before.
		expect(summary.stored).toBeGreaterThan(15);
		expect(validated.length).toBeGreaterThan(15);
		expect(validated.length + rejected.length).toBe(summary.stored);
		// The fixture's template sentences make some noun distractors fit too: the critic catches them.
		for (const item of rejected) expect(item).toMatchObject({ ruleOk: true, criticOk: false });
		expect(rejected.length).toBe(summary.criticRejections.lexical + summary.criticRejections.article + summary.criticRejections.preposition);
		expect(summary.selected.lexical).toBeGreaterThan(0);
		expect(summary.selected.article + summary.selected.preposition + summary.selected.verb_form).toBeGreaterThan(0);
		for (const item of validated) {
			expect(item.options).toHaveLength(4);
			expect(item.options).toContain(item.answer);
			expect(item).toMatchObject({ ruleOk: true, criticOk: true, rejectionReason: null });
			expect(item.promptVersion).toMatch(item.gapType === 'lexical' ? /^cloze-distractors@\d+\+cloze-critic@\d+$/ : /^cloze-critic@\d+$/);
			if (item.gapType === 'lexical') expect(item.answerVi).toBe(`(${item.answer})`);
			if (item.gapType !== 'lexical') expect(item.grammarTopicId).not.toBeNull();
		}
		expect(formatSummary(summary).join('\n')).toContain('validated (type x band)');
	});

	it('skips existing content hashes on a rerun', async () => {
		const { fx, buildDeps } = setup();
		const first = await buildCloze(options({ limit: 10 }), buildDeps);
		expect(first.stored).toBe(10);
		const second = await buildCloze(options({ limit: 10 }), buildDeps);
		expect(second.stored).toBe(10);
		const repo = clozeItemsRepo(fx.db);
		const hashes = [...repo.byValidated(true), ...repo.byValidated(false)].map((i) => i.contentHash);
		expect(new Set(hashes).size).toBe(20);
	});

	it('stores critic rejections as not validated', async () => {
		const { fx, buildDeps } = setup({ knownSentences: { has: () => true } });
		const summary = await buildCloze(options({ limit: 12 }), buildDeps);
		expect(summary.stored).toBe(12);
		const rejected = clozeItemsRepo(fx.db).byValidated(false);
		expect(rejected).toHaveLength(12);
		for (const item of rejected) expect(item).toMatchObject({ ruleOk: true, criticOk: false, rejectionReason: 'critic:several_acceptable (A, B, C, D)' });
		expect(summary.criticReasons).toEqual({ 'critic:several_acceptable': 12 });
	});

	it('does not store items whose LLM call failed, so a rerun retries them', async () => {
		const { fx, buildDeps } = setup({ onRequest: (p) => ('sentences' in (p.items[0] as object) ? 'invalid' : 'ok') });
		const summary = await buildCloze(options({ limit: 12 }), buildDeps);
		expect(summary.stored).toBe(0);
		expect(summary.llmFailed).toBe(12);
		expect(summary.llmFailureReasons).toEqual({ 'llm:schema': 12 });
		expect(clozeItemsRepo(fx.db).counts()).toEqual([]);
	});
});

describe('cost guards', () => {
	it('--max-calls stops the run', async () => {
		const { fx, buildDeps, requests } = setup();
		const summary = await buildCloze(options({ maxCalls: 2 }), buildDeps);
		expect(requests).toHaveLength(2);
		expect(llmCallsRepo(fx.db).all()).toHaveLength(2);
		expect(summary.llm.calls).toBe(2);
		expect(summary.budgetExhausted).toBe(true);
		expect(summary.notRun).toBeGreaterThan(0);
	});

	it('refuses to start when the last 24 h reached the daily cap', async () => {
		const { fx, buildDeps, requests } = setup();
		const now = buildDeps.llm.now();
		const calls = llmCallsRepo(fx.db);
		const row = { providerId: 1, model: 'm', purpose: 'p', mode: 'json_schema' as const, attempt: 1, ok: true, httpStatus: 200, errorCode: null, inputTokens: 1, outputTokens: 1, latencyMs: 1 };
		calls.record({ ...row, createdAt: new Date(now.getTime() - 25 * 3600_000) });
		for (let i = 0; i < 3; i++) calls.record({ ...row, createdAt: new Date(now.getTime() - 3600_000) });
		await expect(buildCloze(options({ dailyCap: 3 }), buildDeps)).rejects.toThrow(DailyCapError);
		expect(requests).toHaveLength(0);
		// the call older than 24 h does not count; the cap also bounds the run itself
		const summary = await buildCloze(options({ dailyCap: 5 }), buildDeps);
		expect(summary.llm.calls).toBe(2);
		expect(summary.budgetExhausted).toBe(true);
	});
});
