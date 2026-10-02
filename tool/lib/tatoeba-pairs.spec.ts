import { describe, expect, it } from 'vitest';
import { formatPairsTsv, joinPairs, parseLinks, parsePairsTsv, parseSentenceLine } from './tatoeba-pairs.ts';

describe('Tatoeba pair building', () => {
	it('joins links with sentences, skips deleted sentences and sorts by eng_id then vie_id', () => {
		const links = parseLinks('20\t7\n10\t9\n10\t8\n30\t99\n');
		const eng = new Map([
			[10, 'Hello.'],
			[20, 'Thanks.']
		]);
		const vie = new Map([
			[7, 'Cảm ơn.'],
			[8, 'Xin chào.'],
			[9, 'Chào.']
		]);
		const { rows, missingEng, missingVie } = joinPairs(links, eng, vie);
		expect(rows.map((r) => [r.engId, r.vieId])).toEqual([
			[10, 8],
			[10, 9],
			[20, 7]
		]);
		expect([missingEng, missingVie]).toEqual([1, 1]);
		expect(parsePairsTsv(formatPairsTsv(rows))).toEqual(rows);
	});

	it('parses sentence lines with tabs only as separators', () => {
		expect(parseSentenceLine('1277\teng\tI have to go to sleep.')).toEqual({
			id: 1277,
			lang: 'eng',
			text: 'I have to go to sleep.'
		});
		expect(parseSentenceLine('')).toBeNull();
		expect(() => parseSentenceLine('no tabs here')).toThrow();
	});
});
