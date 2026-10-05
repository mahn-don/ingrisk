// Part B: the Elo-style ability update over 12 adaptive cloze items. Pure functions.
import { clampBand } from './staircase.ts';

export const PART_B_ITEMS = 12;
export const K_START = 1.0;
export const K_END = 0.3;

/** Expected score of a learner at `theta` on an item of difficulty `d` (its level band). */
export const expectedScore = (theta: number, d: number) => 1 / (1 + Math.exp(-(theta - d)));

/** K for the item at 0-based `index`: linear from 1.0 (first item) to 0.3 (twelfth). */
export function kFactor(index: number, total = PART_B_ITEMS): number {
	if (total <= 1) return K_START;
	const i = Math.min(Math.max(index, 0), total - 1);
	return K_START + ((K_END - K_START) * i) / (total - 1);
}

/** θ += K(correct − P). */
export const updateTheta = (theta: number, d: number, correct: boolean, index: number) =>
	theta + kFactor(index) * ((correct ? 1 : 0) - expectedScore(theta, d));

/** The band of the next item: round(θ) clamped to 1-8. */
export const nextBand = (theta: number) => clampBand(Math.round(theta));
