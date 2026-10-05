// Deterministic gap candidates from Tatoeba sentences (no LLM). See plans/phase-05a.md.
import type { CLOZE_GAP_TYPES, TOPIC_CODES } from '../../db/schema.ts';
import type { FormIndex, LemmaInfo } from '../forms.ts';
import { hashString, seededPick, seededShuffle, sha256 } from '../random.ts';
import { NO_WORD, type Token, capitalize, firstWordIndex, tokenize } from '../tokens.ts';
import { PREPOSITIONS, prepositionDistractors } from './prepositions.ts';
import { FUNCTION_WORDS } from './stoplist.ts';

export type GapType = (typeof CLOZE_GAP_TYPES)[number];
export type TopicCode = (typeof TOPIC_CODES)[number];

export const MIN_WORDS = 4;
export const MAX_WORDS = 15;
export const MAX_OFF_LIST = 2;
export const ARTICLES = ['a', 'an', 'the'] as const;

export interface SentenceInput {
	id: number;
	enText: string;
	viText: string;
	levelBand: number;
	offListCount: number;
	blocked: boolean;
}

export interface Candidate {
	sentenceId: number;
	enText: string;
	viText: string;
	gapType: GapType;
	tokenIndex: number;
	/** The token as it appears in the sentence. */
	answer: string;
	/** Fixed options for grammar gaps (answer included); null for lexical gaps (LLM distractors). */
	options: string[] | null;
	/** The gap is the sentence's first word: options are capitalized. */
	initial: boolean;
	lexemeId: number | null;
	topicCode: TopicCode | null;
	levelBand: number;
	contentHash: string;
}

export interface CandidateDeps {
	forms: FormIndex;
	/** Is this a real English word? (The word list or an NGSL headword; see rules.ts.) */
	isWord: (word: string) => boolean;
	/**
	 * Is this word used in the sentence corpus? Verb-form options must be, which drops the
	 * nonstandard forms NGSL lists ("sayed", "bein", "ain"). Default: every word counts.
	 */
	attested?: (word: string) => boolean;
}

