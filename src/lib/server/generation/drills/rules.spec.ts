import { describe, expect, it } from 'vitest';
import { type BlocklistMatcher, blocklistMatcher, parseBlocklist } from '../blocklist.ts';
import { buildFormIndex } from '../forms.ts';
import { drillDiff } from './diff.ts';
import { checkDrill, checkExplanation, type DrillRuleCode, replacements } from './rules.ts';

const blocklist: BlocklistMatcher = blocklistMatcher(parseBlocklist('kill\n'), buildFormIndex([]));

const drill = {
	sentence_with_error: 'She go to work by bus.',
	corrected: 'She goes to work by bus.',
	original_span: 'go',
	corrected_span: 'goes',
	topic_code: 'SVA' as const
};
const code = (d: typeof drill, requested: typeof drill.topic_code | 'ART' = 'SVA'): DrillRuleCode | 'ok' => {
	const r = checkDrill(d, requested, blocklist);
	return r.ok ? 'ok' : r.code;
};

describe('drillDiff', () => {
	it('finds the single changed region and its spans', () => {
		expect(drillDiff('She go to work.', 'She goes to work.')).toEqual({ size: 1, originalSpan: 'go', correctedSpan: 'goes' });
		expect(drillDiff('Same.', 'Same.')).toBeNull();
	});

	it('treats a word-order swap as one region', () => {
		expect(drillDiff('I bought a bag red.', 'I bought a red bag.')).toEqual({ size: 2, originalSpan: 'bag red', correctedSpan: 'red bag' });
	});

	it('widens a deletion by one neighbour, and handles a sentence-initial change', () => {
		expect(drillDiff('I have dog.', 'I have a dog.')).toEqual({ size: 1, originalSpan: 'dog', correctedSpan: 'a dog' });
		expect(drillDiff('Dog barked.', 'The dog barked.')).toEqual({ size: 2, originalSpan: 'Dog', correctedSpan: 'The dog' });
		expect(drillDiff('He very tired.', 'He is very tired.')).toEqual({ size: 1, originalSpan: 'very', correctedSpan: 'is very' });
	});

	it('spans two far-apart changes as one large region', () => {
		expect(drillDiff('She go to the work by a bus.', 'She goes to the work by bus.')?.size).toBe(6);
	});
});

describe('checkDrill', () => {
	it('passes a well-formed drill', () => {
		expect(code(drill)).toBe('ok');
	});

	const failing: [string, typeof drill, DrillRuleCode][] = [
		['corrected differs from the erroneous sentence', { ...drill, corrected: drill.sentence_with_error }, 'identical'],
		['at most 3 changed tokens in one region', { ...drill, sentence_with_error: 'She go to the work by a bus.', corrected: 'She goes to the work by bus.' }, 'diff_too_large'],
		['spans must describe the change', { ...drill, original_span: 'work', corrected_span: 'job' }, 'spans_mismatch'],
		['spans must cover the minimal diff', { ...drill, original_span: 'She', corrected_span: 'She' }, 'spans_mismatch'],
		['nothing on the blocklist', { ...drill, sentence_with_error: 'She kill time by bus.', corrected: 'She kills time by bus.', original_span: 'kill', corrected_span: 'kills' }, 'blocklisted']
	];
	for (const [rule, d, expected] of failing) {
		it(`fails: ${rule}`, () => {
			expect(code(d)).toBe(expected);
		});
	}

	it('fails: the topic code is the requested one', () => {
		expect(code(drill, 'ART')).toBe('topic_mismatch');
	});

	it('accepts wider spans from the LLM and matches whole words only', () => {
		expect(code({ ...drill, original_span: 'She go', corrected_span: 'She goes' })).toBe('ok');
		expect(replacements('He had a apple and a cat.', 'a', 'an')).toEqual(['He had an apple and a cat.', 'He had a apple and an cat.']);
	});
});

describe('checkExplanation', () => {
	it('allows at most 2 non-empty sentences', () => {
		expect(checkExplanation('Sau "she" động từ thêm -s. Vì vậy viết "goes".').ok).toBe(true);
		expect(checkExplanation('').ok).toBe(false);
		expect(checkExplanation('Một. Hai. Ba.').ok).toBe(false);
	});
});
