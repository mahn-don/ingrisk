import { describe, expect, it } from 'vitest';
import { lexemesRepo } from '../../db/repositories/lexemes.ts';
import { createTestDb } from '../../db/test-db.ts';
import { blocklistMatcher, parseBlocklist } from '../blocklist.ts';
import { buildFormIndex } from '../forms.ts';
import { importLexemes } from '../import.ts';
import { BLOCKLIST, NGSL, fixtureIsWord } from '../test-fixtures.ts';
import { NO_WORD } from '../tokens.ts';
import { type RuleCode, type RuleInput, checkRules, ruleReason } from './rules.ts';

const db = createTestDb();
importLexemes(db, NGSL);
const forms = buildFormIndex(lexemesRepo(db).all());
const deps = { forms, isWord: fixtureIsWord(forms), blocklist: blocklistMatcher(parseBlocklist(BLOCKLIST), forms) };

// "The dog is very big." tokens: The(0) dog(1) is(2) very(3) big(4) .(5)
const lexical: RuleInput = {
	enText: 'The dog is very big.',
	gapType: 'lexical',
	tokenIndex: 4,
	answer: 'big',
	options: ['small', 'big', 'purple', 'loud'],
	initial: false
};
const article: RuleInput = {
	enText: 'The dog is very big.',
	gapType: 'article',
	tokenIndex: 0,
	answer: 'The',
	options: ['A', NO_WORD, 'The', 'An'],
	initial: true
};

const code = (item: RuleInput): RuleCode | 'ok' => {
	const result = checkRules(item, deps);
	return result.ok ? 'ok' : result.code;
};

describe('checkRules', () => {
	it('passes well-formed lexical and grammar items', () => {
		expect(code(lexical)).toBe('ok');
		expect(code(article)).toBe('ok');
	});

	const cases: [string, RuleInput, RuleCode][] = [
		['exactly four options', { ...lexical, options: ['small', 'big', 'purple'] }, 'option_count'],
		['options distinct case-insensitively', { ...lexical, options: ['small', 'big', 'Small', 'loud'] }, 'duplicate_options'],
		['exactly one option equals the answer', { ...lexical, options: ['small', 'Big', 'purple', 'loud'] }, 'answer_count'],
		['single token or —', { ...lexical, options: ['small', 'big', 'very loud', 'purple'] }, 'multi_token'],
		['lowercase mid-sentence', { ...lexical, options: ['small', 'big', 'Purple', 'loud'] }, 'casing'],
		['all capitalized when sentence-initial', { ...article, options: ['a', NO_WORD, 'The', 'An'] }, 'casing'],
		['answer at token_index', { ...lexical, tokenIndex: 3 }, 'answer_position'],
		['no distractor is a form of the answer lemma', { ...lexical, options: ['small', 'big', 'bigger', 'loud'] }, 'same_lemma'],
		['distractors are real words', { ...lexical, options: ['small', 'big', 'blorp', 'loud'] }, 'not_a_word'],
		['nonstandard NGSL forms do not count as words', { ...lexical, answer: 'is', tokenIndex: 2, options: ['is', 'sayed', 'loud', 'small'] }, 'not_a_word'],
		['no distractor on the blocklist', { ...lexical, options: ['small', 'big', 'killed', 'loud'] }, 'blocklisted']
	];
	for (const [rule, item, expected] of cases) {
		it(`fails: ${rule}`, () => {
			expect(code(item)).toBe(expected);
		});
	}

	it('only checks lemma, word and blocklist rules for lexical gaps', () => {
		const verb: RuleInput = { enText: 'He went home today.', gapType: 'verb_form', tokenIndex: 1, answer: 'went', options: ['go', 'went', 'gone', 'goes'], initial: false };
		expect(code(verb)).toBe('ok');
	});

	it('formats the stored rejection reason', () => {
		const result = checkRules({ ...lexical, options: ['small', 'big', 'blorp', 'loud'] }, deps);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(ruleReason(result)).toBe('rule:not_a_word (blorp)');
	});
});
