// Deterministic error injection: a correct Tatoeba sentence in, one L1-typical error out.
// Each code has its own detector; a sentence can offer several sites, one is picked by seed.
import type { TOPIC_CODES } from '../../db/schema.ts';
import { FUNCTION_WORDS } from '../cloze/stoplist.ts';
import { PREPOSITIONS, prepositionDistractors } from '../cloze/prepositions.ts';
import type { FormIndex } from '../forms.ts';
import { seededPick } from '../random.ts';
import { NO_WORD, type Token, capitalize, fillGap, firstWordIndex, tokenize } from '../tokens.ts';
import { IRREGULAR_PLURALS, type WordClasses, isRegularPlural, isVerbLemma } from './word-classes.ts';

export type TopicCode = (typeof TOPIC_CODES)[number];

/** Codes drilled from Tatoeba sentences by injection; COL, WFM and WOR are written by the LLM. */
export const INJECTED_CODES = ['ART', 'PLU', 'SVA', 'COP', 'TNS', 'PRE'] as const;
export type InjectedCode = (typeof INJECTED_CODES)[number];

export interface InjectionDeps {
	forms: FormIndex;
	classes: WordClasses;
}

export interface Injection {
	topic: InjectedCode;
	tokenIndex: number;
	/** The token's replacement; NO_WORD deletes it. */
	replacement: string;
}

export interface InjectedSentence {
	sentenceWithError: string;
	corrected: string;
	injection: Injection;
}

interface Ctx {
	tokens: Token[];
	lower: string[];
	first: number;
	deps: InjectionDeps;
}

const isWord = (t: Token | undefined) => t !== undefined && t.kind === 'word';
/** Keep the original token's initial capital. */
const sameCase = (original: string, replacement: string) =>
	/^[A-Z]/.test(original) && replacement !== NO_WORD ? capitalize(replacement) : replacement;

