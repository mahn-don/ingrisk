import { asc, count, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { clozeItems, sentences } from '../schema.ts';

export type ClozeItemRow = typeof clozeItems.$inferSelect;
export type NewClozeItem = Omit<typeof clozeItems.$inferInsert, 'id'>;
export type ClozeItemWithSentence = ClozeItemRow & { enText: string; viText: string };

export interface PoolCount {
	gapType: ClozeItemRow['gapType'];
	levelBand: number;
	validated: boolean;
	n: number;
}

export function clozeItemsRepo(db: DbOrTx) {
	const withSentence = () =>
		db
			.select({ item: clozeItems, enText: sentences.enText, viText: sentences.viText })
			.from(clozeItems)
			.innerJoin(sentences, eq(clozeItems.sentenceId, sentences.id));
	const flatten = (rows: { item: ClozeItemRow; enText: string; viText: string }[]): ClozeItemWithSentence[] =>
		rows.map((r) => ({ ...r.item, enText: r.enText, viText: r.viText }));
	return {
		/** Which of these content hashes are already stored. */
		existingHashes(hashes: readonly string[]): Set<string> {
			const found = new Set<string>();
			for (let i = 0; i < hashes.length; i += 500) {
				const chunk = hashes.slice(i, i + 500);
				for (const row of db
					.select({ h: clozeItems.contentHash })
					.from(clozeItems)
					.where(inArray(clozeItems.contentHash, chunk))
					.all()) {
					found.add(row.h);
				}
			}
			return found;
		},
		/** Store an item; returns undefined if its content_hash already exists. */
		insert(item: NewClozeItem): ClozeItemRow | undefined {
			return db.insert(clozeItems).values(item).onConflictDoNothing({ target: clozeItems.contentHash }).returning().get();
		},
		byValidated(validated: boolean): ClozeItemWithSentence[] {
			return flatten(withSentence().where(eq(clozeItems.validated, validated)).orderBy(asc(clozeItems.id)).all());
		},
		/** Pool size per gap type, band and validation status. */
		counts(): PoolCount[] {
			return db
				.select({ gapType: clozeItems.gapType, levelBand: clozeItems.levelBand, validated: clozeItems.validated, n: count() })
				.from(clozeItems)
				.groupBy(clozeItems.gapType, clozeItems.levelBand, clozeItems.validated)
				.orderBy(asc(clozeItems.gapType), asc(clozeItems.levelBand))
				.all();
		}
	};
}
