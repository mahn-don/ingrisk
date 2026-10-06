import { describe, expect, it } from 'vitest';
import { cardsRepo } from '../db/repositories/cards.ts';
import { clozeItemsRepo } from '../db/repositories/cloze-items.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import { sentencesRepo } from '../db/repositories/sentences.ts';
import { buildFormIndex } from '../generation/forms.ts';
import { composeSession } from './compose.ts';
import { finishSession, startSession } from './engine.ts';
import { locateCorrection, mineErrors, minedOptions, splitSentences } from './mining.ts';
import { DAY, MINUTE, T0, setup } from './test-fixtures.ts';

const forms = buildFormIndex([
	{ id: 1, headword: 'go', forms: ['go', 'goes', 'went', 'gone', 'going', 'goings'], freqBand: 1, ngslRank: 1 },
	{ id: 2, headword: 'child', forms: ['child', 'children'], freqBand: 1, ngslRank: 2 }
]);
const error = (original: string, correction: string, topic_code: string) => ({ original, correction, topic_code: topic_code as 'TNS', explanation_vi: 'Giải thích.' });

describe('locateCorrection', () => {
	it('finds the one sentence and token span holding the correction', () => {
		expect(splitSentences('I went home. Then I slept! OK?')).toEqual(['I went home.', 'Then I slept!', 'OK?']);
		expect(locateCorrection('Yesterday I went to the market. It was busy.', 'went')).toEqual({ sentence: 'Yesterday I went to the market.', tokenIndex: 2, tokenCount: 1 });
		expect(locateCorrection('I went to the market.', 'to the market')).toEqual({ sentence: 'I went to the market.', tokenIndex: 2, tokenCount: 3 });
		expect(locateCorrection('I WENT home.', 'went')).toMatchObject({ tokenIndex: 1 });
	});

	it('skips a correction that is missing, ambiguous, empty or longer than 4 tokens', () => {
		expect(locateCorrection('I went home.', 'gone')).toEqual({ skip: 'missing' });
		expect(locateCorrection('I went home. She went too.', 'went')).toEqual({ skip: 'ambiguous' });
		expect(locateCorrection('I went to the went.', 'went')).toEqual({ skip: 'ambiguous' });
		expect(locateCorrection('I went home.', '')).toEqual({ skip: 'empty' });
		expect(locateCorrection('I went to the big market.', 'went to the big market')).toEqual({ skip: 'too_long' });
		// "went" inside "wentworth" is not a match: whole tokens only.
		expect(locateCorrection('Wentworth went home.', 'went')).toMatchObject({ tokenIndex: 1 });
	});
});

describe('minedOptions', () => {
	it('fills the options from the tables, always with the learner form', () => {
		const tns = minedOptions(error('goed', 'went', 'TNS'), 'went', false, forms, 'seed');
		expect(tns.typingOnly).toBe(false);
		expect(tns.options).toHaveLength(4);
		expect(tns.options).toContain('went');
		expect(tns.options).toContain('goed');
		expect(tns.options.every((o) => ['went', 'goed', 'go', 'goes', 'gone', 'going'].includes(o))).toBe(true);
		const pre = minedOptions(error('of', 'on', 'PRE'), 'on', false, forms, 'seed');
		expect(pre.options).toContain('of');
		expect(pre.options).toContain('on');
		const art = minedOptions(error('an', 'a', 'ART'), 'A', true, forms, 'seed');
		expect(art.options).toContain('A');
		expect(art.options).toContain('An');
	});

	it('is typing-only for codes without a table, multi-word answers, or too few distractors', () => {
		expect(minedOptions(error('do a mistake', 'make a mistake', 'COL'), 'make', false, forms, 's')).toEqual({ options: [], typingOnly: true });
		expect(minedOptions(error('go to market', 'go to the market', 'ART'), 'go to the market', false, forms, 's').typingOnly).toBe(true);
		// "childs" + "child" only: 2 distractors.
		expect(minedOptions(error('childs', 'children', 'PLU'), 'children', false, forms, 's')).toEqual({ options: [], typingOnly: true });
	});
});

