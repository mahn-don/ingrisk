import { and, asc, between, count, eq, isNotNull, lte, ne, notInArray } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { sentences } from '../schema.ts';

export type SentenceRow = typeof sentences.$inferSelect;
export type NewSentence = Omit<typeof sentences.$inferInsert, 'id'>;

export function sentencesRepo(db: DbOrTx) {
	return {
		/** All Tatoeba sentences, keyed by English sentence id. */
		byTatoebaId(): Map<number, SentenceRow> {
			const rows = db.select().from(sentences).where(isNotNull(sentences.tatoebaIdEn)).all();
			return new Map(rows.map((r) => [r.tatoebaIdEn as number, r]));
		},
		all(): SentenceRow[] {
			return db.select().from(sentences).orderBy(asc(sentences.id)).all();
		},
		byId(id: number): SentenceRow | undefined {
			return db.select().from(sentences).where(eq(sentences.id, id)).get();
		},
		insert(row: NewSentence): SentenceRow {
			return db.insert(sentences).values(row).returning().get();
		},
		update(id: number, patch: Partial<NewSentence>): void {
			db.update(sentences).set(patch).where(eq(sentences.id, id)).run();
		},
		/**
		 * Usable sentences for cloze: not blocked, at most `maxOffList` off-list words, and not one of
		 * the learner's own corrected sentences (source user_error, Phase 9b).
		 */
		forCloze(maxOffList: number): SentenceRow[] {
			return db
				.select()
				.from(sentences)
				.where(and(eq(sentences.blocked, false), lte(sentences.offListCount, maxOffList), ne(sentences.source, 'user_error')))
				.orderBy(asc(sentences.id))
				.all();
		},
		/**
		 * Tatoeba sentences for a VI→EN translation task: not blocked, no stock names, level band in
		 * [minBand, maxBand], 5-14 words, and never served before (`exclude`).
		 */
		forTranslation(minBand: number, maxBand: number, exclude: readonly number[]): SentenceRow[] {
			return db
				.select()
				.from(sentences)
				.where(
					and(
						eq(sentences.source, 'tatoeba'),
						eq(sentences.blocked, false),
						eq(sentences.hasStockNames, false),
						between(sentences.levelBand, minBand, maxBand),
						exclude.length > 0 ? notInArray(sentences.id, [...exclude]) : undefined
					)
				)
				.orderBy(asc(sentences.id))
				.all()
				.filter((s) => {
					const words = s.enText.split(/\s+/).length;
					return words >= 5 && words <= 14;
				});
		},
		countBlocked(): number {
			return db.select({ n: count() }).from(sentences).where(eq(sentences.blocked, true)).get()?.n ?? 0;
		}
	};
}
