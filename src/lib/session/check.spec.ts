import { describe, expect, it } from 'vitest';
import { checkChoice, checkTyped, editDistance, effectiveHintUsed, hintFor, normalizeAnswer } from './check.ts';

describe('normalizeAnswer', () => {
	it('trims, lower-cases, straightens quotes and collapses spaces', () => {
		expect(normalizeAnswer('  Don’t   GO ')).toBe("don't go");
		expect(normalizeAnswer('“Hi”')).toBe('"hi"');
		expect(normalizeAnswer('a\tlot\n of')).toBe('a lot of');
	});
});

describe('editDistance', () => {
	it('counts insertions, deletions and substitutions', () => {
		expect(editDistance('house', 'house')).toBe(0);
		expect(editDistance('house', 'horse')).toBe(1);
		expect(editDistance('house', 'hous')).toBe(1);
		expect(editDistance('house', 'houses')).toBe(1);
		expect(editDistance('house', 'hosue')).toBe(2);
	});
});

describe('checkChoice', () => {
	it('is an exact match on the option', () => {
		expect(checkChoice('went', 'went')).toEqual({ correct: true, typo: false });
		expect(checkChoice('Went', 'went').correct).toBe(false);
		expect(checkChoice('—', '—').correct).toBe(true);
	});
});

describe('checkTyped', () => {
	it('accepts the answer after normalization', () => {
		expect(checkTyped('  STORY ', 'story')).toEqual({ correct: true, typo: false });
		expect(checkTyped('don’t', "don't")).toEqual({ correct: true, typo: false });
	});

	it('forgives one typo from 5 letters on, as a typo', () => {
		expect(checkTyped('stroy', 'story')).toEqual({ correct: false, typo: false }); // distance 2
		expect(checkTyped('storu', 'story')).toEqual({ correct: true, typo: true }); // 5 letters, distance 1
		expect(checkTyped('stor', 'story')).toEqual({ correct: true, typo: true });
		expect(checkTyped('bok', 'book')).toEqual({ correct: false, typo: false }); // 4 letters: no typo allowed
		expect(checkTyped('boook', 'book')).toEqual({ correct: false, typo: false });
		expect(checkTyped('teecher', 'teacher')).toEqual({ correct: true, typo: true });
		expect(checkTyped('tiicher', 'teacher')).toEqual({ correct: false, typo: false });
	});

	it('refuses an empty answer', () => {
		expect(checkTyped('   ', 'story').correct).toBe(false);
	});

	it('a typo or the hint button sets hintUsed', () => {
		expect(effectiveHintUsed(false, checkTyped('storu', 'story'))).toBe(true);
		expect(effectiveHintUsed(true, checkTyped('story', 'story'))).toBe(true);
		expect(effectiveHintUsed(false, checkTyped('story', 'story'))).toBe(false);
		expect(hintFor(' story')).toBe('s');
	});
});
