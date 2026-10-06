// Combining the three parts into one estimate. Pure; re-run when a queued writing is graded.
import { type Cefr, cefrFromBand, cefrRank } from './scales.ts';
import { clampBand } from './staircase.ts';

export const VOCAB_WEIGHT = 0.4;
export const CLOZE_WEIGHT = 0.6;
/** C1 is given only to a graded writing ≥ C1 together with an ability band of at least this. */
export const C1_MIN_BAND = 7;

export interface CombineInput {
	vocabBand: number;
	/** Null when Part B was skipped. */
	clozeTheta: number | null;
	/** The graded writing's CEFR; null when skipped or not graded yet. */
	writing: Cefr | null;
}

export interface Combined {
	/** Unrounded ability (the overall theta stored with the result). */
	theta: number;
	abilityBand: number;
	knownBandCeiling: number;
	cefr: Cefr;
}

/**
 * ability_band = round(0.4·vocab_band + 0.6·cloze_theta) when Part B ran, else vocab_band.
 * CEFR from the band (1 A1, 2-3 A2, 4-5 B1, 6-8 B2); C1 only with a writing ≥ C1 and band ≥ 7.
 * The writing never lowers the estimate.
 */
export function combine(input: CombineInput): Combined {
	const theta = input.clozeTheta === null ? input.vocabBand : VOCAB_WEIGHT * input.vocabBand + CLOZE_WEIGHT * input.clozeTheta;
	const abilityBand = clampBand(Math.round(theta));
	let cefr = cefrFromBand(abilityBand);
	if (input.writing !== null && cefrRank(input.writing) >= cefrRank('C1') && abilityBand >= C1_MIN_BAND) cefr = 'C1';
	return { theta, abilityBand, knownBandCeiling: input.vocabBand, cefr };
}
