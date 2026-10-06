import { and, asc, count, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { cards, clozeItems, sentences } from '../schema.ts';

export type ClozeItemRow = typeof clozeItems.$inferSelect;
export type NewClozeItem = Omit<typeof clozeItems.$inferInsert, 'id'>;
export type ClozeItemWithSentence = ClozeItemRow & { enText: string; viText: string };

export interface PoolCount {
	gapType: ClozeItemRow['gapType'];
	levelBand: number;
	validated: boolean;
	n: number;
}

/** A cloze item as a session needs it: the item, its sentence's text and the stock-name flag. */
export interface SessionClozeItem {
	id: number;
	sentenceId: number;
	gapType: ClozeItemRow['gapType'];
	tokenIndex: number;
	answer: string;
	options: string[];
	answerVi: string | null;
	levelBand: number;
	lexemeId: number | null;
	grammarTopicId: number | null;
	enText: string;
	viText: string;
	hasStockNames: boolean;
}

export function clozeItemsRepo(db: DbOrTx) {
	const sessionColumns = {
		id: clozeItems.id,
		sentenceId: clozeItems.sentenceId,
		gapType: clozeItems.gapType,
		tokenIndex: clozeItems.tokenIndex,
		answer: clozeItems.answer,
		options: clozeItems.options,
		answerVi: clozeItems.answerVi,
		levelBand: clozeItems.levelBand,
		lexemeId: clozeItems.lexemeId,
		grammarTopicId: clozeItems.grammarTopicId,
		enText: sentences.enText,
		viText: sentences.viText,
		hasStockNames: sentences.hasStockNames
	};
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
		/** Validated items no card uses yet, per band (the cloze stock prefetch keeps full). */
		availableByBand(): Map<number, number> {
			const rows = db
				.select({ levelBand: clozeItems.levelBand, n: count() })
				.from(clozeItems)
				.leftJoin(cards, eq(cards.clozeItemId, clozeItems.id))
				.where(and(eq(clozeItems.validated, true), isNull(cards.id)))
				.groupBy(clozeItems.levelBand)
				.all();
			return new Map(rows.map((r) => [r.levelBand, r.n]));
		},
		/** Session details of these items. */
		forSession(ids: readonly number[]): SessionClozeItem[] {
			if (ids.length === 0) return [];
			return db
				.select(sessionColumns)
				.from(clozeItems)
				.innerJoin(sentences, eq(clozeItems.sentenceId, sentences.id))
				.where(inArray(clozeItems.id, [...ids]))
				.all();
		},
		/** Validated items with no card yet, up to `maxBand`, lowest band first: new-card candidates. */
		newCardCandidates(maxBand: number): SessionClozeItem[] {
			return db
				.select(sessionColumns)
				.from(clozeItems)
				.innerJoin(sentences, eq(clozeItems.sentenceId, sentences.id))
				.leftJoin(cards, eq(cards.clozeItemId, clozeItems.id))
				.where(and(eq(clozeItems.validated, true), isNull(cards.id), lte(clozeItems.levelBand, maxBand), eq(sentences.blocked, false)))
				.orderBy(asc(clozeItems.levelBand), asc(clozeItems.id))
				.all();
		},
		/** How many new-card candidates exist up to `maxBand` (see newCardCandidates). */
		countNewCardCandidates(maxBand: number): number {
			return (
				db
					.select({ n: count() })
					.from(clozeItems)
					.innerJoin(sentences, eq(clozeItems.sentenceId, sentences.id))
					.leftJoin(cards, eq(cards.clozeItemId, clozeItems.id))
					.where(and(eq(clozeItems.validated, true), isNull(cards.id), lte(clozeItems.levelBand, maxBand), eq(sentences.blocked, false)))
					.get()?.n ?? 0
			);
		},
		/** Whether any validated item exists at all. */
		hasValidated(): boolean {
			return db.select({ id: clozeItems.id }).from(clozeItems).where(eq(clozeItems.validated, true)).limit(1).get() !== undefined;
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
