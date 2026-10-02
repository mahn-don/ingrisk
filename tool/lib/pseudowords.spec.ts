import { describe, expect, it } from 'vitest';
import {
	createRng,
	generatePseudowords,
	parseExcludeList,
	rejectionReason,
	type RejectionContext
} from './pseudowords.ts';

const ctx = (overrides: Partial<RejectionContext> = {}): RejectionContext => ({
	ngsl: new Set(['went', 'go']),
	dictionary: new Set(['candle', 'fondle', 'blanket']),
	exclude: new Set(),
	...overrides
});

describe('rejectionReason', () => {
	it('accepts a plausible non-word', () => {
		expect(rejectionReason('plurthy', ctx())).toBeNull();
	});
	it('rejects NGSL forms and dictionary words', () => {
		expect(rejectionReason('went', ctx())).toBe('NGSL word or form');
		expect(rejectionReason('candle', ctx())).toBe('in the English word list');
	});
	it('rejects a real word plus or minus a suffix', () => {
		expect(rejectionReason('candles', ctx())).toMatch(/affix change \("candle"\)/);
		expect(rejectionReason('fondled', ctx())).toMatch(/affix change \("fondle"\)/);
		expect(rejectionReason('fondly', ctx())).toMatch(/affix change \("fondle"\)/);
		expect(rejectionReason('goy', ctx())).toMatch(/affix change \("go"\)/);
	});
	it('rejects broken spelling patterns and blocked substrings', () => {
		expect(rejectionReason('qatoon', ctx())).toBe('q not followed by u');
		expect(rejectionReason('brooon', ctx())).toBe('three identical letters in a row');
		expect(rejectionReason('stoniv', ctx())).toBe('un-English ending');
		expect(rejectionReason('plasstle', ctx())).toMatch(/blocked substring "ass"/);
	});
	it('rejects excluded words first', () => {
		expect(rejectionReason('plurthy', ctx({ exclude: new Set(['plurthy']) }))).toBe('on the exclude list');
	});
});

describe('generatePseudowords', () => {
	it('gives identical output for the same seed', () => {
		const a = generatePseudowords(30, 42, ctx());
		const b = generatePseudowords(30, 42, ctx());
		expect(a).toEqual(b);
		expect(createRng(1)()).toBe(createRng(1)());
		expect(generatePseudowords(30, 43, ctx()).words).not.toEqual(a.words);
	});
	it('outputs the requested number of distinct words of 5-9 letters', () => {
		const { words } = generatePseudowords(50, 7, ctx());
		expect(new Set(words).size).toBe(50);
		for (const word of words) expect(word).toMatch(/^[a-z]{5,9}$/);
	});
	it('honours the exclude list and only replaces the excluded words', () => {
		const before = generatePseudowords(20, 99, ctx()).words;
		const exclude = parseExcludeList(`# removed by hand\n${before[0].toUpperCase()}  # looks real\n\n${before[5]}\n`);
		const after = generatePseudowords(20, 99, ctx({ exclude }));
		expect(after.words).toHaveLength(20);
		expect(after.words).not.toContain(before[0]);
		expect(after.words).not.toContain(before[5]);
		expect(after.words.slice(0, 4)).toEqual(before.slice(1, 5));
		expect(after.rejected).toContainEqual({ word: before[0], reason: 'on the exclude list' });
	});
});
