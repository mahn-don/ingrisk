import { describe, expect, it } from 'vitest';
import { buildFormIndex, type NgslItem } from './ngsl.ts';
import { FILTER_STEPS, analyzeLevel, filterPairs, hasVietnameseDiacritic, normalizeText } from './tatoeba.ts';
import type { PairRow } from './tatoeba-pairs.ts';

let nextId = 1;
function row(engText: string, vieText: string, ids: Partial<Pick<PairRow, 'engId' | 'vieId'>> = {}): PairRow {
	const id = nextId++;
	return { engId: ids.engId ?? id, engText, vieId: ids.vieId ?? 1000 + id, vieText };
}

const GOOD = () => row('I have to go to sleep.', 'Tôi phải đi ngủ.');

/** Run the filters on a passing and a failing pair; assert the given step removed only the failing one. */
function expectStepRemoves(step: number, failing: PairRow) {
	const passing = GOOD();
	const result = filterPairs([passing, failing]);
	expect(result.steps[step].step).toBe(FILTER_STEPS[step]);
	expect(result.steps[step].removed).toBe(1);
	result.steps.forEach((s, i) => {
		if (i !== step) expect(s.removed, s.step).toBe(0);
	});
	expect(result.pairs.map((p) => p.engId)).toEqual([passing.engId]);
}

describe('normalizeText', () => {
	it('applies NFC so decomposed Vietnamese equals its precomposed twin', () => {
		const precomposed = 'Tôi phải đi ngủ.';
		const decomposed = precomposed.normalize('NFD');
		expect(decomposed).not.toBe(precomposed);
		expect(normalizeText(decomposed)).toBe(precomposed);
	});
	it('straightens curly quotes and collapses whitespace', () => {
		expect(normalizeText('  “It’s  fine,” he said. ')).toBe('"It\'s fine," he said.');
	});
});

describe('hasVietnameseDiacritic', () => {
	it('detects tone marks, modified vowels and d-with-stroke', () => {
		expect(hasVietnameseDiacritic('Tôi yêu bạn')).toBe(true);
		expect(hasVietnameseDiacritic('đi')).toBe(true);
		expect(hasVietnameseDiacritic('toi yeu ban')).toBe(false);
	});
});

describe('filterPairs', () => {
	it('keeps a clean pair through every step', () => {
		const result = filterPairs([GOOD()]);
		expect(result.input).toBe(1);
		expect(result.steps.map((s) => s.removed)).toEqual([0, 0, 0, 0, 0, 0]);
		expect(result.pairs).toHaveLength(1);
	});
	it('step 1: drops empty English or Vietnamese', () => {
		expectStepRemoves(0, row('Hello.', '   '));
	});
	it('step 2: drops English longer than 15 words', () => {
		expectStepRemoves(1, row('One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.', 'Một hai ba.'));
		expect(filterPairs([row('One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen.', 'Một hai ba.')]).pairs).toHaveLength(1);
	});
	it('step 3: drops English with characters outside basic Latin and common punctuation', () => {
		expectStepRemoves(2, row('I paid 5€ for this café.', 'Tôi đã trả 5 euro.'));
	});
	it('step 4: drops Vietnamese identical to the English', () => {
		expectStepRemoves(3, row('Tom is here.', 'tom is here.'));
	});
	it('step 5: drops unaccented Vietnamese of 3+ words but keeps short ones', () => {
		expectStepRemoves(4, row('I love you.', 'toi yeu ban'));
		expect(filterPairs([row('OK.', 'ok nhe')]).pairs).toHaveLength(1);
	});
	it('step 6: keeps one pair per English sentence, the lowest Vietnamese id, NFC-normalized', () => {
		const precomposed = 'Tôi phải đi ngủ.';
		const a = row('I have to go to sleep.', precomposed.normalize('NFD'), { engId: 50, vieId: 7 });
		const b = row('i have to  go to sleep.', precomposed, { engId: 40, vieId: 9 });
		const result = filterPairs([b, a]);
		expect(result.steps[5]).toMatchObject({ removed: 1, remaining: 1 });
		expect(result.pairs).toEqual([{ engId: 50, vieId: 7, en: 'I have to go to sleep.', vi: precomposed }]);
	});
});

describe('analyzeLevel', () => {
	const item = (headword: string, band: number, forms: string[]): NgslItem => ({
		headword,
		pos: null,
		rank: band,
		band,
		forms: [headword, ...forms]
	});
	const index = buildFormIndex(
		[
			item('go', 1, ['went', 'goes']),
			item('to', 1, []),
			item('the', 1, []),
			item('on', 1, []),
			item('and', 1, []),
			item('with', 1, []),
			item('do', 1, ['does']),
			item('mile', 3, []),
			item('walk', 4, [])
		],
		[{ headword: 'monday', forms: ['monday', 'mondays'] }]
	);

	it('scores a hand-checked sentence', () => {
		// Tom (sentence-initial, unknown) -> off-list; went -> go (1); bakeries -> off-list;
		// Monday -> supplementary (1); walked -> walk via -ed (4); 3 -> number, skipped;
		// miles -> mile via -s (3); Anna (capitalized mid-sentence) -> proper noun, skipped.
		const sentence = 'Tom went to the bakeries on Monday and walked 3 miles with Anna.';
		expect(analyzeLevel(sentence, index)).toEqual({ ngsl_band_max: 4, off_list_count: 2 });
	});
	it('reduces contractions and treats each sentence start separately', () => {
		expect(analyzeLevel("Go! Don't go.", index)).toEqual({ ngsl_band_max: 1, off_list_count: 0 });
	});
	it('returns null when no word is known', () => {
		expect(analyzeLevel('Achoo!', index)).toEqual({ ngsl_band_max: null, off_list_count: 1 });
	});
});
