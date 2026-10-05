import { describe, expect, it } from 'vitest';
import { lexemesRepo } from '../../db/repositories/lexemes.ts';
import { createTestDb } from '../../db/test-db.ts';
import { buildFormIndex } from '../forms.ts';
import { importLexemes } from '../import.ts';
import { NGSL, fixtureIsWord } from '../test-fixtures.ts';
import { NO_WORD, firstWordIndex, tokenize } from '../tokens.ts';
import {
	type Candidate,
	type CandidateDeps,
	type SentenceInput,
	allCandidates,
	selectCandidates,
	sentenceCandidates,
	verbForms,
	verbTopic
} from './candidates.ts';
import { PREPOSITION_CONFUSIONS } from './prepositions.ts';
import { FUNCTION_WORDS } from './stoplist.ts';

const db = createTestDb();
importLexemes(db, NGSL);
const forms = buildFormIndex(lexemesRepo(db).all());
const deps: CandidateDeps = { forms, isWord: fixtureIsWord(forms) };

let nextId = 1;
const sentence = (enText: string, levelBand = 1, extra: Partial<SentenceInput> = {}): SentenceInput => ({
	id: nextId++,
	enText,
	viText: `(vi) ${enText}`,
	levelBand,
	offListCount: 0,
	blocked: false,
	...extra
});
const candidates = (text: string, band = 1) => sentenceCandidates(sentence(text, band), deps);
const ofType = (cs: Candidate[], type: Candidate['gapType']) => cs.find((c) => c.gapType === type);
/** Every grammar candidate of one type (sentenceCandidates keeps only one grammar gap). */
const grammar = (text: string, type: 'article' | 'preposition' | 'verb_form') => allCandidates(sentence(text), deps)![type];

const CORPUS = [
	'The dog is very big.',
	'I saw a small cat at school.',
	'He goes to school with the dog.',
	'They went to the river.',
	'Rose likes the garden.',
	'We met Rose in the city.',
	'My sister is happy.',
	'The bird says hello to the tree.',
	'She drinks water in the house.',
	'He broke the rules at school.'
];

describe('eligibility', () => {
	it('skips blocked, too short, too long and off-list-heavy sentences', () => {
		expect(sentenceCandidates(sentence('The dog is very big.', 1, { blocked: true }), deps)).toEqual([]);
		expect(candidates('Big dog.')).toEqual([]);
		expect(candidates('The dog is big and the cat is small and the bird is happy and the tree is big.')).toEqual([]);
		expect(sentenceCandidates(sentence('The dog is very big.', 1, { offListCount: 3 }), deps)).toEqual([]);
	});

	it('gives at most one lexical and one grammar candidate per sentence', () => {
		for (const text of CORPUS) {
			const cs = candidates(text, 3);
			expect(cs.filter((c) => c.gapType === 'lexical').length).toBeLessThanOrEqual(1);
			expect(cs.filter((c) => c.gapType !== 'lexical').length).toBeLessThanOrEqual(1);
		}
	});
});

describe('lexical candidates', () => {
	it('never gap a capitalized word in mid-sentence', () => {
		expect(ofType(candidates('We met Rose in the city.', 3), 'lexical')?.answer).toBe('city');
		expect(ofType(candidates('I saw Rose there.', 3), 'lexical')).toBeUndefined();
		for (const text of CORPUS) {
			for (const c of candidates(text, 3)) {
				const tokens = tokenize(c.enText);
				if (c.tokenIndex !== firstWordIndex(tokens)) expect(c.answer).toBe(c.answer.toLowerCase());
			}
		}
	});

	it('respects the function-word stoplist', () => {
		expect(ofType(candidates('They have been with us.'), 'lexical')).toBeUndefined();
		for (const text of CORPUS) {
			const c = ofType(candidates(text, 3), 'lexical');
			if (c !== undefined) expect(FUNCTION_WORDS.has(forms.lemmaOf.get(c.answer.toLowerCase())!.headword)).toBe(false);
		}
	});

	it('prefers the highest band up to sentence band + 1 and links the lexeme', () => {
		// Fixture bands: rose 3, happy 2, dog 1. Sentence band 1 allows up to band 2.
		const c = ofType(candidates('The rose and the dog are happy.', 1), 'lexical')!;
		expect(c.answer).toBe('happy');
		expect(c.levelBand).toBe(2);
		expect(c.lexemeId).toBe(forms.lemmaOf.get('happy')!.lexemeId);
		const higher = ofType(candidates('The rose and the dog are happy.', 2), 'lexical')!;
		expect(higher).toMatchObject({ answer: 'rose', levelBand: 3 });
	});

	it('skips words inside hyphenated compounds', () => {
		expect(ofType(candidates('She is my sister-in-law now.'), 'lexical')).toBeUndefined();
	});
});

