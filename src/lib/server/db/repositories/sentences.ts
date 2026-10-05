import { and, asc, count, eq, isNotNull, lte } from 'drizzle-orm';
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
		/** Usable sentences for cloze: not blocked and at most `maxOffList` off-list words. */
		forCloze(maxOffList: number): SentenceRow[] {
			return db
				.select()
				.from(sentences)
				.where(and(eq(sentences.blocked, false), lte(sentences.offListCount, maxOffList)))
				.orderBy(asc(sentences.id))
				.all();
		},
		countBlocked(): number {
			return db.select({ n: count() }).from(sentences).where(eq(sentences.blocked, true)).get()?.n ?? 0;
		}
	};
}
