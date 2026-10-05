// Part A: the adaptive yes/no vocabulary staircase and its false-alarm-corrected score.
// Pure functions; the engine (engine.ts) stores the state. See plans/phase-08.md.

export const MIN_BAND = 1;
export const MAX_BAND = 8;
export const START_BAND = 2;
export const REAL_PER_BLOCK = 4;
export const PSEUDO_PER_BLOCK = 2;
export const BLOCK_SIZE = REAL_PER_BLOCK + PSEUDO_PER_BLOCK;
export const MAX_BLOCKS = 7;
export const MAX_REVERSALS = 3;
/** Corrected hit rate a band needs to count as known. */
export const KNOWN_THRESHOLD = 0.7;
/** Above this false-alarm rate the result is flagged and vocab_band capped. */
export const UNRELIABLE_FA_RATE = 0.4;
export const UNRELIABLE_CAP = 2;

export const clampBand = (band: number) => Math.min(MAX_BAND, Math.max(MIN_BAND, band));

/** One shown word and the learner's answer (true = "Biết"). */
export interface BlockItem {
	word: string;
	real: boolean;
	known?: boolean;
}

export interface Block {
	band: number;
	items: BlockItem[];
}

export interface BlockScore {
	hits: number;
	real: number;
	falseAlarms: number;
	pseudo: number;
}

export function scoreBlock(block: Block): BlockScore {
	const real = block.items.filter((i) => i.real);
	const pseudo = block.items.filter((i) => !i.real);
	return {
		hits: real.filter((i) => i.known === true).length,
		real: real.length,
		falseAlarms: pseudo.filter((i) => i.known === true).length,
		pseudo: pseudo.length
	};
}

export type Move = -1 | 0 | 1;

/** Up if hit rate ≥ 0.75 with at most one false alarm; down if hit rate < 0.5; otherwise stay. */
export function blockMove(score: BlockScore): Move {
	const hitRate = score.real === 0 ? 0 : score.hits / score.real;
	if (hitRate >= 0.75 && score.falseAlarms <= 1) return 1;
	if (hitRate < 0.5) return -1;
	return 0;
}

export interface Staircase {
	band: number;
	/** The moves actually made (after clamping at bands 1 and 8), one per finished block. */
	moves: Move[];
	reversals: number;
	done: boolean;
}

export const startStaircase = (): Staircase => ({ band: START_BAND, moves: [], reversals: 0, done: false });

/**
 * Apply a finished block. A move that would leave 1-8 counts as staying. A reversal is a move
 * opposite to the last nonzero move. Done after 7 blocks or 3 reversals.
 */
export function stepStaircase(state: Staircase, block: Block): Staircase {
	const wanted = blockMove(scoreBlock(block));
	const band = clampBand(state.band + wanted);
	const move = (band - state.band) as Move;
	const lastNonzero = [...state.moves].reverse().find((m) => m !== 0);
	const reversals = state.reversals + (move !== 0 && lastNonzero !== undefined && move !== lastNonzero ? 1 : 0);
	const moves = [...state.moves, move];
	return { band, moves, reversals, done: moves.length >= MAX_BLOCKS || reversals >= MAX_REVERSALS };
}

export interface BandScore {
	band: number;
	hits: number;
	real: number;
	/** Hit rate at this band. */
	hitRate: number;
	/** (hitRate − f) / (1 − f), clamped to 0-1. */
	corrected: number;
}

export interface PartAScore {
	bands: BandScore[];
	/** False alarms over all pseudo-words shown. */
	falseAlarmRate: number;
	vocabBand: number;
	unreliable: boolean;
}

/** Correct a hit rate for guessing with the overall false-alarm rate f. f = 1 gives 0. */
export function correctedHitRate(hitRate: number, f: number): number {
	if (f >= 1) return 0;
	return Math.min(1, Math.max(0, (hitRate - f) / (1 - f)));
}

/**
 * vocab_band = the highest visited band whose corrected hit rate is at least 0.7 (minimum 1).
 * With a false-alarm rate above 0.4 the result is flagged unreliable and capped at band 2.
 */
export function scorePartA(blocks: readonly Block[]): PartAScore {
	const byBand = new Map<number, { hits: number; real: number }>();
	let falseAlarms = 0;
	let pseudo = 0;
	for (const block of blocks) {
		const s = scoreBlock(block);
		const entry = byBand.get(block.band) ?? { hits: 0, real: 0 };
		entry.hits += s.hits;
		entry.real += s.real;
		byBand.set(block.band, entry);
		falseAlarms += s.falseAlarms;
		pseudo += s.pseudo;
	}
	const f = pseudo === 0 ? 0 : falseAlarms / pseudo;
	const bands = [...byBand.entries()]
		.sort(([a], [b]) => a - b)
		.map(([band, { hits, real }]) => {
			const hitRate = real === 0 ? 0 : hits / real;
			return { band, hits, real, hitRate, corrected: correctedHitRate(hitRate, f) };
		});
	const known = bands.filter((b) => b.corrected >= KNOWN_THRESHOLD).map((b) => b.band);
	const unreliable = f > UNRELIABLE_FA_RATE;
	let vocabBand = Math.max(MIN_BAND, ...known);
	if (unreliable) vocabBand = Math.min(vocabBand, UNRELIABLE_CAP);
	return { bands, falseAlarmRate: f, vocabBand, unreliable };
}
