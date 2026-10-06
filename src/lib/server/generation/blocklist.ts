// Content blocklist: sentences matching it are imported but marked blocked (never deleted).
import type { FormIndex } from './forms.ts';
import { tokenize } from './tokens.ts';

export interface Blocklist {
	/** Exact words; NGSL headwords are expanded to all their forms. */
	words: Set<string>;
	/** Entries written `prefix*`. */
	prefixes: string[];
	/** Entries of several words ("make love"), matched as consecutive words, each by lemma. */
	phrases: string[][];
}

/**
 * One term per line; `#` comments; `word*` matches any word starting with `word`; a line of
 * several words is a phrase ("make love" also matches "made love").
 */
export function parseBlocklist(raw: string): Blocklist {
	const words = new Set<string>();
	const prefixes: string[] = [];
	const phrases: string[][] = [];
	for (const line of raw.split(/\r?\n/)) {
		const term = line.replace(/#.*/, '').trim().toLowerCase().replace(/\s+/g, ' ');
		if (term === '') continue;
		if (term.includes(' ')) phrases.push(term.split(' '));
		else if (term.endsWith('*')) prefixes.push(term.slice(0, -1));
		else words.add(term);
	}
	return { words, prefixes, phrases };
}

export interface BlocklistMatcher {
	/** The blocklist term a sentence matches, or null. */
	match(text: string): string | null;
	/** Whether a single word is blocked. */
	isBlocked(word: string): boolean;
}

/**
 * Matching works on lemmas where the NGSL form map knows the word ("killed" -> "kill"), and on
 * the word itself otherwise. Each match reports the blocklist term that caused it.
 */
export function blocklistMatcher(list: Blocklist, forms: FormIndex): BlocklistMatcher {
	const termFor = (word: string): string | null => {
		const lower = word.toLowerCase();
		if (list.words.has(lower)) return lower;
		const lemma = forms.lemmaOf.get(lower)?.headword;
		if (lemma !== undefined && list.words.has(lemma)) return lemma;
		const prefix = list.prefixes.find((p) => lower.startsWith(p));
		return prefix === undefined ? null : `${prefix}*`;
	};
	const same = (word: string, target: string) => word === target || (forms.lemmaOf.get(word)?.headword ?? word) === target;
	return {
		match(text) {
			const words = tokenize(text)
				.filter((t) => t.kind === 'word')
				.map((t) => t.text.toLowerCase());
			for (const word of words) {
				const term = termFor(word);
				if (term !== null) return term;
			}
			for (const phrase of list.phrases) {
				if (words.some((_, i) => phrase.every((p, k) => words[i + k] !== undefined && same(words[i + k], p)))) return phrase.join(' ');
			}
			return null;
		},
		isBlocked: (word) => termFor(word) !== null
	};
}
