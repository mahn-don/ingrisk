import { describe, expect, it } from 'vitest';
import { bandForRank, buildFormIndex, buildNgsl, parseLemmatized, parseStats } from './ngsl.ts';

const STATS = '﻿Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)\r\nthe,1,87.85,60910\r\nTRUE,2,63.17,208\r\ngo,3,75.13,3260\r\n';
const LEMMAS = '## comment line\r\n\r\nthe\r\ngo,goes,went,gone,going\r\nmarch,marches\r\n';

describe('bandForRank', () => {
	it('puts rank 1 in band 1', () => {
		expect(bandForRank(1, 2809)).toBe(1);
	});
	it('starts band 2 right after the first 352 ranks', () => {
		expect(bandForRank(352, 2809)).toBe(1);
		expect(bandForRank(353, 2809)).toBe(2);
	});
	it('puts the last rank in band 8', () => {
		expect(bandForRank(2809, 2809)).toBe(8);
	});
	it('rejects ranks outside the list', () => {
		expect(() => bandForRank(0, 2809)).toThrow();
		expect(() => bandForRank(2810, 2809)).toThrow();
	});
});

describe('parseStats', () => {
	it('reads columns by name, strips the BOM and lowercases headwords', () => {
		expect(parseStats(STATS)).toEqual([
			{ headword: 'the', rank: 1 },
			{ headword: 'true', rank: 2 },
			{ headword: 'go', rank: 3 }
		]);
	});
	it('fails loudly on a duplicate headword', () => {
		expect(() => parseStats('Lemma,SFI Rank\nthe,1\nThe,2\n')).toThrow(/duplicate headword "the"/);
	});
	it('fails on a gap in the ranks', () => {
		expect(() => parseStats('Lemma,SFI Rank\nthe,1\nbe,3\n')).toThrow(/ranks/);
	});
});

describe('parseLemmatized', () => {
	it('skips comments and returns sorted, deduplicated forms including the headword', () => {
		const lemmas = parseLemmatized(LEMMAS, 'test');
		expect(lemmas.get('go')).toEqual(['go', 'goes', 'going', 'gone', 'went']);
		expect(lemmas.get('the')).toEqual(['the']);
	});
	it('fails loudly on a duplicate headword', () => {
		expect(() => parseLemmatized('go,went\nGo,goes\n', 'test')).toThrow(/duplicate headword "go"/);
	});
});

describe('buildNgsl', () => {
	const supplementary = parseLemmatized('Monday,Mondays\nMay,Mays\n', 'sup');

	it('joins ranks with forms and reports cross-check mismatches', () => {
		const result = buildNgsl(parseStats(STATS), parseLemmatized(LEMMAS, 'test'), supplementary);
		expect(result.items.map((i) => [i.headword, i.band, i.pos])).toEqual([
			['the', 1, null],
			['true', 2, null],
			['go', 3, null]
		]);
		expect(result.statsOnly).toEqual(['true']);
		expect(result.lemmatizedOnly).toEqual(['march']);
		expect(result.items[1].forms).toEqual(['true']);
		expect(result.supplementary).toEqual([
			{ headword: 'monday', forms: ['monday', 'mondays'] },
			{ headword: 'may', forms: ['may', 'mays'] }
		]);
	});

	it('stops when the files disagree on more than 50 headwords', () => {
		const stats = Array.from({ length: 60 }, (_, i) => ({ headword: `w${i}`, rank: i + 1 }));
		expect(() => buildNgsl(stats, new Map(), new Map())).toThrow(/different versions/);
	});

	it('indexes every form at its lowest band and supplementary words at band 1', () => {
		const { items } = buildNgsl(
			[
				{ headword: 'find', rank: 1 },
				{ headword: 'found', rank: 2 }
			],
			new Map([
				['find', ['find', 'found']],
				['found', ['found', 'founded']]
			]),
			new Map()
		);
		items[1].band = 5;
		const index = buildFormIndex(items, [{ headword: 'monday', forms: ['monday', 'mondays'] }]);
		expect(index.get('found')).toBe(1);
		expect(index.get('founded')).toBe(5);
		expect(index.get('mondays')).toBe(1);
	});
});
