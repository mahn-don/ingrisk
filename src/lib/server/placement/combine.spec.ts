import { describe, expect, it } from 'vitest';
import { combine } from './combine.ts';
import { IELTS, TOEIC, VSTEP, cefrFromBand, equivalents } from './scales.ts';

describe('combine', () => {
	it('ability_band = round(0.4·vocab + 0.6·cloze_theta) when Part B ran', () => {
		expect(combine({ vocabBand: 3, clozeTheta: 5, writing: null })).toEqual({ theta: 4.2, abilityBand: 4, knownBandCeiling: 3, cefr: 'B1' });
		expect(combine({ vocabBand: 2, clozeTheta: 2.6, writing: null }).abilityBand).toBe(2);
	});

	it('ability_band = vocab_band when Part B was skipped', () => {
		expect(combine({ vocabBand: 5, clozeTheta: null, writing: null })).toEqual({ theta: 5, abilityBand: 5, knownBandCeiling: 5, cefr: 'B1' });
	});

	it('clamps the band to 1-8', () => {
		expect(combine({ vocabBand: 8, clozeTheta: 11, writing: null }).abilityBand).toBe(8);
		expect(combine({ vocabBand: 1, clozeTheta: -2, writing: null }).abilityBand).toBe(1);
	});

	it('gives C1 only for a writing ≥ C1 and ability_band ≥ 7', () => {
		expect(combine({ vocabBand: 7, clozeTheta: 7, writing: 'C1' }).cefr).toBe('C1');
		expect(combine({ vocabBand: 8, clozeTheta: 8, writing: 'C2' }).cefr).toBe('C1');
		expect(combine({ vocabBand: 6, clozeTheta: 6, writing: 'C1' }).cefr).toBe('B2');
		expect(combine({ vocabBand: 8, clozeTheta: 8, writing: 'B2' }).cefr).toBe('B2');
		expect(combine({ vocabBand: 8, clozeTheta: 8, writing: null }).cefr).toBe('B2');
	});

	it('a weak writing never lowers the estimate', () => {
		expect(combine({ vocabBand: 5, clozeTheta: 5, writing: 'A1' }).cefr).toBe('B1');
	});
});

describe('scales', () => {
	it('maps bands to CEFR: 1 A1, 2-3 A2, 4-5 B1, 6-8 B2', () => {
		expect([1, 2, 3, 4, 5, 6, 7, 8].map(cefrFromBand)).toEqual(['A1', 'A2', 'A2', 'B1', 'B1', 'B2', 'B2', 'B2']);
	});

	it('holds the approximate table', () => {
		expect(VSTEP).toMatchObject({ A1: 1, A2: 2, B1: 3, B2: 4, C1: 5 });
		expect(IELTS).toMatchObject({
			A1: null,
			A2: { min: 3, max: 3.5 },
			B1: { min: 4, max: 5 },
			B2: { min: 5.5, max: 6.5 },
			C1: { min: 7, max: 8 }
		});
		expect(TOEIC).toMatchObject({
			A1: null,
			A2: { min: 225, max: 545 },
			B1: { min: 550, max: 780 },
			B2: { min: 785, max: 940 },
			C1: { min: 945, max: null }
		});
		expect(equivalents('B1')).toEqual({ cefr: 'B1', vstep: 3, ielts: { min: 4, max: 5 }, toeic: { min: 550, max: 780 } });
	});
});
