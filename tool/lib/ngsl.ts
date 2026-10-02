// NGSL 1.2 parsing, banding and form lookup. Pure functions; no file I/O.
import { splitLines } from './text.ts';

export const BAND_COUNT = 8;
/** Stop if the stats and lemmatized files disagree on more headwords than this. */
export const MAX_CROSS_CHECK_MISMATCHES = 50;

export interface NgslItem {
	headword: string;
	pos: string | null;
	rank: number;
	band: number;
	forms: string[];
}

export interface SupplementaryItem {
	headword: string;
	forms: string[];
}

export interface StatsRow {
	headword: string;
	rank: number;
}

function normalizeWord(word: string): string {
	return word.trim().toLowerCase();
}

function uniqueSorted(words: string[]): string[] {
	return [...new Set(words.map(normalizeWord).filter((w) => w !== ''))].sort();
}

/**
 * Parse `NGSL_1.2_stats.csv`. Its header is `Lemma,SFI Rank,SFI,Adjusted Frequency per Million (U)`;
 * columns are located by name. The file has no part-of-speech column.
 */
export function parseStats(raw: string): StatsRow[] {
	const [header, ...lines] = splitLines(raw);
	const columns = header.split(',').map((c) => c.trim().toLowerCase());
	const lemmaCol = columns.indexOf('lemma');
	const rankCol = columns.indexOf('sfi rank');
	if (lemmaCol < 0 || rankCol < 0) {
		throw new Error(`NGSL stats: expected "Lemma" and "SFI Rank" columns, got: ${header}`);
	}
	const rows: StatsRow[] = [];
	for (const line of lines) {
		if (line.trim() === '') continue;
		const cells = line.split(',');
		const rank = Number(cells[rankCol]);
		if (!Number.isInteger(rank) || rank < 1) {
			throw new Error(`NGSL stats: bad rank in line: ${line}`);
		}
		rows.push({ headword: normalizeWord(cells[lemmaCol]), rank });
	}
	rows.sort((a, b) => a.rank - b.rank);
	rows.forEach((row, i) => {
		if (row.rank !== i + 1) throw new Error(`NGSL stats: ranks are not 1..n (at ${row.headword})`);
	});
	assertNoDuplicates(
		rows.map((r) => r.headword),
		'NGSL stats'
	);
	return rows;
}

/**
 * Parse a lemmatized list (`NGSL_1.2_lemmatized_for_research.csv`, `SUP_lemmatized.csv`):
 * `##` comment lines, then one `headword,form,form,...` row per word.
 * Returns headword -> forms (headword included, lowercased, deduplicated, sorted), in file order.
 */
export function parseLemmatized(raw: string, label: string): Map<string, string[]> {
	const result = new Map<string, string[]>();
	for (const line of splitLines(raw)) {
		if (line.startsWith('##') || line.trim() === '') continue;
		const cells = line.split(',').map(normalizeWord);
		const headword = cells[0];
		if (result.has(headword)) throw new Error(`${label}: duplicate headword "${headword}"`);
		result.set(headword, uniqueSorted(cells));
	}
	return result;
}

export function assertNoDuplicates(words: string[], label: string): void {
	const seen = new Set<string>();
	for (const word of words) {
		if (seen.has(word)) throw new Error(`${label}: duplicate headword "${word}"`);
		seen.add(word);
	}
}

/** Band 1..8 for a 1-based rank; bands hold ceil(total / 8) words each (the last one fewer). */
export function bandForRank(rank: number, total: number, bandCount = BAND_COUNT): number {
	if (rank < 1 || rank > total) throw new Error(`rank ${rank} outside 1..${total}`);
	return Math.ceil(rank / Math.ceil(total / bandCount));
}

export interface NgslBuild {
	items: NgslItem[];
	supplementary: SupplementaryItem[];
	statsOnly: string[];
	lemmatizedOnly: string[];
	supplementaryAlsoRanked: string[];
	formCount: number;
}

/**
 * Join the stats file (canonical headwords, rank, band) with the lemmatized forms.
 * Stats headwords missing from the lemmatized file get `forms: [headword]`.
 */
export function buildNgsl(
	stats: StatsRow[],
	lemmatized: Map<string, string[]>,
	supplementary: Map<string, string[]>
): NgslBuild {
	const statsSet = new Set(stats.map((r) => r.headword));
	const statsOnly = stats.map((r) => r.headword).filter((h) => !lemmatized.has(h)).sort();
	const lemmatizedOnly = [...lemmatized.keys()].filter((h) => !statsSet.has(h)).sort();
	if (statsOnly.length + lemmatizedOnly.length > MAX_CROSS_CHECK_MISMATCHES) {
		throw new Error(
			`NGSL cross-check: ${statsOnly.length + lemmatizedOnly.length} mismatched headwords; ` +
				'the stats and lemmatized files probably come from different versions'
		);
	}
	const items = stats.map(({ headword, rank }) => ({
		headword,
		pos: null,
		rank,
		band: bandForRank(rank, stats.length),
		forms: lemmatized.get(headword) ?? [headword]
	}));
	const supItems = [...supplementary].map(([headword, forms]) => ({ headword, forms }));
	// Some supplementary words are also ranked headwords (e.g. "may", "march"); keep both entries.
	const supplementaryAlsoRanked = supItems.map((s) => s.headword).filter((h) => statsSet.has(h));
	const formCount = [...items, ...supItems].reduce((n, item) => n + item.forms.length, 0);
	return { items, supplementary: supItems, statsOnly, lemmatizedOnly, supplementaryAlsoRanked, formCount };
}

/**
 * Map every known form to the lowest (most frequent) band of any headword that lists it.
 * A form can belong to several headwords (e.g. "found" is a headword and a form of "find").
 * Supplementary words (days, months, number words) count as band 1.
 */
export function buildFormIndex(items: NgslItem[], supplementary: SupplementaryItem[]): Map<string, number> {
	const index = new Map<string, number>();
	const add = (form: string, band: number) => {
		const current = index.get(form);
		if (current === undefined || band < current) index.set(form, band);
	};
	for (const item of items) for (const form of item.forms) add(form, item.band);
	for (const sup of supplementary) for (const form of sup.forms) add(form, 1);
	return index;
}
