// Deterministic checks for graded reading passages.
import type { Response as Passage } from '../../llm/prompts/reading-passage.ts';
import type { BlocklistMatcher } from '../blocklist.ts';
import type { FormIndex } from '../forms.ts';
import { tokenize } from '../tokens.ts';
import { coverage, wordCount } from './coverage.ts';

/** Target passage length (words) per band. */
export function wordRange(band: number): [number, number] {
	if (band <= 2) return [60, 90];
	if (band <= 4) return [90, 130];
	if (band <= 6) return [130, 170];
	return [170, 220];
}

export const MIN_COVERAGE = 0.95;

export type ReadingRuleCode = 'word_count' | 'coverage' | 'glossary_missing' | 'options_duplicate' | 'blocklisted';
export type ReadingRuleResult = { ok: true } | { ok: false; code: ReadingRuleCode; detail: string };

const fail = (code: ReadingRuleCode, detail: string): ReadingRuleResult => ({ ok: false, code, detail });
export const readingRuleReason = (r: Extract<ReadingRuleResult, { ok: false }>) => `rule:${r.code} (${r.detail})`;

export interface ReadingRuleDeps {
	forms: FormIndex;
	blocklist: Pick<BlocklistMatcher, 'match'>;
}

/** Does `word` (one or more words) appear in the passage, as written or as another form of its lemma? */
export function inPassage(word: string, passage: string, forms: FormIndex): boolean {
	const lemma = (w: string) => forms.lemmaOf.get(w)?.headword ?? w;
	const target = tokenize(word).filter((t) => t.kind === 'word').map((t) => t.text.toLowerCase());
	const text = tokenize(passage).filter((t) => t.kind === 'word').map((t) => t.text.toLowerCase());
	if (target.length === 0) return false;
	return text.some((_, i) => target.every((w, k) => text[i + k] !== undefined && (text[i + k] === w || lemma(text[i + k]) === lemma(w))));
}

export function checkPassage(passage: Passage, band: number, deps: ReadingRuleDeps): ReadingRuleResult {
	const [min, max] = wordRange(band);
	const words = wordCount(passage.passage_en);
	if (words < min || words > max) return fail('word_count', `${words} words, wanted ${min}-${max}`);
	const cov = coverage(passage.passage_en, band, deps.forms);
	if (cov.ratio < MIN_COVERAGE) {
		return fail('coverage', `${(cov.ratio * 100).toFixed(1)}%; above band: ${cov.uncovered.slice(0, 8).join(', ')}`);
	}
	const missing = passage.glossary.find((g) => !inPassage(g.word, passage.passage_en, deps.forms));
	if (missing !== undefined) return fail('glossary_missing', missing.word);
	for (const [i, q] of passage.questions.entries()) {
		const lowered = q.options.map((o) => o.trim().toLowerCase());
		if (new Set(lowered).size !== lowered.length) return fail('options_duplicate', `question ${i + 1}`);
	}
	const texts = [passage.title_en, passage.passage_en, ...passage.questions.flatMap((q) => [q.question_en, ...q.options])];
	for (const text of texts) {
		const blocked = deps.blocklist.match(text);
		if (blocked !== null) return fail('blocklisted', blocked);
	}
	return { ok: true };
}
