// Word classes the drill injections need. NGSL 1.2 ships no part-of-speech tags (pos is null for
// every headword), so classes are inferred from the form map plus evidence in the sentence corpus.
// They only need to be right often enough: the blind critic rejects drills built on a wrong guess.
import type { FormIndex } from '../forms.ts';
import { tokenize } from '../tokens.ts';
import { FUNCTION_WORDS } from '../cloze/stoplist.ts';

export interface WordClasses {
	/** Singular nouns seen after "a"/"an" and closing their noun phrase ("a dog.", "a dog in ..."). */
	countableNouns: ReadonlySet<string>;
	/** Words seen after an intensifier ("very tired") or with -er/-est forms ("big"). */
	adjectives: ReadonlySet<string>;
	/** Inflected verb forms seen right after a subject pronoun ("I went", "she saw"): simple pasts. */
	pastForms: ReadonlySet<string>;
}

const INTENSIFIERS = new Set(['very', 'too', 'so', 'really', 'quite', 'extremely', 'pretty']);
const SUBJECT_PRONOUNS = new Set(['i', 'you', 'he', 'she', 'we', 'they', 'it']);
/** Words an intensifier can precede that are not adjectives. */
const NOT_ADJECTIVES = new Set(['going', 'coming', 'doing', 'getting', 'well', 'often', 'far', 'fast', 'hard', 'long', 'soon', 'late', 'early', 'badly']);

/** "dogs" for "dog", "boxes" for "box", "cities" for "city". */
export function isRegularPlural(word: string, singular: string): boolean {
	return (
		word === `${singular}s` ||
		word === `${singular}es` ||
		(singular.endsWith('y') && word === `${singular.slice(0, -1)}ies`)
	);
}

/** Irregular plurals common enough for PLU drills (plural -> singular). */
export const IRREGULAR_PLURALS: ReadonlyMap<string, string> = new Map([
	['children', 'child'],
	['men', 'man'],
	['women', 'woman'],
	['people', 'person'],
	['feet', 'foot'],
	['teeth', 'tooth'],
	['mice', 'mouse'],
	['wives', 'wife'],
	['knives', 'knife'],
	['lives', 'life'],
	['leaves', 'leaf']
]);

/** Lemmas whose inflected forms are not simple pasts worth a TNS drill (modals, "be"). */
const NOT_PAST_LEMMAS = new Set(['be', 'can', 'will', 'shall', 'may', 'must']);

const hasComparative = (headword: string, forms: readonly string[]) =>
	forms.some((f) => f.endsWith('est') && f !== headword) && forms.some((f) => f.endsWith('er') && f !== headword);

/** Real inflected forms of a lemma that behave like a verb (has an -ing form and a past). */
export function isVerbLemma(headword: string, forms: FormIndex): boolean {
	const all = forms.formsOf.get(headword) ?? [];
	return all.some((f) => f === `${headword}ing` || f.endsWith('ing')) && all.length >= 3;
}

export function buildWordClasses(forms: FormIndex, corpus: Iterable<string>): WordClasses {
	const afterArticle = new Map<string, number>();
	const afterIntensifier = new Map<string, number>();
	const afterPronoun = new Set<string>();
	const bump = (map: Map<string, number>, word: string) => map.set(word, (map.get(word) ?? 0) + 1);
	for (const text of corpus) {
		const tokens = tokenize(text);
		tokens.forEach((token, i) => {
			if (token.kind !== 'word' || i === 0) return;
			const word = token.text.toLowerCase();
			const prev = tokens[i - 1].text.toLowerCase();
			const next = tokens[i + 1];
			const closes = next === undefined || next.kind !== 'word' || FUNCTION_WORDS.has(next.text.toLowerCase());
			if ((prev === 'a' || prev === 'an') && closes) bump(afterArticle, word);
			if (INTENSIFIERS.has(prev) && closes) bump(afterIntensifier, word);
			if (SUBJECT_PRONOUNS.has(prev)) afterPronoun.add(word);
		});
	}

	const adjectives = new Set<string>();
	for (const [headword, all] of forms.formsOf) {
		if (hasComparative(headword, all) && !NOT_ADJECTIVES.has(headword)) adjectives.add(headword);
	}
	for (const [word, n] of afterIntensifier) {
		// -ing forms need more evidence: "very interesting" is an adjective, "is going" is not.
		const needed = word.endsWith('ing') ? 4 : 2;
		if (n >= needed && !word.endsWith('ly') && !FUNCTION_WORDS.has(word) && !NOT_ADJECTIVES.has(word)) adjectives.add(word);
	}

	const countableNouns = new Set<string>();
	for (const word of afterArticle.keys()) {
		const lemma = forms.lemmaOf.get(word);
		if (lemma === undefined || lemma.headword !== word || FUNCTION_WORDS.has(word) || adjectives.has(word)) continue;
		const all = forms.formsOf.get(word) ?? [];
		if (all.some((f) => isRegularPlural(f, word))) countableNouns.add(word);
	}
	for (const singular of IRREGULAR_PLURALS.values()) countableNouns.add(singular);

	const pastForms = new Set<string>();
	for (const word of afterPronoun) {
		const lemma = forms.lemmaOf.get(word);
		if (lemma === undefined || lemma.headword === word || NOT_PAST_LEMMAS.has(lemma.headword)) continue;
		if (word.endsWith('ing') || word.endsWith('s') || !isVerbLemma(lemma.headword, forms)) continue;
		pastForms.add(word);
	}
	return { countableNouns, adjectives, pastForms };
}
