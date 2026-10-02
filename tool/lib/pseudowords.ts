// Pseudo-word generation for the yes/no vocabulary test. Pure functions; no file I/O.
import { splitLines } from './text.ts';

export const MIN_LENGTH = 5;
export const MAX_LENGTH = 9;

/** Deterministic PRNG (mulberry32): same seed, same sequence. Returns floats in [0, 1). */
export function createRng(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(rng: () => number, list: readonly T[]): T {
	return list[Math.floor(rng() * list.length)];
}

// Two syllables: onset + vowel + medial cluster + rime. The medial cluster is the first
// syllable's coda plus the second syllable's onset, limited to clusters English actually uses.
// e.g. pl+u+rth+y = plurthy, d+i+sp+one = dispone, f+a+nt+ule = fantule.
const ONSETS = [
	'', 'b', 'bl', 'br', 'c', 'cl', 'cr', 'd', 'dr', 'f', 'fl', 'fr', 'g', 'gl', 'gr', 'h', 'j',
	'l', 'm', 'n', 'p', 'pl', 'pr', 'r', 's', 'sk', 'sl', 'sn', 'sp', 'st', 'str', 'sw', 't', 'th',
	'tr', 'v', 'w', 'sh', 'ch'
] as const;
// Single vowels are listed twice so they are drawn more often than digraphs.
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'i', 'o', 'u', 'ai', 'ea', 'oo', 'ou'] as const;
const MEDIALS = [
	'b', 'd', 'f', 'g', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'th', 'sh', 'ch', 'nt', 'nd',
	'mp', 'mb', 'nc', 'nk', 'ng', 'st', 'sp', 'sc', 'sk', 'rt', 'rd', 'rm', 'rn', 'rb', 'rg', 'rk',
	'rl', 'rth', 'lt', 'ld', 'lm', 'lp', 'lv', 'ft', 'pt', 'ct', 'bl', 'pl', 'cl', 'gl', 'fl', 'br',
	'pr', 'tr', 'dr', 'gr', 'cr', 'fr', 'nth', 'ndr', 'ntr', 'mpl', 'mbl', 'str', 'spr'
] as const;
const RIMES = [
	'y', 'ey', 'le', 'ow', 'et', 'el', 'en', 'on', 'ot', 'ix', 'ent', 'ine', 'ope', 'ane', 'ude',
	'ule', 'one', 'ide', 'ate', 'ish', 'ock', 'um', 'id', 'ic', 'ance', 'ice', 'oke', 'ure', 'ast',
	'ond', 'ush', 'ible'
] as const;

const CONSONANT_RUN = /[bcdfghjklmnpqrstvwxz]{4,}/;

/** One candidate built from the templates, or null if it violates length or cluster limits. */
export function generateCandidate(rng: () => number): string | null {
	const word = pick(rng, ONSETS) + pick(rng, VOWELS) + pick(rng, MEDIALS) + pick(rng, RIMES);
	if (word.length < MIN_LENGTH || word.length > MAX_LENGTH) return null;
	if (CONSONANT_RUN.test(word)) return null;
	return word;
}

/** Substrings that make a candidate unusable in a learning app (conservative on purpose). */
export const BLOCKED_SUBSTRINGS = [
	'anal', 'anus', 'arse', 'ass', 'bitch', 'boob', 'butt', 'chink', 'cock', 'coon', 'crap', 'cum',
	'cunt', 'damn', 'dick', 'dildo', 'fag', 'fart', 'fuck', 'gook', 'hell', 'homo', 'jizz', 'kike',
	'nazi', 'nig', 'pee', 'penis', 'piss', 'poo', 'porn', 'rape', 'sex', 'shit', 'slut', 'spic',
	'tit', 'turd', 'twat', 'wank', 'whore'
] as const;

const AFFIXES = ['s', 'ed', 'ing', 'er', 'y'] as const;

export interface RejectionContext {
	/** NGSL headwords and every inflected form, plus supplementary words. */
	ngsl: Set<string>;
	/** A large general English word list. */
	dictionary: Set<string>;
	/** Words removed by hand (tool/pseudowords-exclude.txt). */
	exclude: Set<string>;
}

/** Real words reachable from `word` by adding or removing one affix (with simple e-drop). */
export function affixVariants(word: string): string[] {
	const variants: string[] = [];
	for (const affix of AFFIXES) {
		variants.push(word + affix);
		if (word.endsWith('e') && affix !== 's') variants.push(word.slice(0, -1) + affix);
		if (word.endsWith(affix) && word.length > affix.length + 1) {
			const stem = word.slice(0, -affix.length);
			variants.push(stem, stem + 'e');
		}
	}
	return variants;
}

/** Why a candidate is rejected, or null if it is a usable pseudo-word. */
export function rejectionReason(word: string, ctx: RejectionContext): string | null {
	if (ctx.exclude.has(word)) return 'on the exclude list';
	if (ctx.ngsl.has(word)) return 'NGSL word or form';
	if (ctx.dictionary.has(word)) return 'in the English word list';
	const real = affixVariants(word).find((v) => ctx.ngsl.has(v) || ctx.dictionary.has(v));
	if (real !== undefined) return `real word with an affix change ("${real}")`;
	if (/q(?!u)/.test(word)) return 'q not followed by u';
	if (/(.)\1\1/.test(word)) return 'three identical letters in a row';
	if (/[vjq]$/.test(word)) return 'un-English ending';
	const blocked = BLOCKED_SUBSTRINGS.find((s) => word.includes(s));
	if (blocked !== undefined) return `contains blocked substring "${blocked}"`;
	return null;
}

export interface GenerationResult {
	words: string[];
	rejected: { word: string; reason: string }[];
}

/**
 * Draw candidates until `count` are accepted. Output order is generation order, which is
 * already random and fully determined by the seed; excluding a word later only replaces it
 * and leaves the other accepted words in place. Repeated draws are skipped silently.
 */
export function generatePseudowords(
	count: number,
	seed: number,
	ctx: RejectionContext,
	maxDraws = 1_000_000
): GenerationResult {
	const rng = createRng(seed);
	const seen = new Set<string>();
	const words: string[] = [];
	const rejected: GenerationResult['rejected'] = [];
	for (let draw = 0; words.length < count; draw++) {
		if (draw >= maxDraws) throw new Error(`Only ${words.length} pseudo-words after ${maxDraws} draws`);
		const word = generateCandidate(rng);
		if (word === null || seen.has(word)) continue;
		seen.add(word);
		const reason = rejectionReason(word, ctx);
		if (reason === null) words.push(word);
		else rejected.push({ word, reason });
	}
	return { words, rejected };
}

/** Parse tool/pseudowords-exclude.txt: one word per line, `#` starts a comment. */
export function parseExcludeList(raw: string): Set<string> {
	const words = new Set<string>();
	for (const line of splitLines(raw)) {
		const word = line.replace(/#.*/, '').trim().toLowerCase();
		if (word !== '') words.add(word);
	}
	return words;
}
