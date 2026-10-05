import { describe, expect, it } from 'vitest';
import { lexemesRepo } from '../../db/repositories/lexemes.ts';
import { createTestDb } from '../../db/test-db.ts';
import { buildFormIndex } from '../forms.ts';
import { importLexemes } from '../import.ts';
import { NGSL } from '../test-fixtures.ts';
import { type InjectedCode, type InjectionDeps, hasTimeMarker, inject, injectionSites } from './inject.ts';
import { buildWordClasses } from './word-classes.ts';

const db = createTestDb();
importLexemes(db, NGSL);
const forms = buildFormIndex(lexemesRepo(db).all());
const deps: InjectionDeps = {
	forms,
	classes: {
		countableNouns: new Set(['dog', 'cat', 'book', 'garden', 'house', 'table', 'tree', 'bird', 'child']),
		adjectives: new Set(['big', 'small', 'happy']),
		pastForms: new Set(['went', 'drank', 'liked', 'said'])
	}
};
const error = (text: string, code: InjectedCode) => inject(text, code, deps)?.sentenceWithError ?? null;

describe('injections', () => {
	const cases: [InjectedCode, string, string, string][] = [
		// code, applies to, expected error, must not apply to
		['ART', 'I saw a dog there.', 'I saw dog there.', 'There are a few dogs here.'],
		['PLU', 'I have two dogs at home.', 'I have two dog at home.', 'These are my dogs.'],
		['SVA', 'He likes the big garden.', 'He like the big garden.', 'They like the big garden.'],
		['COP', 'The dog is very happy.', 'The dog very happy.', 'The dog is a big animal.'],
		['TNS', 'He went to school yesterday.', 'He go to school yesterday.', 'He went to school.'],
		['PRE', 'I want to go to school.', 'I want to go at school.', 'I want to go home.']
	];
	for (const [code, applies, expected, notApplies] of cases) {
		it(`${code}: injects one error, and only where it applies`, () => {
			const result = inject(applies, code, deps);
			expect(result?.corrected).toBe(applies);
			if (code === 'PRE') {
				expect(['I want to go for school.', 'I want to go at school.', 'I want to go into school.']).toContain(result?.sentenceWithError);
			} else {
				expect(result?.sentenceWithError).toBe(expected);
			}
			expect(injectionSites(notApplies, code, deps)).toEqual([]);
			expect(error(notApplies, code)).toBeNull();
		});
	}

	it('ART swaps a/an when deleting is not possible, and keeps capitals', () => {
		expect(error('I want a big house.', 'ART')).toBe('I want an big house.');
		expect(error('The dog sleeps in the garden.', 'ART')).toMatch(/^(Dog sleeps in the garden\.|The dog sleeps in garden\.)$/);
		expect(injectionSites('The water is cold.', 'ART', deps)).toEqual([]); // not a countable noun
	});

	it('PLU handles numbers, quantifiers and irregular plurals', () => {
		expect(error('She has 3 cats now.', 'PLU')).toBe('She has 3 cat now.');
		expect(error('Many children like dogs.', 'PLU')).toBe('Many child like dogs.');
		expect(injectionSites('I have one dog.', 'PLU', deps)).toEqual([]);
		expect(injectionSites('I have 1 dog.', 'PLU', deps)).toEqual([]);
	});

	it('SVA needs a third-person singular subject and a verb', () => {
		expect(error('Tom always drinks water.', 'SVA')).toBe('Tom always drink water.');
		expect(error('My dog likes water.', 'SVA')).toBe('My dog like water.');
		expect(error('She has a big house.', 'SVA')).toBe('She have a big house.');
		expect(injectionSites('The dogs like water.', 'SVA', deps)).toEqual([]);
		expect(injectionSites('I like the books.', 'SVA', deps)).toEqual([]); // a plural noun, not a verb
	});

	it('COP needs an adjective (after an optional intensifier) closing the predicate', () => {
		expect(error('I am happy now.', 'COP')).toBe('I happy now.');
		expect(injectionSites('Is he happy?', 'COP', deps)).toEqual([]); // sentence-initial
		expect(injectionSites('This is a big house.', 'COP', deps)).toEqual([]);
		expect(injectionSites('It is big food.', 'COP', deps)).toEqual([]); // the adjective modifies a noun
	});

	it('TNS needs a time marker and a simple past (not a participle after an auxiliary)', () => {
		expect(hasTimeMarker(['last', 'week'])).toBe(true);
		expect(hasTimeMarker(['the', 'last', 'time'])).toBe(false);
		expect(hasTimeMarker(['two', 'days', 'ago'])).toBe(true);
		expect(error('We drank water last night.', 'TNS')).toBe('We drink water last night.');
		expect(injectionSites('He has gone home yesterday.', 'TNS', deps)).toEqual([]);
	});

	it('PRE keeps the infinitive "to"', () => {
		expect(injectionSites('I like to drink water.', 'PRE', deps)).toEqual([]);
	});

	it('is deterministic for a seed', () => {
		expect(inject('The book is on the table in the house.', 'PRE', deps)).toEqual(inject('The book is on the table in the house.', 'PRE', deps));
	});
});

describe('buildWordClasses', () => {
	it('infers countable nouns, adjectives and simple pasts from the corpus', () => {
		const classes = buildWordClasses(forms, ['I saw a dog.', 'It is very happy.', 'She is so happy.', 'She went home.', 'He has gone.', 'A big dog came.']);
		expect(classes.countableNouns.has('dog')).toBe(true);
		expect(classes.adjectives.has('happy')).toBe(true);
		expect(classes.adjectives.has('big')).toBe(true); // has -er/-est forms
		expect(classes.countableNouns.has('big')).toBe(false);
		expect(classes.pastForms.has('went')).toBe(true);
		expect(classes.pastForms.has('gone')).toBe(false);
	});
});
