import { describe, expect, it } from 'vitest';
import { cacheRepo } from '../../db/repositories/cache.ts';
import { lexemesRepo } from '../../db/repositories/lexemes.ts';
import { createTestDb } from '../../db/test-db.ts';
import type { Response as Passage } from '../../llm/prompts/reading-passage.ts';
import { unlimitedBudget } from '../batch.ts';
import { blocklistMatcher, parseBlocklist } from '../blocklist.ts';
import { buildFormIndex } from '../forms.ts';
import { importLexemes } from '../import.ts';
import { NGSL, cannedWorld } from '../test-fixtures.ts';
import { type ReadingPayload, buildReading, pickTopics } from './build.ts';
import { allowedWords, coverage, wordCount } from './coverage.ts';
import { EVERYDAY_WORDS, isEveryday } from './everyday.ts';
import { openaiContent, scriptedFetch, testDeps } from '../../llm/test-helpers.ts';
import { fixtureDb } from '../test-fixtures.ts';
import { judgeReading } from './critic.ts';
import { checkPassage, inPassage, wordRange } from './rules.ts';
import { TOPICS } from './topics.ts';

const db = createTestDb();
importLexemes(db, NGSL);
const forms = buildFormIndex(lexemesRepo(db).all());
const deps = { forms, blocklist: blocklistMatcher(parseBlocklist('kill\n'), forms) };

describe('coverage', () => {
	it('matches a hand-checked count', () => {
		// Fixture bands: dog 1, happy 2, rose 3; "purple" is not in NGSL.
		// Words: Tom(name) has(fn) a(fn) purple(off-list) dog(1) The(fn) dog(1) is(fn) happy(2) It(fn)
		// doesn't(-> does, fn) like(fn) the(fn) rose(3) = 14 words; uncovered at band 1: purple, rose.
		const text = "Tom has a purple dog. The dog is happy. It doesn't like the rose.";
		const band1 = coverage(text, 1, forms);
		expect(band1).toEqual({ total: 14, covered: 12, ratio: 12 / 14, uncovered: ['purple', 'rose'] });
		// At band 2, band + 1 = 3 covers "rose".
		expect(coverage(text, 2, forms).uncovered).toEqual(['purple']);
		expect(wordCount('I have 2 dogs, and a cat.')).toBe(7); // the number counts, the comma does not
	});
});

describe('everyday words (Phase 11)', () => {
	it('count as known up to band 4, plurals and verb forms included', () => {
		// Not in the fixture NGSL: without the allowlist all six would be above the level.
		const text = 'Tom has cake and soup in bowls. I borrowed a gift online.';
		const band2 = coverage(text, 2, forms);
		expect(band2.uncovered).toEqual([]);
		expect(band2.ratio).toBe(1);
		const band5 = coverage(text, 5, forms);
		expect(band5.uncovered).toEqual(['cake', 'soup', 'bowls', 'borrowed', 'gift', 'online']);
		expect(band5.covered).toBe(band5.total - 6);
		expect([isEveryday('bowls'), isEveryday('borrowed'), isEveryday('cooking'), isEveryday('zebra')]).toEqual([true, true, true, false]);
		expect(EVERYDAY_WORDS.size).toBeGreaterThanOrEqual(150);
	});

	it('the prompt word list: band lemmas without function words, plus everyday words up to band 4', () => {
		const band1 = allowedWords(1, forms);
		expect(band1).toContain('dog');
		expect(band1).not.toContain('the');
		expect(band1).toContain('soup');
		expect(allowedWords(5, forms)).not.toContain('soup');
		// The NGSL part is capped (most frequent first); the everyday words follow.
		expect(allowedWords(1, forms, 1).length).toBeLessThan(band1.length);
		expect(allowedWords(1, forms, 1)[0]).toBe(band1[0]);
	});
});

const passage = (overrides: Partial<Passage> = {}): Passage => ({
	title_en: 'My dog',
	passage_en: Array.from({ length: 15 }, () => 'The dog is happy.').join(' '), // 60 words, all band 1-2
	questions: [
		{ question_en: 'Is the dog happy?', options: ['Yes', 'No', 'Not said', 'Sometimes'], answer_index: 0, explanation_vi: 'Bài viết nói vậy.' },
		{ question_en: 'What is happy?', options: ['The dog', 'The cat', 'The bird', 'The tree'], answer_index: 0, explanation_vi: 'Con chó.' }
	],
	glossary: [{ word: 'happy', vi: 'vui' }],
	...overrides
});

