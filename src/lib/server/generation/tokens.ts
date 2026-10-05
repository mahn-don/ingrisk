// Tokenizing English sentences for cloze gaps, and filling a gap with an option.

export interface Token {
	text: string;
	start: number;
	end: number;
	kind: 'word' | 'number' | 'punct';
}

/** Option meaning "no word here" (article gaps). */
export const NO_WORD = '—';

const TOKEN = /[A-Za-z]+(?:'[A-Za-z]+)*|\d+(?:[.,]\d+)*|[^\sA-Za-z\d]/g;

/** Words (with inner apostrophes), numbers and single punctuation marks, with offsets. */
export function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	for (const match of text.matchAll(TOKEN)) {
		const value = match[0];
		const kind = /^[A-Za-z]/.test(value) ? 'word' : /^\d/.test(value) ? 'number' : 'punct';
		tokens.push({ text: value, start: match.index ?? 0, end: (match.index ?? 0) + value.length, kind });
	}
	return tokens;
}

/** Index of the first word token (the sentence-initial word), or -1. */
export function firstWordIndex(tokens: readonly Token[]): number {
	return tokens.findIndex((t) => t.kind === 'word');
}

export const capitalize = (word: string) => (word === NO_WORD ? word : word.charAt(0).toUpperCase() + word.slice(1));

/** The sentence with the token at `index` replaced by `___`. */
export function withGap(text: string, tokens: readonly Token[], index: number, gap = '___'): string {
	const token = tokens[index];
	return text.slice(0, token.start) + gap + text.slice(token.end);
}

/**
 * The sentence with the gap filled by `option`. NO_WORD removes the token and one adjoining
 * space; if the removed word started the sentence, the next word is capitalized.
 */
export function fillGap(text: string, tokens: readonly Token[], index: number, option: string): string {
	const token = tokens[index];
	if (option !== NO_WORD) return text.slice(0, token.start) + option + text.slice(token.end);
	let end = token.end;
	let start = token.start;
	if (text[end] === ' ') end++;
	else if (start > 0 && text[start - 1] === ' ') start--;
	const rest = text.slice(end);
	const initial = index === firstWordIndex(tokens);
	return text.slice(0, start) + (initial ? rest.replace(/[A-Za-z]/, (c) => c.toUpperCase()) : rest);
}
