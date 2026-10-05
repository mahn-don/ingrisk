// Comprehensible input: how much of a text a learner at a band already knows.
import { FUNCTION_WORDS } from '../cloze/stoplist.ts';
import type { FormIndex } from '../forms.ts';
import { tokenize } from '../tokens.ts';

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
 * The share of word tokens that are function words, stock names, or have an NGSL lemma band of at
 * most `band + 1`. Numbers and punctuation are not counted. Off-list words count as uncovered.
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
		const known =
			FUNCTION_WORDS.has(lower) ||
			FUNCTION_VERB_FORMS.has(lower) ||
			STOCK_NAMES.has(word) ||
			(forms.lemmaOf.get(lower)?.band ?? Infinity) <= band + 1;
		if (known) covered++;
		else if (!uncovered.includes(lower)) uncovered.push(lower);
	}
	return { total, covered, ratio: total === 0 ? 0 : covered / total, uncovered };
}

/** Words for the word-count rule: word and number tokens. */
export const wordCount = (text: string) => tokenize(text).filter((t) => t.kind !== 'punct').length;
