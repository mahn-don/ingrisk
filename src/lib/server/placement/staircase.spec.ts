import { describe, expect, it } from 'vitest';
import {
	type Block,
	MAX_BLOCKS,
	blockMove,
	correctedHitRate,
	scorePartA,
	startStaircase,
	stepStaircase
} from './staircase.ts';

/** A block at `band` with `hits` of 4 real words known and `fa` of 2 pseudo-words "known". */
const block = (band: number, hits: number, fa = 0): Block => ({
	band,
	items: [
		...Array.from({ length: 4 }, (_, i) => ({ word: `r${band}-${i}`, real: true, known: i < hits })),
		...Array.from({ length: 2 }, (_, i) => ({ word: `p${i}`, real: false, known: i < fa }))
	]
});

describe('blockMove', () => {
	it('moves up with hit rate ≥ 0.75 and at most one false alarm', () => {
		expect(blockMove({ hits: 3, real: 4, falseAlarms: 1, pseudo: 2 })).toBe(1);
		expect(blockMove({ hits: 4, real: 4, falseAlarms: 0, pseudo: 2 })).toBe(1);
	});
	it('stays when the hits are high but there are two false alarms', () => {
		expect(blockMove({ hits: 4, real: 4, falseAlarms: 2, pseudo: 2 })).toBe(0);
	});
	it('stays at a hit rate of 0.5', () => {
		expect(blockMove({ hits: 2, real: 4, falseAlarms: 0, pseudo: 2 })).toBe(0);
	});
	it('moves down below 0.5', () => {
		expect(blockMove({ hits: 1, real: 4, falseAlarms: 0, pseudo: 2 })).toBe(-1);
		expect(blockMove({ hits: 0, real: 4, falseAlarms: 2, pseudo: 2 })).toBe(-1);
	});
});

describe('the staircase', () => {
	it('starts at band 2 and steps up, down or stays', () => {
		let s = startStaircase();
		expect(s.band).toBe(2);
		s = stepStaircase(s, block(2, 4));
		expect(s.band).toBe(3);
		s = stepStaircase(s, block(3, 2));
		expect(s.band).toBe(3);
		s = stepStaircase(s, block(3, 1));
		expect(s).toMatchObject({ band: 2, moves: [1, 0, -1], reversals: 1, done: false });
	});

	it('stops after three reversals', () => {
		let s = startStaircase();
		for (const hits of [4, 0, 4]) s = stepStaircase(s, block(s.band, hits));
		expect(s).toMatchObject({ reversals: 2, done: false });
		s = stepStaircase(s, block(s.band, 0));
		expect(s).toMatchObject({ band: 2, moves: [1, -1, 1, -1], reversals: 3, done: true });
	});

	it('stays-in-between does not break a reversal, and is not one', () => {
		let s = startStaircase();
		for (const hits of [4, 2, 2, 0]) s = stepStaircase(s, block(s.band, hits));
		expect(s).toMatchObject({ moves: [1, 0, 0, -1], reversals: 1 });
	});

	it('stops after 7 blocks', () => {
		let s = startStaircase();
		for (let i = 0; i < MAX_BLOCKS - 1; i++) s = stepStaircase(s, block(s.band, 4));
		expect(s.done).toBe(false);
		s = stepStaircase(s, block(s.band, 4));
		expect(s.done).toBe(true);
		expect(s.moves).toHaveLength(7);
	});

	it('clamps at band 8 and band 1; a clamped move counts as staying', () => {
		let s = { ...startStaircase(), band: 8 };
		s = stepStaircase(s, block(8, 4));
		expect(s).toMatchObject({ band: 8, moves: [0] });
		s = { ...startStaircase(), band: 1, moves: [1] };
		s = stepStaircase(s, block(1, 0));
		expect(s).toMatchObject({ band: 1, moves: [1, 0], reversals: 0 });
	});
});

describe('scorePartA', () => {
	it('corrects hit rates for false alarms', () => {
		expect(correctedHitRate(1, 0)).toBe(1);
		expect(correctedHitRate(0.75, 0.5)).toBe(0.5);
		expect(correctedHitRate(0.25, 0.5)).toBe(0);
		expect(correctedHitRate(1, 1)).toBe(0);
	});

	it('vocab_band is the highest visited band with corrected ≥ 0.7', () => {
		const score = scorePartA([block(2, 4), block(3, 4), block(4, 3), block(5, 1), block(4, 2)]);
		// band 4: 5/8 = 0.625 < 0.7, band 3: 1.0
		expect(score.falseAlarmRate).toBe(0);
		expect(score.bands.map((b) => [b.band, b.corrected])).toEqual([
			[2, 1],
			[3, 1],
			[4, 0.625],
			[5, 0.25]
		]);
		expect(score.vocabBand).toBe(3);
		expect(score.unreliable).toBe(false);
	});

	it('uses the overall false-alarm rate', () => {
		// f = 2/8 = 0.25; band 2: (1 - 0.25)/(0.75) = 1; band 3: (0.75 - 0.25)/0.75 = 0.667
		const score = scorePartA([block(2, 4, 1), block(3, 3, 1), block(3, 3), block(4, 0)]);
		expect(score.falseAlarmRate).toBe(0.25);
		expect(score.vocabBand).toBe(2);
	});

	it('is at least band 1', () => {
		expect(scorePartA([block(2, 0), block(1, 1)]).vocabBand).toBe(1);
	});

	it('flags more than 40% false alarms and caps vocab_band at 2', () => {
		const score = scorePartA([block(2, 4, 2), block(3, 4, 1), block(4, 4, 2), block(5, 4, 0)]);
		expect(score.falseAlarmRate).toBe(5 / 8);
		expect(score.unreliable).toBe(true);
		expect(score.vocabBand).toBeLessThanOrEqual(2);
	});

	it('exactly 40% is not flagged', () => {
		const blocks = [block(2, 4, 1), block(3, 4, 1), block(4, 4, 0), block(5, 4, 1), block(6, 4, 1)];
		expect(scorePartA(blocks)).toMatchObject({ falseAlarmRate: 0.4, unreliable: false });
	});
});
