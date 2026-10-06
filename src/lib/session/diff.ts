// Word-level differences, to highlight what a correction changed (shared, no server imports).

export interface Segment {
	text: string;
	/** Not in the original: inserted or changed by the correction. */
	changed: boolean;
}

const words = (text: string) => text.split(/(\s+)/).filter((w) => w !== '');
const key = (w: string) => w.toLowerCase().replace(/[‘’]/g, "'");

/**
 * The corrected text as segments, the words that the original does not have (by a longest common
 * subsequence of words) marked changed. Whitespace is kept as it is.
 */
export function changedWords(original: string, corrected: string): Segment[] {
	const a = words(original).filter((w) => !/^\s+$/.test(w));
	const tokens = words(corrected);
	const b = tokens.filter((w) => !/^\s+$/.test(w));
	const lcs: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = key(a[i]) === key(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
	}
	const kept = new Set<number>();
	for (let i = 0, j = 0; i < a.length && j < b.length; ) {
		if (key(a[i]) === key(b[j])) {
			kept.add(j);
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
		else j++;
	}
	const segments: Segment[] = [];
	let index = 0;
	for (const token of tokens) {
		const space = /^\s+$/.test(token);
		const changed = !space && !kept.has(index);
		if (!space) index++;
		// Spaces never join a highlighted segment.
		const last = segments.at(-1);
		if (last !== undefined && last.changed === changed) last.text += token;
		else segments.push({ text: token, changed });
	}
	return segments;
}
