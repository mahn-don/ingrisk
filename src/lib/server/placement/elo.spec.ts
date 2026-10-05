import { describe, expect, it } from 'vitest';
import { PART_B_ITEMS, expectedScore, kFactor, nextBand, updateTheta } from './elo.ts';

describe('Elo', () => {
	it('expects 0.5 when ability equals difficulty', () => {
		expect(expectedScore(3, 3)).toBe(0.5);
		expect(expectedScore(4, 3)).toBeCloseTo(0.731, 3);
		expect(expectedScore(2, 3)).toBeCloseTo(0.269, 3);
	});

	it('K goes linearly from 1.0 to 0.3 over the 12 items', () => {
		expect(PART_B_ITEMS).toBe(12);
		expect(kFactor(0)).toBe(1);
		expect(kFactor(11)).toBeCloseTo(0.3, 10);
		expect(kFactor(5.5)).toBeCloseTo(0.65, 10);
		const steps = Array.from({ length: 11 }, (_, i) => kFactor(i) - kFactor(i + 1));
		for (const step of steps) expect(step).toBeCloseTo(0.7 / 11, 10);
	});

	it('updates θ by K(correct − P)', () => {
		expect(updateTheta(3, 3, true, 0)).toBe(3.5);
		expect(updateTheta(3, 3, false, 0)).toBe(2.5);
		expect(updateTheta(3, 3, true, 11)).toBeCloseTo(3.15, 10);
		expect(updateTheta(3, 4, true, 0)).toBeCloseTo(3 + (1 - expectedScore(3, 4)), 10);
	});

	it('next band = round(θ) clamped to 1-8', () => {
		expect(nextBand(3.49)).toBe(3);
		expect(nextBand(3.5)).toBe(4);
		expect(nextBand(0.2)).toBe(1);
		expect(nextBand(9.7)).toBe(8);
	});
});
