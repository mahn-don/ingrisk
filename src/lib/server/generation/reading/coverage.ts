// Comprehensible input: how much of a text a learner at a band already knows.
import { FUNCTION_WORDS } from '../cloze/stoplist.ts';
import type { FormIndex } from '../forms.ts';
import { tokenize } from '../tokens.ts';
import { EVERYDAY_MAX_BAND, EVERYDAY_WORDS, isEveryday } from './everyday.ts';

/** Names and places passages may use freely (the prompt asks for these only). */
export const STOCK_NAMES: ReadonlySet<string> = new Set([
	'Tom', 'Mary', 'John', 'Anna', 'Lan', 'Minh', 'Hoa', 'Nam', 'Mai', 'Linh', 'Huong', 'Tuan',
	'Vietnam', 'Vietnamese', 'Hanoi', 'Saigon', 'Hue', 'English', 'Tet'
]);

/** Inflected forms of the function verbs (the stoplist holds lemmas only). */
const FUNCTION_VERB_FORMS = new Set(['is', 'am', 'are', 'was', 'were', 'been', 'being', 'has', 'had', 'having', 'does', 'did', 'doing', 'done', 'gets', 'got', 'getting']);

/** Contractions whose first part is not a word on its own. */
const CONTRACTION_BASES: Record<string, string> = { "won't": 'will', "can't": 'can', "shan't": 'shall', "ain't": 'be' };

/** The word a token counts as: "don't" -> "do", "it's" -> "it", "Tom's" -> "Tom". */
function base(token: string): string {
	const lower = token.toLowerCase();
	if (lower in CONTRACTION_BASES) return CONTRACTION_BASES[lower];
	const apostrophe = token.indexOf("'");
	if (apostrophe <= 0) return token;
	const head = token.slice(0, apostrophe);
	return lower.endsWith("n't") && head.toLowerCase().endsWith('n') ? head.slice(0, -1) : head;
}

export interface Coverage {
	/** Word tokens counted. */
	total: number;
	covered: number;
	ratio: number;
	/** Distinct uncovered words, lowercase, in order of appearance. */
	uncovered: string[];
}

/**
 * The share of word tokens that are function words, stock names, have an NGSL lemma band of at
 * most `band + 1`, or (bands ≤ 4) are everyday concrete words (everyday.ts). Numbers and
 * punctuation are not counted. Off-list words count as uncovered.
 */
export function coverage(text: string, band: number, forms: FormIndex): Coverage {
	let total = 0;
	let covered = 0;
	const uncovered: string[] = [];
	for (const token of tokenize(text)) {
		if (token.kind !== 'word') continue;
		total++;
		const word = base(token.text);
		const lower = word.toLowerCase();
		const lemma = forms.lemmaOf.get(lower);
		const known =
			FUNCTION_WORDS.has(lower) ||
			FUNCTION_VERB_FORMS.has(lower) ||
			STOCK_NAMES.has(word) ||
			(lemma?.band ?? Infinity) <= band + 1 ||
			(band <= EVERYDAY_MAX_BAND && isEveryday(lower, lemma?.headword));
		if (known) covered++;
		else if (!uncovered.includes(lower)) uncovered.push(lower);
	}
	return { total, covered, ratio: total === 0 ? 0 : covered / total, uncovered };
}

/** Words for the word-count rule: word and number tokens. */
export const wordCount = (text: string) => tokenize(text).filter((t) => t.kind !== 'punct').length;

/** Most allowed words the passage prompt lists (frequency order). */
export const ALLOWED_WORDS_MAX = 1500;

/**
 * The content words a passage at `band` may use, for the prompt: NGSL lemmas of band ≤ band + 1
 * (function words left out, most frequent first, at most 1500), plus the everyday words for bands ≤ 4.
 */
export function allowedWords(band: number, forms: FormIndex, max = ALLOWED_WORDS_MAX): string[] {
	const lemmas = new Map<string, number>();
	for (const info of forms.lemmaOf.values()) {
		if (info.band <= band + 1 && !FUNCTION_WORDS.has(info.headword)) lemmas.set(info.headword, info.rank ?? Number.MAX_SAFE_INTEGER);
	}
	const ranked = [...lemmas].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([w]) => w);
	const everyday = band <= EVERYDAY_MAX_BAND ? [...EVERYDAY_WORDS].filter((w) => !lemmas.has(w)) : [];
	return [...ranked.slice(0, max), ...everyday];
}
