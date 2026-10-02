// Joining Tatoeba per-language exports into EN-VI pairs. Pure functions; no file I/O.
import { splitLines } from './text.ts';

export interface PairRow {
	engId: number;
	engText: string;
	vieId: number;
	vieText: string;
}

export const PAIRS_HEADER = 'eng_id\teng_text\tvie_id\tvie_text';

function parseId(value: string, line: string): number {
	const id = Number(value);
	if (!Number.isInteger(id) || id < 1) throw new Error(`Bad Tatoeba id in line: ${line}`);
	return id;
}

/** `eng-vie_links.tsv`: `eng_id <TAB> vie_id` per line. */
export function parseLinks(raw: string): [number, number][] {
	const links: [number, number][] = [];
	for (const line of splitLines(raw)) {
		if (line === '') continue;
		const cells = line.split('\t');
		if (cells.length !== 2) throw new Error(`Bad links line: ${line}`);
		links.push([parseId(cells[0], line), parseId(cells[1], line)]);
	}
	return links;
}

/** `<lang>_sentences.tsv`: `id <TAB> lang <TAB> text` per line. Returns null for blank lines. */
export function parseSentenceLine(line: string): { id: number; lang: string; text: string } | null {
	if (line === '') return null;
	const first = line.indexOf('\t');
	const second = line.indexOf('\t', first + 1);
	if (first < 0 || second < 0) throw new Error(`Bad sentence line: ${line}`);
	return {
		id: parseId(line.slice(0, first), line),
		lang: line.slice(first + 1, second),
		text: line.slice(second + 1)
	};
}

export interface JoinResult {
	rows: PairRow[];
	missingEng: number;
	missingVie: number;
}

/** Join links with sentence texts; sorted by eng_id, then vie_id. Links to deleted sentences are counted and skipped. */
export function joinPairs(
	links: [number, number][],
	eng: Map<number, string>,
	vie: Map<number, string>
): JoinResult {
	const rows: PairRow[] = [];
	let missingEng = 0;
	let missingVie = 0;
	for (const [engId, vieId] of links) {
		const engText = eng.get(engId);
		const vieText = vie.get(vieId);
		if (engText === undefined) missingEng++;
		if (vieText === undefined) missingVie++;
		if (engText === undefined || vieText === undefined) continue;
		rows.push({ engId, engText, vieId, vieText });
	}
	rows.sort((a, b) => a.engId - b.engId || a.vieId - b.vieId);
	return { rows, missingEng, missingVie };
}

export function formatPairsTsv(rows: PairRow[]): string {
	const lines = rows.map((r) => {
		for (const text of [r.engText, r.vieText]) {
			if (/[\t\r\n]/.test(text)) throw new Error(`Sentence contains a tab or newline: ${text}`);
		}
		return `${r.engId}\t${r.engText}\t${r.vieId}\t${r.vieText}`;
	});
	return [PAIRS_HEADER, ...lines].join('\n') + '\n';
}

/** Parse the derived pairs TSV (with or without the header row). */
export function parsePairsTsv(raw: string): PairRow[] {
	const rows: PairRow[] = [];
	for (const line of splitLines(raw)) {
		if (line === '' || line === PAIRS_HEADER) continue;
		const cells = line.split('\t');
		if (cells.length !== 4) throw new Error(`Bad pairs line: ${line}`);
		rows.push({
			engId: parseId(cells[0], line),
			engText: cells[1],
			vieId: parseId(cells[2], line),
			vieText: cells[3]
		});
	}
	return rows;
}
