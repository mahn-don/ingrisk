import { describe, expect, it } from 'vitest';
import type { LexemeRow } from '../db/repositories/lexemes.ts';
import { readPseudoWords, realWordsByBand } from './content.ts';

const lexeme = (headword: string, band: number | null, extra: Partial<LexemeRow> = {}): LexemeRow => ({
	id: 0,
	headword,
	pos: null,
	ngslRank: band === null ? null : 1,
	freqBand: band,
	forms: [headword],
	supplementary: false,
	viGloss: null,
	enDef: null,
	source: 'ngsl',
	licenseTag: 'x',
	...extra
});

describe('Part A content', () => {
	it('keeps NGSL headwords of 3+ lowercase letters; drops supplementary, function and blocked words', () => {
		const words = realWordsByBand(
			[
				lexeme('garden', 1),
				lexeme('ox', 1),
				lexeme('monday', 1, { supplementary: true, ngslRank: null }),
				lexeme('the', 1),
				lexeme('because', 1),
				lexeme('kill', 2),
				lexeme('Paris', 2),
				lexeme("o'clock", 2),
				lexeme('river', 2),
				lexeme('llmword', null)
			],
			(w) => w === 'kill'
		);
		expect([...words.entries()]).toEqual([
			[1, ['garden']],
			[2, ['river']]
		]);
	});

	it('reads the 120 pseudo-words', () => {
		const words = readPseudoWords();
		expect(words).toHaveLength(120);
		expect(new Set(words).size).toBe(120);
	});
});