/** Lowercase word tokens of a corpus, for `CandidateDeps.attested`. */
export function corpusWords(texts: Iterable<string>): Set<string> {
	const words = new Set<string>();
	for (const text of texts) for (const t of tokenize(text)) if (t.kind === 'word') words.add(t.text.toLowerCase());
	return words;
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function candidateHash(sentenceId: number, gapType: GapType, tokenIndex: number, answer: string): string {
	return sha256(`cloze|${sentenceId}|${gapType}|${tokenIndex}|${answer}`);
}

interface Context {
	sentence: SentenceInput;
	tokens: Token[];
	first: number;
	deps: CandidateDeps;
}

const isHyphen = (t: Token | undefined) => t !== undefined && (t.text === '-' || t.text === '–');

/**
 * Lowercase word token usable as a gap: plain letters, capitalized only sentence-initially, and
 * not part of a hyphenated compound ("sister-in-law").
 */
function gapWord(ctx: Context, i: number): string | null {
	const token = ctx.tokens[i];
	if (token.kind !== 'word' || token.text.includes("'")) return null;
	if (isHyphen(ctx.tokens[i - 1]) || isHyphen(ctx.tokens[i + 1])) return null;
	const isLower = token.text === token.text.toLowerCase();
	const isInitialCap = i === ctx.first && token.text === capitalize(token.text.toLowerCase());
	if (!isLower && !isInitialCap) return null;
	return token.text.toLowerCase();
}

function occursElsewhere(ctx: Context, i: number, word: string): boolean {
	return ctx.tokens.some((t, j) => j !== i && t.text.toLowerCase() === word);
}

function make(ctx: Context, gapType: GapType, i: number, fields: Partial<Candidate>): Candidate {
	const answer = ctx.tokens[i].text;
	return {
		sentenceId: ctx.sentence.id,
		enText: ctx.sentence.enText,
		viText: ctx.sentence.viText,
		gapType,
		tokenIndex: i,
		answer,
		options: null,
		initial: i === ctx.first,
		lexemeId: null,
		topicCode: null,
		levelBand: ctx.sentence.levelBand,
		contentHash: candidateHash(ctx.sentence.id, gapType, i, answer),
		...fields
	};
}

const caseLike = (initial: boolean, words: string[]) => (initial ? words.map(capitalize) : words);

/** A content word whose lemma is in NGSL (not a function word), preferring the highest band <= sentence band + 1. */
export function lexicalCandidate(ctx: Context): Candidate | null {
	const options: { i: number; lemma: LemmaInfo }[] = [];
	ctx.tokens.forEach((_, i) => {
		const word = gapWord(ctx, i);
		if (word === null || word.length < 2) return;
		const lemma = ctx.deps.forms.lemmaOf.get(word);
		if (lemma === undefined || FUNCTION_WORDS.has(lemma.headword) || FUNCTION_WORDS.has(word)) return;
		if (lemma.band > ctx.sentence.levelBand + 1 || occursElsewhere(ctx, i, word)) return;
		options.push({ i, lemma });
	});
	if (options.length === 0) return null;
	const top = Math.max(...options.map((o) => o.lemma.band));
	const best = seededPick(
		options.filter((o) => o.lemma.band === top),
		`lexical|${ctx.sentence.id}`
	)!;
	return make(ctx, 'lexical', best.i, {
		lexemeId: best.lemma.lexemeId,
		levelBand: Math.max(ctx.sentence.levelBand, best.lemma.band)
	});
}

function articleCandidates(ctx: Context): Candidate[] {
	return ctx.tokens.flatMap((_, i) => {
		const word = gapWord(ctx, i);
		if (word === null || !(ARTICLES as readonly string[]).includes(word)) return [];
		const next = ctx.tokens[i + 1];
		if (next === undefined || next.kind !== 'word') return [];
		return [make(ctx, 'article', i, { topicCode: 'ART', options: caseLike(i === ctx.first, [...ARTICLES, NO_WORD]) })];
	});
}

/** "to" before a verb's base form is the infinitive marker, not a preposition ("want to see"). */
function isInfinitiveTo(ctx: Context, i: number): boolean {
	const next = ctx.tokens[i + 1];
	if (next === undefined || next.kind !== 'word') return false;
	const word = next.text.toLowerCase();
	const lemma = ctx.deps.forms.lemmaOf.get(word);
	return lemma !== undefined && lemma.headword === word && (ctx.deps.forms.formsOf.get(word) ?? []).some((f) => f.endsWith('ing'));
}

function prepositionCandidates(ctx: Context): Candidate[] {
	return ctx.tokens.flatMap((_, i) => {
		const word = gapWord(ctx, i);
		if (word === null || !PREPOSITIONS.has(word) || occursElsewhere(ctx, i, word)) return [];
		if (word === 'to' && isInfinitiveTo(ctx, i)) return [];
		const distractors = prepositionDistractors(word).slice(0, 3);
		return [make(ctx, 'preposition', i, { topicCode: 'PRE', options: caseLike(i === ctx.first, [word, ...distractors]) })];
	});
}

/** Modal verbs: choosing between them is not a verb-form question. */
const MODALS = new Set(['can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'ought', 'cannot']);
/** A word before the gap that makes it a noun ("broke the rules"), not a verb. */
const DETERMINERS = new Set([
	'a', 'an', 'the', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that', 'these', 'those',
	'some', 'any', 'every', 'each', 'no', 'many', 'much', 'few', 'several', 'all', 'both', 'another', 'other'
]);
/** Adverbs skipped when looking back from the gap for its subject ("he always does"). */
const ADVERBS = new Set([
	'always', 'never', 'often', 'also', 'just', 'really', 'still', 'usually', 'sometimes', 'only', 'even',
	'already', 'rarely', 'seldom', 'hardly', 'certainly', 'probably', 'actually', 'finally', 'generally'
]);
/** Words before the gap that rule out a finite present-simple verb. */
const NOT_SUBJECT = new Set([...MODALS, 'to', 'do', 'does', 'did', 'not', 'and', 'or', 'but', 'of', 'for', 'with', 'by', 'at', 'in', 'on', 'from']);
const NOT_THIRD_PERSON = new Set(['i', 'you', 'we']);
const PRESENT_FINITE = new Set(['is', 'are', 'am', 'has', 'have', 'does', 'do']);
/** Informal spellings NGSL lists as forms; never offered as options. */
const INFORMAL = new Set(['gonna', 'gotta', 'wanna', 'gimme', 'lemme', 'dunno', 'ain', 'innit']);

/** "likes", "watches", "tries": the third-person singular -s form of `headword`. */
const isThirdSingular = (word: string, headword: string) =>
	word === `${headword}s` || word === `${headword}es` || (headword.endsWith('y') && word === `${headword.slice(0, -1)}ies`);

/** Real, used inflections of a lemma usable as verb-form options (no "goings", no "sayed"). */
export function verbForms(lemma: string, deps: CandidateDeps): string[] {
	const forms = deps.forms.formsOf.get(lemma) ?? [];
	const attested = deps.attested ?? (() => true);
	return forms.filter((f) => !f.endsWith('ings') && !INFORMAL.has(f) && deps.isWord(f) && attested(f));
}

/** A verb: at least four real forms, one of them an -ing form. */
function looksLikeVerb(lemma: string, deps: CandidateDeps): boolean {
	const forms = verbForms(lemma, deps);
	return forms.length >= 4 && forms.some((f) => f.endsWith('ing'));
}

/**
 * SVA when the gap is present simple after a third-person subject, else TNS. The subject is the
 * word before the gap, skipping adverbs; a modal, "to" or an auxiliary there means no finite verb.
 */
export function verbTopic(tokens: readonly Token[], i: number, word: string, headword: string): TopicCode {
	let j = i - 1;
	while (j >= 0 && tokens[j].kind === 'word' && ADVERBS.has(tokens[j].text.toLowerCase())) j--;
	const subject = tokens[j];
	if (subject === undefined || subject.kind !== 'word') return 'TNS';
	const lower = subject.text.toLowerCase();
	if (NOT_SUBJECT.has(lower) || lower.endsWith("n't")) return 'TNS';
	const present = PRESENT_FINITE.has(word) || isThirdSingular(word, headword) || word === headword;
	return present && !NOT_THIRD_PERSON.has(lower) ? 'SVA' : 'TNS';
}

function verbFormCandidates(ctx: Context): Candidate[] {
	return ctx.tokens.flatMap((_, i) => {
		const word = gapWord(ctx, i);
		if (word === null || i === ctx.first) return [];
		const lemma = ctx.deps.forms.lemmaOf.get(word);
		if (lemma === undefined || MODALS.has(lemma.headword) || occursElsewhere(ctx, i, word)) return [];
		const prev = ctx.tokens[i - 1];
		if (prev !== undefined && DETERMINERS.has(prev.text.toLowerCase())) return [];
		const forms = verbForms(lemma.headword, ctx.deps);
		if (!looksLikeVerb(lemma.headword, ctx.deps) || !forms.includes(word)) return [];
		const others = seededShuffle(
			forms.filter((f) => f !== word),
			`verb|${ctx.sentence.id}|${i}`
		).slice(0, 3);
		return [
			make(ctx, 'verb_form', i, {
				topicCode: verbTopic(ctx.tokens, i, word, lemma.headword),
				options: [word, ...others]
			})
		];
	});
}

/** The order grammar gap types are tried in, rotated per sentence so types spread evenly. */
const GRAMMAR_TYPES: GapType[] = ['article', 'preposition', 'verb_form'];

export interface SentenceCandidates {
	lexical: Candidate | null;
	article: Candidate[];
	preposition: Candidate[];
	verb_form: Candidate[];
}

/** Every possible gap of an eligible sentence, by type (null if the sentence is not eligible). */
export function allCandidates(sentence: SentenceInput, deps: CandidateDeps): SentenceCandidates | null {
	if (sentence.blocked || sentence.offListCount > MAX_OFF_LIST) return null;
	const words = wordCount(sentence.enText);
	if (words < MIN_WORDS || words > MAX_WORDS) return null;
	const tokens = tokenize(sentence.enText);
	const ctx: Context = { sentence, tokens, first: firstWordIndex(tokens), deps };
	return {
		lexical: lexicalCandidate(ctx),
		article: articleCandidates(ctx),
		preposition: prepositionCandidates(ctx),
		verb_form: verbFormCandidates(ctx)
	};
}

/**
 * At most one lexical and one grammar candidate for a sentence (deterministic). The grammar type
 * is the first with a candidate in a per-sentence rotation, so types spread evenly; it never
 * gaps the same token as the lexical candidate.
 */
export function sentenceCandidates(sentence: SentenceInput, deps: CandidateDeps): Candidate[] {
	const all = allCandidates(sentence, deps);
	if (all === null) return [];
	const { lexical } = all;
	const out: Candidate[] = lexical === null ? [] : [lexical];
	const start = hashString(`grammar|${sentence.id}`) % GRAMMAR_TYPES.length;
	for (let k = 0; k < GRAMMAR_TYPES.length; k++) {
		const type = GRAMMAR_TYPES[(start + k) % GRAMMAR_TYPES.length] as Exclude<GapType, 'lexical'>;
		const pool = all[type].filter((c) => c.tokenIndex !== lexical?.tokenIndex);
		const pick = seededPick(pool, `grammar|${sentence.id}|${k}`);
		if (pick !== undefined) {
			out.push(pick);
			break;
		}
	}
	return out;
}

export interface SelectOptions {
	limit: number;
	bands?: [number, number];
	types?: readonly GapType[];
	/** Candidates to leave out (e.g. content hashes already stored). */
	exclude?: ReadonlySet<string>;
}

/**
 * Pick up to `limit` candidates, spread across gap types and bands: candidates are bucketed by
 * (type, band), each bucket in a stable hash order, then taken round-robin.
 */
export function selectCandidates(all: readonly Candidate[], options: SelectOptions): Candidate[] {
	const [lo, hi] = options.bands ?? [1, 8];
	const types = options.types ?? (['lexical', 'article', 'preposition', 'verb_form'] as const);
	const buckets = new Map<string, Candidate[]>();
	for (const c of all) {
		if (c.levelBand < lo || c.levelBand > hi || !types.includes(c.gapType) || options.exclude?.has(c.contentHash)) continue;
		const key = `${types.indexOf(c.gapType)}|${String(c.levelBand).padStart(2, '0')}`;
		const bucket = buckets.get(key) ?? [];
		bucket.push(c);
		buckets.set(key, bucket);
	}
	const queues = [...buckets.keys()]
		.sort()
		.map((k) => buckets.get(k)!.sort((a, b) => a.contentHash.localeCompare(b.contentHash)));
	const out: Candidate[] = [];
	for (let round = 0; out.length < options.limit && queues.some((q) => q.length > round); round++) {
		for (const queue of queues) {
			if (out.length >= options.limit) break;
			if (queue[round] !== undefined) out.push(queue[round]);
		}
	}
	return out;
}
