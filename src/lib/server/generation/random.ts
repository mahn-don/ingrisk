// Deterministic randomness for content generation: same input, same output, on every machine.
import { createHash } from 'node:crypto';

/** 32-bit FNV-1a hash of a string. */
export function hashString(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** mulberry32 PRNG: floats in [0, 1). */
export function seededRng(seed: number | string): () => number {
	let state = (typeof seed === 'string' ? hashString(seed) : seed) >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A shuffled copy (Fisher–Yates) driven by `seed`. */
export function seededShuffle<T>(items: readonly T[], seed: number | string): T[] {
	const rng = seededRng(seed);
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

/** One element chosen by `seed` (undefined for an empty list). */
export function seededPick<T>(items: readonly T[], seed: number | string): T | undefined {
	return items.length === 0 ? undefined : items[Math.floor(seededRng(seed)() * items.length)];
}

export function sha256(text: string): string {
	return createHash('sha256').update(text).digest('hex');
}