const DETERMINERS = new Set(['the', 'a', 'an', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that']);

// --- ART: delete an article before a singular countable noun, or swap a <-> an --------------------

function art(ctx: Ctx): Injection[] {
	const out: Injection[] = [];
	ctx.lower.forEach((word, i) => {
		const next = ctx.tokens[i + 1];
		if (!isWord(next)) return;
		const noun = ctx.lower[i + 1];
		if (word === 'a' || word === 'an') {
			if (noun === 'few' || noun === 'little') return; // "a few" -> "few" changes meaning, no error
			if (ctx.deps.classes.countableNouns.has(noun)) out.push({ topic: 'ART', tokenIndex: i, replacement: NO_WORD });
			out.push({ topic: 'ART', tokenIndex: i, replacement: sameCase(ctx.tokens[i].text, word === 'a' ? 'an' : 'a') });
		} else if (word === 'the' && ctx.deps.classes.countableNouns.has(noun)) {
			// Only when the noun closes the phrase ("the bus stop": "bus" is a modifier).
			const after = ctx.tokens[i + 2];
			if (isWord(after) && !FUNCTION_WORDS.has(ctx.lower[i + 2])) return;
			out.push({ topic: 'ART', tokenIndex: i, replacement: NO_WORD });
		}
	});
	return out;
}

// --- PLU: a plural noun after a number or quantifier becomes singular ----------------------------

const NUMBER_WORDS = [
	'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
	'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty',
	'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand'
];
const QUANTIFIERS = new Set([...NUMBER_WORDS, 'many', 'several', 'few', 'both', 'these', 'those']);

function singularOf(word: string, deps: InjectionDeps): string | undefined {
	const irregular = IRREGULAR_PLURALS.get(word);
	if (irregular !== undefined) return irregular;
	const headword = deps.forms.lemmaOf.get(word)?.headword;
	if (headword === undefined || headword === word || !isRegularPlural(word, headword)) return undefined;
	return deps.classes.countableNouns.has(headword) ? headword : undefined;
}

function plu(ctx: Ctx): Injection[] {
	return ctx.tokens.flatMap((token, i) => {
		const prev = ctx.tokens[i - 1];
		if (token.kind !== 'word' || prev === undefined) return [];
		const quantity = prev.kind === 'number' ? Number(prev.text.replace(/,/g, '')) > 1 : QUANTIFIERS.has(ctx.lower[i - 1]);
		if (!quantity) return [];
		const singular = singularOf(ctx.lower[i], ctx.deps);
		return singular === undefined ? [] : [{ topic: 'PLU' as const, tokenIndex: i, replacement: singular }];
	});
}

// --- SVA: a third-person present verb becomes its base form --------------------------------------

const THIRD_PERSON_PRONOUNS = new Set(['he', 'she', 'it']);
const ADVERBS = new Set(['always', 'never', 'often', 'also', 'just', 'really', 'still', 'usually', 'sometimes', 'only', 'even', 'already', 'rarely', 'seldom', 'hardly', 'probably', 'actually', 'finally', 'generally']);
const IRREGULAR_THIRD = new Map([
	['has', 'have'],
	['does', 'do']
]);

/** Is the word before `i` (skipping adverbs) a third-person singular subject? */
function thirdPersonSubject(ctx: Ctx, i: number): boolean {
	let j = i - 1;
	while (j >= 0 && ADVERBS.has(ctx.lower[j])) j--;
	const subject = ctx.tokens[j];
	if (!isWord(subject)) return false;
	const word = ctx.lower[j];
	if (THIRD_PERSON_PRONOUNS.has(word)) return true;
	// A name: capitalized and not a common word (sentence-initial "Then" is not a name).
	if (/^[A-Z][a-z]+$/.test(subject.text) && !FUNCTION_WORDS.has(word) && (j !== ctx.first || !ctx.deps.forms.lemmaOf.has(word))) {
		return true;
	}
	// "my father", "the dog": a singular countable noun right after a determiner.
	return ctx.deps.classes.countableNouns.has(word) && DETERMINERS.has(ctx.lower[j - 1] ?? '');
}

function sva(ctx: Ctx): Injection[] {
	return ctx.tokens.flatMap((token, i) => {
		if (token.kind !== 'word' || i === ctx.first) return [];
		const word = ctx.lower[i];
		let base = IRREGULAR_THIRD.get(word);
		if (base === undefined) {
			const headword = ctx.deps.forms.lemmaOf.get(word)?.headword;
			if (headword === undefined || headword === 'be' || !isVerbLemma(headword, ctx.deps.forms)) return [];
			if (!(word === `${headword}s` || word === `${headword}es` || (headword.endsWith('y') && word === `${headword.slice(0, -1)}ies`))) {
				return [];
			}
			base = headword;
		}
		return thirdPersonSubject(ctx, i) ? [{ topic: 'SVA' as const, tokenIndex: i, replacement: base }] : [];
	});
}

// --- COP: delete is / are / am before an adjective -----------------------------------------------

/** Subjects of "is/are/am" that make deleting the copula a Vietnamese-typical error. */
const COPULA_SUBJECT_PRONOUNS = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'this', 'that', 'these', 'those']);
const COPULA_SKIPPABLE = new Set(['very', 'so', 'too', 'really', 'quite', 'not', 'always', 'still', 'also', 'extremely']);
const AFTER_ADJECTIVE = new Set(['and', 'but', 'to', 'of', 'about', 'at', 'with', 'for', 'in', 'because', 'now', 'today', 'too', 'again', 'here', 'there', 'enough', 'that']);

function cop(ctx: Ctx): Injection[] {
	return ctx.tokens.flatMap((token, i) => {
		if (!['is', 'are', 'am'].includes(token.text) || i === ctx.first) return [];
		const subject = ctx.lower[i - 1];
		const subjectOk =
			COPULA_SUBJECT_PRONOUNS.has(subject) ||
			(isWord(ctx.tokens[i - 1]) && !FUNCTION_WORDS.has(subject) && /^[A-Za-z]+$/.test(ctx.tokens[i - 1].text));
		if (!subjectOk) return [];
		let j = i + 1;
		while (j < i + 3 && COPULA_SKIPPABLE.has(ctx.lower[j] ?? '')) j++;
		if (!ctx.deps.classes.adjectives.has(ctx.lower[j] ?? '')) return [];
		const after = ctx.tokens[j + 1];
		if (isWord(after) && !AFTER_ADJECTIVE.has(ctx.lower[j + 1])) return []; // "is good food": not a predicate
		return [{ topic: 'COP' as const, tokenIndex: i, replacement: NO_WORD }];
	});
}

