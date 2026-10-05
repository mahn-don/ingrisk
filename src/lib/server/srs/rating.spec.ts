import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { EASY_THRESHOLD_MS, SLOW_THRESHOLD_MS, type Outcome, ratingFromOutcome } from './rating.ts';

describe('ratingFromOutcome', () => {
	const cases: [string, Outcome, Rating][] = [
		['wrong choice', { correct: false, mode: 'choice', responseMs: 2000, hintUsed: false }, Rating.Again],
		['wrong typing, fast', { correct: false, mode: 'typing', responseMs: 1000, hintUsed: false }, Rating.Again],
		['wrong with hint', { correct: false, mode: 'typing', responseMs: 1000, hintUsed: true }, Rating.Again],
		['correct choice with hint', { correct: true, mode: 'choice', responseMs: 2000, hintUsed: true }, Rating.Hard],
		['correct typing with hint, fast', { correct: true, mode: 'typing', responseMs: 1000, hintUsed: true }, Rating.Hard],
		['choice exactly 8 s', { correct: true, mode: 'choice', responseMs: 8000, hintUsed: false }, Rating.Good],
		['choice 8.001 s', { correct: true, mode: 'choice', responseMs: 8001, hintUsed: false }, Rating.Hard],
		['typing exactly 15 s', { correct: true, mode: 'typing', responseMs: 15000, hintUsed: false }, Rating.Good],
		['typing 15.001 s', { correct: true, mode: 'typing', responseMs: 15001, hintUsed: false }, Rating.Hard],
		['typing 4.999 s', { correct: true, mode: 'typing', responseMs: 4999, hintUsed: false }, Rating.Easy],
		['typing exactly 5 s', { correct: true, mode: 'typing', responseMs: 5000, hintUsed: false }, Rating.Good],
		['typing 10 s', { correct: true, mode: 'typing', responseMs: 10000, hintUsed: false }, Rating.Good],
		['choice very fast never Easy', { correct: true, mode: 'choice', responseMs: 300, hintUsed: false }, Rating.Good],
		['choice 5 s', { correct: true, mode: 'choice', responseMs: 5000, hintUsed: false }, Rating.Good]
	];

	it.each(cases)('%s', (_name, outcome, expected) => {
		expect(ratingFromOutcome(outcome)).toBe(expected);
	});

	it('exports its thresholds', () => {
		expect(SLOW_THRESHOLD_MS).toEqual({ choice: 8000, typing: 15000 });
		expect(EASY_THRESHOLD_MS).toBe(5000);
	});
});
