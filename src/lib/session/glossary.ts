// Splitting a passage around its glossary words (the first occurrence of each, whole words).

export type PassageSegment = { text: string } | { text: string; word: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function glossarySegments(passage: string, words: readonly string[]): PassageSegment[] {
	const found: { start: number; end: number; word: string }[] = [];
	for (const word of words) {
		const match = new RegExp(`(?<![A-Za-z'])${escape(word)}(?![A-Za-z'])`, 'i').exec(passage);
		if (match === null) continue;
		const start = match.index;
		const end = start + match[0].length;
		if (found.some((f) => start < f.end && end > f.start)) continue;
		found.push({ start, end, word });
	}
	found.sort((x, y) => x.start - y.start);
	const segments: PassageSegment[] = [];
	let at = 0;
	for (const f of found) {
		if (f.start > at) segments.push({ text: passage.slice(at, f.start) });
		segments.push({ text: passage.slice(f.start, f.end), word: f.word });
		at = f.end;
	}
	if (at < passage.length) segments.push({ text: passage.slice(at) });
	return segments;
}