describe('checkPassage', () => {
	it('passes a passage in range with full coverage', () => {
		expect(checkPassage(passage(), 1, deps)).toEqual({ ok: true });
	});

	it('enforces the word-count bounds per band', () => {
		expect(wordRange(1)).toEqual([60, 90]);
		expect(wordRange(2)).toEqual([60, 90]);
		expect(wordRange(3)).toEqual([90, 130]);
		expect(wordRange(4)).toEqual([90, 130]);
		expect(wordRange(5)).toEqual([130, 170]);
		expect(wordRange(6)).toEqual([130, 170]);
		expect(wordRange(7)).toEqual([170, 220]);
		expect(wordRange(8)).toEqual([170, 220]);
		const short = passage({ passage_en: Array.from({ length: 14 }, () => 'The dog is happy.').join(' ') }); // 56 words
		expect(checkPassage(short, 1, deps)).toMatchObject({ ok: false, code: 'word_count' });
		expect(checkPassage(passage(), 3, deps)).toMatchObject({ ok: false, code: 'word_count' }); // 60 < 90
	});

	it('fails below 95% coverage', () => {
		// 60 covered words + 4 off-list words: 60/64 = 93.75%.
		const text = `${Array.from({ length: 15 }, () => 'The dog is happy.').join(' ')} Zorp blim quax fren.`;
		expect(checkPassage(passage({ passage_en: text }), 1, deps)).toMatchObject({ ok: false, code: 'coverage' });
	});

	it('fails when a glossary word is not in the passage', () => {
		expect(checkPassage(passage({ glossary: [{ word: 'garden', vi: 'vườn' }] }), 1, deps)).toMatchObject({ ok: false, code: 'glossary_missing', detail: 'garden' });
		expect(inPassage('dogs', 'The dog is happy.', forms)).toBe(true); // another form of the lemma counts
	});

	it('fails on duplicate options and blocklisted words', () => {
		const q = passage().questions;
		expect(checkPassage(passage({ questions: [{ ...q[0], options: ['Yes', 'yes', 'No', 'Maybe'] }, q[1]] }), 1, deps)).toMatchObject({ code: 'options_duplicate' });
		expect(checkPassage(passage({ title_en: 'Kill the dog' }), 1, deps)).toMatchObject({ code: 'blocklisted' });
	});
});

describe('judgeReading', () => {
	it('accepts when the critic picks the intended option and finds it the only defensible one', () => {
		expect(judgeReading([2, 0], [{ q: 1, chosen: 'C', defensible: ['C'] }, { q: 2, chosen: 'A', defensible: ['A'] }]).ok).toBe(true);
	});
	it('rejects a different choice, an ambiguous question, or a missing answer', () => {
		expect(judgeReading([2, 0], [{ q: 1, chosen: 'B', defensible: ['B'] }, { q: 2, chosen: 'A', defensible: ['A'] }]).reason).toBe('critic:wrong_answer (q1: B, intended C)');
		expect(judgeReading([2, 0], [{ q: 1, chosen: 'C', defensible: ['C', 'D'] }, { q: 2, chosen: 'A', defensible: ['A'] }]).reason).toBe('critic:ambiguous (q1: C, D defensible)');
		expect(judgeReading([2, 0], [{ q: 1, chosen: 'C', defensible: ['C'] }]).reason).toBe('critic:missing_answer (q2)');
	});
});

describe('buildReading', () => {
	it('picks the least used topics first', () => {
		const used = new Map(TOPICS.map((t) => [t.id, 1]));
		used.set('weather', 0);
		expect(pickTopics(1, 2, used)[0]).toBe('weather');
		expect(new Set(pickTopics(1, 20, new Map())).size).toBe(20);
	});

	it('generates, checks, critiques and stores a passage with shuffled options', async () => {
		const { fx, llm, context, requests } = cannedWorld();
		const summary = await buildReading([{ band: 1, count: 1 }], { llm, forms: context.forms, blocklist: context.blocklist }, { budget: unlimitedBudget });
		expect(summary.added).toEqual({ reading: { 1: 1 } });
		expect(requests.map((r) => r.purpose)).toEqual(['reading_passage', 'reading_critic']);
		const critic = requests[1].payload.items as { questions: Record<string, unknown>[] }[];
		expect(Object.keys(critic[0].questions[0]).sort()).toEqual(['options', 'q', 'question']); // no answer
		const [item] = cacheRepo(fx.db).byKind('reading', true);
		const payload = item.payloadJson as ReadingPayload;
		expect(item.promptVersion).toBe('reading-passage@2+reading-critic@1');
		expect(payload.coverage).toBe(1);
		for (const q of payload.questions) expect(payload.passage_en).toContain(q.options[q.answer_index]);
	});
});

describe('the coverage retry', () => {
	const lowCoverage = (): Passage => passage({ passage_en: Array.from({ length: 15 }, () => 'The zebra is purple.').join(' '), glossary: [] });
	const run = async (second: Passage) => {
		const fx = fixtureDb();
		const { fetch, requests } = scriptedFetch([
			openaiContent(JSON.stringify(lowCoverage())),
			openaiContent(JSON.stringify(second)),
			{ status: 400, body: { error: { message: 'critic not scripted' } } }
		]);
		const { deps: llm } = testDeps(fx.db, fetch);
		const summary = await buildReading([{ band: 1, count: 1 }], { llm, forms: fx.forms, blocklist: fx.blocklist }, { budget: unlimitedBudget });
		return { summary, requests };
	};

	it('sends the words above the level back once and judges the rewrite', async () => {
		const { summary, requests } = await run(passage());
		const user = (requests[1].body.messages as { role: string; content: string }[]).find((m) => m.role === 'user')!.content;
		expect(user).toContain('zebra, purple');
		expect(user).toContain('Rewrite it');
		expect(JSON.parse(user.slice(user.indexOf('{')).split('\n\n')[0]).allowed_words).toContain('dog');
		expect(summary.rejected).toEqual({ 'reading:coverage_retry': 1 });
		expect(requests).toHaveLength(3); // the rewrite passed the rules and went to the critic
	});

	it('rejects after one failed rewrite', async () => {
		const { summary, requests } = await run(lowCoverage());
		expect(requests).toHaveLength(2);
		expect(Object.keys(summary.rejected).sort()).toEqual(['reading:coverage_retry', 'rule:coverage']);
	});
});
