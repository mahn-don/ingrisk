import { describe, expect, it } from 'vitest';
import type { Label, Verdict } from '../../llm/prompts/cloze-critic.ts';
import { NO_WORD } from '../tokens.ts';
import { criticSentences, judge } from './critic.ts';

const verdict = (label: Label, ok: boolean, overrides: Partial<Verdict> = {}): Verdict => ({
	label,
	grammatical: ok,
	natural: ok,
	meaning_ok: ok,
	note: ok ? 'fine' : 'wrong',
	...overrides
});

describe('judge', () => {
	it('accepts when exactly one sentence is acceptable and it is the answer', () => {
		const j = judge('C', [verdict('A', false), verdict('B', false), verdict('C', true), verdict('D', false)])!;
		expect(j).toMatchObject({ ok: true, acceptable: ['C'], reason: null });
		expect(JSON.parse(j.notes)).toHaveLength(4);
	});

	it('rejects when two sentences are acceptable', () => {
		const j = judge('C', [verdict('A', true), verdict('B', false), verdict('C', true), verdict('D', false)])!;
		expect(j).toMatchObject({ ok: false, acceptable: ['A', 'C'], reason: 'critic:several_acceptable (A, C)' });
	});

	it('rejects when the only acceptable sentence is not the answer', () => {
		const j = judge('C', [verdict('A', false), verdict('B', true), verdict('C', false), verdict('D', false)])!;
		expect(j).toMatchObject({ ok: false, acceptable: ['B'], reason: 'critic:other_option_acceptable (B, answer C)' });
	});

	it('rejects when nothing is acceptable', () => {
		const j = judge('A', ['A', 'B', 'C', 'D'].map((l) => verdict(l as Label, false)))!;
		expect(j).toMatchObject({ ok: false, reason: 'critic:none_acceptable' });
	});

	it('needs all three checks for a sentence to count as acceptable', () => {
		const j = judge('A', [verdict('A', true), verdict('B', true, { natural: false }), verdict('C', true, { meaning_ok: false }), verdict('D', false)])!;
		expect(j.ok).toBe(true);
	});

	it('returns null for malformed label sets (judged by order, never by position)', () => {
		expect(judge('A', [verdict('A', true), verdict('A', false), verdict('C', false), verdict('D', false)])).toBeNull();
		expect(judge('A', [verdict('A', true), verdict('B', false), verdict('C', false)])).toBeNull();
		const shuffled = judge('B', [verdict('D', false), verdict('B', true), verdict('A', false), verdict('C', false)])!;
		expect(shuffled.ok).toBe(true);
	});
});

describe('criticSentences', () => {
	it('fills every option in display order, without marking the answer', () => {
		const sentences = criticSentences({
			contentHash: 'h',
			enText: 'The dog is very big.',
			tokenIndex: 0,
			answer: 'The',
			options: ['A', NO_WORD, 'The', 'An']
		});
		expect(sentences).toEqual([
			{ label: 'A', text: 'A dog is very big.' },
			{ label: 'B', text: 'Dog is very big.' },
			{ label: 'C', text: 'The dog is very big.' },
			{ label: 'D', text: 'An dog is very big.' }
		]);
		expect(JSON.stringify(sentences)).not.toMatch(/answer/i);
	});

	it('removes a mid-sentence gap cleanly for "no word"', () => {
		const [, none] = criticSentences({ contentHash: 'h', enText: 'I saw a dog there.', tokenIndex: 2, answer: 'a', options: ['a', NO_WORD, 'the', 'an'] });
		expect(none.text).toBe('I saw dog there.');
	});
});
