// CEFR from the placement bands, and the other scales Vietnamese learners anchor on.
//
// APPROXIMATE. These are rough public alignments between CEFR and each test, not official
// conversions, and this app tests only reading (vocabulary, cloze) and writing, never listening or
// speaking. The UI always labels them "ước tính" (estimate) and says they are not certified.
import type { CEFR_LEVELS } from '../db/schema.ts';

export type Cefr = (typeof CEFR_LEVELS)[number];

export const CEFR_ORDER: readonly Cefr[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const cefrRank = (cefr: Cefr) => CEFR_ORDER.indexOf(cefr) + 1;

/** Ability band (1-8) to CEFR: 1 → A1; 2-3 → A2; 4-5 → B1; 6-8 → B2. C1 needs writing (combine.ts). */
export function cefrFromBand(band: number): Cefr {
	if (band <= 1) return 'A1';
	if (band <= 3) return 'A2';
	if (band <= 5) return 'B1';
	return 'B2';
}

/** An inclusive score range; `max` null means "and above". */
export interface ScoreRange {
	min: number;
	max: number | null;
}

/** VSTEP level (Vietnam's national framework, levels 1-6). */
export const VSTEP: Readonly<Record<Cefr, number>> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

/** IELTS band ranges. None given for A1 (below the scale's useful range). */
export const IELTS: Readonly<Record<Cefr, ScoreRange | null>> = {
	A1: null,
	A2: { min: 3.0, max: 3.5 },
	B1: { min: 4.0, max: 5.0 },
	B2: { min: 5.5, max: 6.5 },
	C1: { min: 7.0, max: 8.0 },
	C2: { min: 8.5, max: 9.0 }
};

/** TOEIC Listening & Reading total ranges. None given for A1. */
export const TOEIC: Readonly<Record<Cefr, ScoreRange | null>> = {
	A1: null,
	A2: { min: 225, max: 545 },
	B1: { min: 550, max: 780 },
	B2: { min: 785, max: 940 },
	C1: { min: 945, max: null },
	C2: { min: 945, max: null }
};

export interface Equivalents {
	cefr: Cefr;
	vstep: number;
	ielts: ScoreRange | null;
	toeic: ScoreRange | null;
}

export const equivalents = (cefr: Cefr): Equivalents => ({ cefr, vstep: VSTEP[cefr], ielts: IELTS[cefr], toeic: TOEIC[cefr] });
