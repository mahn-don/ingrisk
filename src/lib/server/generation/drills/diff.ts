// The token diff between an erroneous sentence and its correction. The changed region is what lies
// between the longest common prefix and suffix of the two token lists: one contiguous region by
// construction, so a word-order swap ("bag red" -> "red bag") is one change. A drill's region may
// hold at most 3 tokens; two changes far apart make the region too large.
import { type Token, tokenize } from '../tokens.ts';

export const MAX_DIFF_TOKENS = 3;

export interface DrillDiff {
	/** Tokens in the larger side of the changed region. */
	size: number;
	/** The erroneous text of the region, widened by one neighbour when it is empty (a deletion). */
	originalSpan: string;
	/** The corrected text of the region, widened the same way. */
	correctedSpan: string;
}

const slice = (text: string, tokens: readonly Token[], from: number, to: number) =>
	from > to ? '' : text.slice(tokens[from].start, tokens[to].end);

/** The diff of two sentences, or null when they are token-identical. */
export function drillDiff(errorText: string, correctedText: string): DrillDiff | null {
	const a = tokenize(errorText);
	const b = tokenize(correctedText);
	let prefix = 0;
	while (prefix < a.length && prefix < b.length && a[prefix].text === b[prefix].text) prefix++;
	if (prefix === a.length && prefix === b.length) return null;
	let suffix = 0;
	while (
		suffix < a.length - prefix &&
		suffix < b.length - prefix &&
		a[a.length - 1 - suffix].text === b[b.length - 1 - suffix].text
	) {
		suffix++;
	}
	let [aFrom, aTo] = [prefix, a.length - 1 - suffix];
	let [bFrom, bTo] = [prefix, b.length - 1 - suffix];
	const size = Math.max(aTo - aFrom + 1, bTo - bFrom + 1);
	// A pure insertion or deletion has an empty side: widen both by one shared neighbour,
	// preferring the following word ("dog" -> "a dog").
	if (aFrom > aTo || bFrom > bTo) {
		if (aTo + 1 < a.length && a[aTo + 1].kind === 'word') {
			aTo++;
			bTo++;
		} else if (aFrom > 0) {
			aFrom--;
			bFrom--;
		} else {
			aTo++;
			bTo++;
		}
	}
	return { size, originalSpan: slice(errorText, a, aFrom, aTo), correctedSpan: slice(correctedText, b, bFrom, bTo) };
}