describe('grammar candidates', () => {
	it('detects articles with a, an, the and no word', () => {
		const [c] = grammar('I saw a dog there.', 'article');
		expect(c).toMatchObject({ answer: 'a', topicCode: 'ART', options: ['a', 'an', 'the', NO_WORD], initial: false });
		const [initial] = grammar('The dog sleeps well.', 'article');
		expect(initial).toMatchObject({ answer: 'The', initial: true, options: ['A', 'An', 'The', NO_WORD] });
	});

	it('detects prepositions with distractors from the confusion table', () => {
		const [c] = grammar('The book is on the table.', 'preposition');
		expect(c).toMatchObject({ answer: 'on', topicCode: 'PRE' });
		expect(c.options).toEqual(['on', ...PREPOSITION_CONFUSIONS.on]);
	});

	it('does not treat the infinitive "to" as a preposition', () => {
		expect(grammar('I want to go now.', 'preposition')).toEqual([]);
		expect(grammar('I walk to school daily.', 'preposition').map((c) => c.answer)).toEqual(['to']);
	});

	it('builds verb_form options from the form map (real forms only)', () => {
		expect(verbForms('say', deps)).toEqual(['say', 'says', 'said', 'saying']);
		expect(verbForms('go', deps)).not.toContain('goings');
		const [c] = grammar('Yesterday he went home.', 'verb_form');
		expect(c.answer).toBe('went');
		expect(c.options).toHaveLength(4);
		for (const option of c.options!) expect(forms.formsOf.get('go')).toContain(option);
		expect(c.topicCode).toBe('TNS');
	});

	it('never makes verb_form gaps from modals or nouns after a determiner', () => {
		expect(grammar('Yesterday I can drink water.', 'verb_form').map((c) => c.answer)).toEqual(['drink']);
		expect(grammar('Yesterday he broke the rules.', 'verb_form')).toEqual([]);
	});

	it('labels present simple after a third-person subject SVA, else TNS', () => {
		const topic = (text: string, word: string, headword: string) => {
			const tokens = tokenize(text);
			return verbTopic(tokens, tokens.findIndex((t) => t.text === word), word, headword);
		};
		expect(topic('He always goes home.', 'goes', 'go')).toBe('SVA');
		expect(topic('The dog is big.', 'is', 'be')).toBe('SVA');
		expect(topic('Books are my friends.', 'are', 'be')).toBe('SVA');
		expect(topic('I am happy.', 'am', 'be')).toBe('TNS');
		expect(topic('He was happy.', 'was', 'be')).toBe('TNS');
		expect(topic('He went home.', 'went', 'go')).toBe('TNS');
		expect(topic('I can go home.', 'go', 'go')).toBe('TNS');
		expect(topic("He doesn't go home.", 'go', 'go')).toBe('TNS');
	});
});

describe('seeded selection', () => {
	const all = CORPUS.flatMap((text, i) => sentenceCandidates({ ...sentence(text, (i % 3) + 1), id: 500 + i }, deps));

	it('is stable across runs and input order', () => {
		const again = CORPUS.flatMap((text, i) => sentenceCandidates({ ...sentence(text, (i % 3) + 1), id: 500 + i }, deps));
		expect(again).toEqual(all);
		const a = selectCandidates(all, { limit: 8 });
		expect(selectCandidates([...all].reverse(), { limit: 8 })).toEqual(a);
		expect(a).toHaveLength(8);
	});

	it('spreads picks across gap types and bands, and honours filters', () => {
		const picked = selectCandidates(all, { limit: 6 });
		expect(new Set(picked.map((c) => `${c.gapType}|${c.levelBand}`)).size).toBe(6);
		const onlyLexical = selectCandidates(all, { limit: 50, types: ['lexical'], bands: [1, 2] });
		expect(onlyLexical.every((c) => c.gapType === 'lexical' && c.levelBand <= 2)).toBe(true);
		const exclude = new Set(onlyLexical.map((c) => c.contentHash));
		expect(selectCandidates(all, { limit: 50, types: ['lexical'], bands: [1, 2], exclude })).toEqual([]);
	});
});
