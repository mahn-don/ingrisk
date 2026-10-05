// Importing the Phase 1 content files into the database (`npm run content:import`).
// The JSON is read from disk by the caller (never bundled); these functions only upsert rows.
import { z } from 'zod';
import type { DbOrTx } from '../db/client.ts';
import { lexemesRepo, type NewLexeme } from '../db/repositories/lexemes.ts';
import { type NewSentence, sentencesRepo } from '../db/repositories/sentences.ts';
import type { BlocklistMatcher } from './blocklist.ts';

export const NGSL_LICENSE = 'CC-BY-SA-4.0';
export const TATOEBA_LICENSE = 'CC-BY-2.0-FR';

export const NgslFile = z.object({
	items: z.array(
		z.object({
			headword: z.string(),
			pos: z.string().nullable(),
			rank: z.number().int(),
			band: z.number().int(),
			forms: z.array(z.string())
		})
	),
	supplementary: z.array(z.object({ headword: z.string(), forms: z.array(z.string()) }))
});

export const TatoebaFile = z.object({
	items: z.array(
		z.object({
			tatoeba_id_en: z.number().int(),
			tatoeba_id_vi: z.number().int(),
			en: z.string(),
			vi: z.string(),
			word_count: z.number().int(),
			ngsl_band_max: z.number().int().nullable(),
			off_list_count: z.number().int()
		})
	)
});

export interface UpsertStats {
	inserted: number;
	updated: number;
	unchanged: number;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function changed<T extends object>(current: T, next: Partial<T>): boolean {
	return Object.entries(next).some(([k, v]) => !sameJson(current[k as keyof T], v));
}

/**
 * Upsert NGSL lexemes by headword. Supplementary words that are also ranked headwords
 * (`may`, `march`) are skipped. Glosses and definitions added later are never overwritten.
 */
export function importLexemes(db: DbOrTx, file: z.infer<typeof NgslFile>): UpsertStats & { skippedSupplementary: string[] } {
	const stats = { inserted: 0, updated: 0, unchanged: 0, skippedSupplementary: [] as string[] };
	db.transaction((tx) => {
		const repo = lexemesRepo(tx);
		const existing = new Map(repo.all().map((l) => [l.headword, l]));
		const ranked = new Set(file.items.map((i) => i.headword));
		const rows: NewLexeme[] = [
			...file.items.map((i) => ({
				headword: i.headword,
				pos: i.pos,
				ngslRank: i.rank,
				freqBand: i.band,
				forms: i.forms,
				supplementary: false,
				source: 'ngsl',
				licenseTag: NGSL_LICENSE
			})),
			...file.supplementary
				.filter((s) => {
					if (!ranked.has(s.headword)) return true;
					stats.skippedSupplementary.push(s.headword);
					return false;
				})
				.map((s) => ({
					headword: s.headword,
					pos: null,
					ngslRank: null,
					freqBand: 1,
					forms: s.forms,
					supplementary: true,
					source: 'ngsl-supplementary',
					licenseTag: NGSL_LICENSE
				}))
		];
		for (const row of rows) {
			const current = existing.get(row.headword);
			if (current === undefined) {
				repo.insert(row);
				stats.inserted++;
			} else if (changed(current, row)) {
				repo.update(current.id, row);
				stats.updated++;
			} else {
				stats.unchanged++;
			}
		}
	});
	return stats;
}

const STOCK_NAMES = /\b(?:Tom|Mary)\b/;

export interface SentenceImportStats extends UpsertStats {
	/** Sentences whose blocked flag changed in this run (new blocked rows, or --reblock changes). */
	newlyBlocked: number;
	unblocked: number;
	blockedTotal: number;
	/** Blocklist terms by number of blocked sentences, most frequent first. */
	topMatches: [string, number][];
}

const blockReason = (term: string | null) => (term === null ? null : `blocklist: ${term}`);

/**
 * Upsert Tatoeba sentences by English sentence id. New rows get their blocked flag from the
 * blocklist; existing rows keep theirs unless `reblock` re-applies the current list to all rows.
 * Blocked sentences are never deleted.
 */
export function importSentences(
	db: DbOrTx,
	file: z.infer<typeof TatoebaFile>,
	blocklist: BlocklistMatcher,
	options: { reblock?: boolean } = {}
): SentenceImportStats {
	const stats: SentenceImportStats = {
		inserted: 0,
		updated: 0,
		unchanged: 0,
		newlyBlocked: 0,
		unblocked: 0,
		blockedTotal: 0,
		topMatches: []
	};
	db.transaction((tx) => {
		const repo = sentencesRepo(tx);
		const existing = repo.byTatoebaId();
		for (const item of file.items) {
			const content: NewSentence = {
				enText: item.en,
				viText: item.vi,
				source: 'tatoeba',
				tatoebaIdEn: item.tatoeba_id_en,
				tatoebaIdVi: item.tatoeba_id_vi,
				ngslBandMax: item.ngsl_band_max,
				offListCount: item.off_list_count,
				licenseTag: TATOEBA_LICENSE,
				levelBand: Math.max(1, item.ngsl_band_max ?? 1),
				hasStockNames: STOCK_NAMES.test(item.en)
			};
			const current = existing.get(item.tatoeba_id_en);
			if (current === undefined) {
				const reason = blockReason(blocklist.match(item.en));
				repo.insert({ ...content, blocked: reason !== null, blockedReason: reason });
				stats.inserted++;
				if (reason !== null) stats.newlyBlocked++;
				continue;
			}
			const patch: Partial<NewSentence> = { ...content };
			if (options.reblock) {
				const reason = blockReason(blocklist.match(item.en));
				patch.blocked = reason !== null;
				patch.blockedReason = reason;
				if (patch.blocked && !current.blocked) stats.newlyBlocked++;
				if (!patch.blocked && current.blocked) stats.unblocked++;
			}
			if (changed(current, patch)) {
				repo.update(current.id, patch);
				stats.updated++;
			} else {
				stats.unchanged++;
			}
		}
		const counts = new Map<string, number>();
		for (const row of repo.all()) {
			if (!row.blocked) continue;
			stats.blockedTotal++;
			const term = row.blockedReason?.replace(/^blocklist: /, '') ?? '(unknown)';
			counts.set(term, (counts.get(term) ?? 0) + 1);
		}
		stats.topMatches = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20);
	});
	return stats;
}