describe('mineErrors', () => {
	const source = {
		correctedText: 'Yesterday I went to the market with my mother. We bought fish.',
		errors: [error('goed', 'went', 'TNS'), error('do a mistake', 'make a mistake', 'COL'), error('buyed', 'bought', 'TNS')],
		viText: 'Hôm qua bạn đã làm gì?',
		levelBand: 2
	};

	it('makes a user_error item, its own sentence row and a New card per located error', () => {
		const { db } = setup();
		const result = mineErrors(db, source, T0, forms);
		expect(result.created).toBe(2);
		expect(result.skipped).toEqual([{ reason: 'missing', correction: 'make a mistake' }]);
		const items = clozeItemsRepo(db).byValidated(true).filter((i) => i.gapType === 'user_error');
		expect(items.map((i) => [i.answer, i.tokenIndex, i.tokenCount, i.promptVersion, i.ruleOk, i.criticOk])).toEqual([
			['went', 2, 1, 'user_error', true, null],
			['bought', 1, 1, 'user_error', true, null]
		]);
		expect(items[0]).toMatchObject({ enText: 'Yesterday I went to the market with my mother.', viText: 'Hôm qua bạn đã làm gì?', levelBand: 2 });
		const sentence = sentencesRepo(db).byId(items[0].sentenceId)!;
		expect(sentence).toMatchObject({ source: 'user_error', levelBand: 2 });
		// "bought": buy's forms are not in this form index, so it is typed.
		expect(items[1]).toMatchObject({ typingOnly: true, options: [] });
		const cards = cardsRepo(db).byIds([1, 2]);
		expect(cards.map((c) => [c.state, c.clozeItemId, c.promptMode])).toEqual([
			['New', items[0].id, 'choice'],
			['New', items[1].id, 'typing']
		]);
	});

	it('skips an identical sentence and span mined before', () => {
		const { db } = setup();
		expect(mineErrors(db, source, T0, forms).created).toBe(2);
		const again = mineErrors(db, source, T0, forms);
		expect(again.created).toBe(0);
		expect(again.skipped.filter((s) => s.reason === 'duplicate')).toHaveLength(2);
	});

	it('mined cards are exempt from the daily new-card limit and come in the next session', () => {
		const { db, addItem } = setup();
		for (let i = 0; i < 6; i++) addItem();
		settingsRepo(db).update({ newCardsPerDay: 2 });
		mineErrors(db, source, T0, forms);
		const first = startSession(db, T0, { budgetMin: 5 });
		const mined = first.items.filter((i) => i.isMined);
		expect(mined).toHaveLength(2);
		expect(mined.every((i) => i.isNew && i.gapType === 'user_error')).toBe(true);
		// The two regular new cards are still allowed on top of them.
		expect(first.items.filter((i) => i.isNew && !i.isMined)).toHaveLength(2);
		const typed = mined.find((i) => i.answer === 'bought')!;
		expect(typed).toMatchObject({ mode: 'typing', viTranslation: 'Hôm qua bạn đã làm gì?', before: 'We ', after: ' fish.' });
		expect(typed.options).toBeUndefined();
		// Answering everything introduces 4 cards, but only the 2 regular ones count: nothing new left today.
		finishSession(db, new Date(T0.getTime() + MINUTE), {
			sessionId: first.sessionId!,
			clientSessionId: 'c1',
			results: first.items.map((i, k) => ({ cardId: i.cardId, correct: true, mode: i.mode, responseMs: 3000, hintUsed: false, answeredOffsetMs: 1000 * (k + 1) }))
		});
		mineErrors(db, { ...source, correctedText: 'The children went home.', errors: [error('childs', 'children', 'PLU')] }, new Date(T0.getTime() + 2 * MINUTE), forms);
		const later = composeSession(db, new Date(T0.getTime() + 3 * 3_600_000), { budgetMin: 5 });
		expect(later.items.filter((i) => i.isNew).map((i) => i.isMined)).toEqual([true]);
		const tomorrow = composeSession(db, new Date(T0.getTime() + DAY), { budgetMin: 5 });
		expect(tomorrow.items.filter((i) => i.isNew && !i.isMined).length).toBe(2);
	});
});