// --- TNS: a past-tense verb next to a time marker becomes its base form --------------------------

const LAST_NOUNS = new Set(['night', 'week', 'month', 'year', 'summer', 'winter', 'spring', 'autumn', 'fall', 'weekend', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'time']);
const AUXILIARIES = new Set(['have', 'has', 'had', 'be', 'is', 'are', 'am', 'was', 'were', 'been', 'being', 'get', 'got', 'gets', 'to']);

/** The sentence says when: "yesterday", "... ago", or "last week" (not "the last time"). */
export function hasTimeMarker(lower: readonly string[]): boolean {
	return lower.some(
		(word, i) =>
			word === 'yesterday' ||
			word === 'ago' ||
			(word === 'last' && LAST_NOUNS.has(lower[i + 1] ?? '') && !DETERMINERS.has(lower[i - 1] ?? ''))
	);
}

function tns(ctx: Ctx): Injection[] {
	if (!hasTimeMarker(ctx.lower)) return [];
	return ctx.tokens.flatMap((token, i) => {
		const word = ctx.lower[i];
		if (token.kind !== 'word' || i === ctx.first || !ctx.deps.classes.pastForms.has(word)) return [];
		const prev = ctx.lower[i - 1] ?? '';
		if (AUXILIARIES.has(prev) || DETERMINERS.has(prev)) return [];
		const headword = ctx.deps.forms.lemmaOf.get(word)?.headword;
		return headword === undefined ? [] : [{ topic: 'TNS' as const, tokenIndex: i, replacement: headword }];
	});
}

// --- PRE: swap a preposition using the confusion table -------------------------------------------

function pre(ctx: Ctx, seed: string): Injection[] {
	return ctx.tokens.flatMap((token, i) => {
		const word = ctx.lower[i];
		if (token.kind !== 'word' || !PREPOSITIONS.has(word)) return [];
		if (word === 'to') {
			// "to" before a verb's base form is the infinitive marker.
			const next = ctx.lower[i + 1] ?? '';
			const lemma = ctx.deps.forms.lemmaOf.get(next);
			if (lemma !== undefined && lemma.headword === next && isVerbLemma(next, ctx.deps.forms)) return [];
		}
		const swap = seededPick(prepositionDistractors(word), `pre|${seed}|${i}`);
		return swap === undefined ? [] : [{ topic: 'PRE' as const, tokenIndex: i, replacement: sameCase(token.text, swap) }];
	});
}

const DETECTORS: Record<InjectedCode, (ctx: Ctx, seed: string) => Injection[]> = {
	ART: art,
	PLU: plu,
	SVA: sva,
	COP: cop,
	TNS: tns,
	PRE: pre
};

/** Every place in `text` where an error of `topic` can be injected. */
export function injectionSites(text: string, topic: InjectedCode, deps: InjectionDeps, seed = text): Injection[] {
	const tokens = tokenize(text);
	const ctx: Ctx = { tokens, lower: tokens.map((t) => t.text.toLowerCase()), first: firstWordIndex(tokens), deps };
	return DETECTORS[topic](ctx, seed);
}

/**
 * One injected error of `topic` (the site chosen by seed), or null if the sentence offers none.
 * ART prefers deleting an article (the typical Vietnamese error) over swapping a/an.
 */
export function inject(text: string, topic: InjectedCode, deps: InjectionDeps, seed = text): InjectedSentence | null {
	const sites = injectionSites(text, topic, deps, seed);
	const deletions = topic === 'ART' ? sites.filter((s) => s.replacement === NO_WORD) : [];
	const injection = seededPick(deletions.length > 0 ? deletions : sites, `inject|${topic}|${seed}`);
	if (injection === undefined) return null;
	const sentenceWithError = fillGap(text, tokenize(text), injection.tokenIndex, injection.replacement);
	return sentenceWithError === text ? null : { sentenceWithError, corrected: text, injection };
}
