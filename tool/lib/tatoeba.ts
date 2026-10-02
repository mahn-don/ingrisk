// Normalizing, filtering and levelling Tatoeba EN-VI pairs. Pure functions; no file I/O.
import type { PairRow } from './tatoeba-pairs.ts';

export const MAX_ENGLISH_WORDS = 15;
export const MIN_VI_WORDS_FOR_DIACRITIC_CHECK = 3;

export interface TatoebaItem {
	tatoeba_id_en: number;
	tatoeba_id_vi: number;
	en: string;
	vi: string;
	word_count: number;
	ngsl_band_max: number | null;
	off_list_count: number;
}

/** NFC, straight quotes and apostrophes, single spaces, trimmed. */
export function normalizeText(text: string): string {
	return text
		.normalize('NFC')
		.replace(/[‘’‚‛′]/g, "'")
		.replace(/[“”„‟″]/g, '"')
		.replace(/\s+/g, ' ')
		.trim();
}

export function countWords(text: string): number {
	return text === '' ? 0 : text.split(' ').length;
}

/** Basic Latin letters, digits, space and common punctuation only. */
const ENGLISH_ALLOWED = /^[A-Za-z0-9 .,!?;:'"()-]+$/;

/**
 * After NFD: grave, acute, circumflex, tilde, breve, hook above, horn, dot below
 * (every Vietnamese tone mark and vowel modifier), plus d-with-stroke.
 */
const VIETNAMESE_MARK = /[̛̣̀́̂̃̆̉Đđ]/;

export function hasVietnameseDiacritic(text: string): boolean {
	return VIETNAMESE_MARK.test(text.normalize('NFD'));
}

export const FILTER_STEPS = [
	'empty English or Vietnamese',
	`English longer than ${MAX_ENGLISH_WORDS} words`,
	'English has characters outside basic Latin, digits and common punctuation',
	'Vietnamese identical to English',
	`Vietnamese without diacritics (${MIN_VI_WORDS_FOR_DIACRITIC_CHECK}+ words)`,
	'duplicate English sentence'
] as const;

export interface NormalizedPair {
	engId: number;
	vieId: number;
	en: string;
	vi: string;
}

export interface FilterResult {
	pairs: NormalizedPair[];
	input: number;
	steps: { step: string; removed: number; remaining: number }[];
}

/** Normalize every pair, then apply FILTER_STEPS in order, counting what each step removes. */
export function filterPairs(rows: PairRow[]): FilterResult {
	let pairs: NormalizedPair[] = rows.map((r) => ({
		engId: r.engId,
		vieId: r.vieId,
		en: normalizeText(r.engText),
		vi: normalizeText(r.vieText)
	}));
	const input = pairs.length;
	const predicates: ((p: NormalizedPair) => boolean)[] = [
		(p) => p.en !== '' && p.vi !== '',
		(p) => countWords(p.en) <= MAX_ENGLISH_WORDS,
		(p) => ENGLISH_ALLOWED.test(p.en),
		(p) => p.vi.toLowerCase() !== p.en.toLowerCase(),
		(p) => countWords(p.vi) < MIN_VI_WORDS_FOR_DIACRITIC_CHECK || hasVietnameseDiacritic(p.vi)
	];
	const steps: FilterResult['steps'] = [];
	predicates.forEach((keep, i) => {
		const before = pairs.length;
		pairs = pairs.filter(keep);
		steps.push({ step: FILTER_STEPS[i], removed: before - pairs.length, remaining: pairs.length });
	});
	const before = pairs.length;
	pairs = dedupeEnglish(pairs);
	steps.push({ step: FILTER_STEPS[5], removed: before - pairs.length, remaining: pairs.length });
	return { pairs, input, steps };
}

/** One pair per English sentence (case-insensitive): the lowest Vietnamese id wins; sorted by English id. */
export function dedupeEnglish(pairs: NormalizedPair[]): NormalizedPair[] {
	const best = new Map<string, NormalizedPair>();
	for (const pair of pairs) {
		const key = pair.en.toLowerCase();
		const current = best.get(key);
		if (
			current === undefined ||
			pair.vieId < current.vieId ||
			(pair.vieId === current.vieId && pair.engId < current.engId)
		) {
			best.set(key, pair);
		}
	}
	return [...best.values()].sort((a, b) => a.engId - b.engId || a.vieId - b.vieId);
}

const NEGATIVE_CONTRACTION_STEMS: Record<string, string> = { ca: 'can', wo: 'will', sha: 'shall' };
const FALLBACK_SUFFIXES = ['s', 'es', 'ed', 'ing'];

function lookupWord(word: string, index: Map<string, number>): number | undefined {
	const direct = index.get(word);
	if (direct !== undefined) return direct;
	for (const suffix of FALLBACK_SUFFIXES) {
		if (word.length > suffix.length + 1 && word.endsWith(suffix)) {
			const band = index.get(word.slice(0, -suffix.length));
			if (band !== undefined) return band;
		}
	}
	return undefined;
}

/** Reduce a token to the word to look up: "don't" -> "do", "won't" -> "will", "she's" -> "she". */
function stemContraction(lower: string): string {
	if (lower.endsWith("n't")) {
		const stem = lower.slice(0, -3);
		return NEGATIVE_CONTRACTION_STEMS[stem] ?? stem;
	}
	const apostrophe = lower.indexOf("'");
	return apostrophe > 0 ? lower.slice(0, apostrophe) : lower;
}

/**
 * Approximate vocabulary level of an English sentence against NGSL.
 *
 * This is a heuristic, not a lemmatizer:
 * - Tokens are runs of letters (with inner apostrophes); hyphenated words count as separate
 *   words, and any whitespace-separated piece containing a digit is skipped as a number.
 * - Contractions are reduced to their first word ("don't" -> "do", "she'll" -> "she").
 * - Each word is looked up in the NGSL form index (every inflected form from the lemmatized
 *   list, plus supplementary words as band 1). If that misses, -s, -es, -ed and -ing are
 *   stripped and the stem kept only if it is a known form.
 * - Known words are matched before proper-noun detection, so "Monday" and "I" count as known.
 *   An unknown word that is capitalized and not sentence-initial is treated as a proper noun
 *   and skipped. Sentence starts are the first word and any word after . ! or ?.
 * Returns the highest band seen (null if no word matched) and how many words stayed unmatched.
 */
export function analyzeLevel(
	en: string,
	index: Map<string, number>
): { ngsl_band_max: number | null; off_list_count: number } {
	let bandMax: number | null = null;
	let offList = 0;
	for (const sentence of en.split(/(?<=[.!?])\s+/)) {
		let first = true;
		for (const piece of sentence.split(' ')) {
			if (/\d/.test(piece)) {
				first = false;
				continue;
			}
			for (const token of piece.match(/[A-Za-z]+(?:'[A-Za-z]+)*/g) ?? []) {
				const initial = first;
				first = false;
				const band = lookupWord(stemContraction(token.toLowerCase()), index);
				if (band !== undefined) {
					bandMax = bandMax === null ? band : Math.max(bandMax, band);
				} else if (!(initial === false && /^[A-Z]/.test(token))) {
					offList++;
				}
			}
		}
	}
	return { ngsl_band_max: bandMax, off_list_count: offList };
}

export function toItems(pairs: NormalizedPair[], index: Map<string, number>): TatoebaItem[] {
	return pairs.map((p) => ({
		tatoeba_id_en: p.engId,
		tatoeba_id_vi: p.vieId,
		en: p.en,
		vi: p.vi,
		word_count: countWords(p.en),
		...analyzeLevel(p.en, index)
	}));
}
