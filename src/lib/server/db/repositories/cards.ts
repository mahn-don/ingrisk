import { and, asc, eq, inArray, isNotNull, lte, min, ne, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { cards } from '../schema.ts';

export type CardRow = typeof cards.$inferSelect;
export type NewCard = Omit<typeof cards.$inferInsert, 'id'>;

export interface CardCounts {
	/** Cards already introduced (not New) whose due time has passed. */
	due: number;
	/** Cards never reviewed. */
	new: number;
	/** Cards in Learning or Relearning, due or not. */
	learning: number;
}

export function cardsRepo(db: DbOrTx) {
	return {
		byId(id: number): CardRow | undefined {
			return db.select().from(cards).where(eq(cards.id, id)).get();
		},
		/** Introduced cards due at or before `now`, most overdue first. New cards are not included. */
		dueCards(now: Date, limit: number): CardRow[] {
			return db
				.select()
				.from(cards)
				.where(and(ne(cards.state, 'New'), lte(cards.due, now)))
				.orderBy(asc(cards.due), asc(cards.id))
				.limit(limit)
				.all();
		},
		/** Cards never reviewed, oldest first (creation order). */
		newCards(limit: number): CardRow[] {
			return db.select().from(cards).where(eq(cards.state, 'New')).orderBy(asc(cards.id)).limit(limit).all();
		},
		counts(now: Date): CardCounts {
			const row = db
				.select({
					due: sql<number>`coalesce(sum(${cards.state} != 'New' and ${cards.due} <= ${now.getTime()}), 0)`,
					new: sql<number>`coalesce(sum(${cards.state} = 'New'), 0)`,
					learning: sql<number>`coalesce(sum(${inArray(cards.state, ['Learning', 'Relearning'])}), 0)`
				})
				.from(cards)
				.get();
			return { due: row?.due ?? 0, new: row?.new ?? 0, learning: row?.learning ?? 0 };
		},
		/**
		 * Create a card unless one already exists for the same kind and item
		 * (unique index cards_item_unique). Returns the new row, or undefined if it existed.
		 */
		insertIfAbsent(card: NewCard): CardRow | undefined {
			return db.insert(cards).values(card).onConflictDoNothing().returning().get();
		},
		byIds(ids: readonly number[]): CardRow[] {
			if (ids.length === 0) return [];
			return db.select().from(cards).where(inArray(cards.id, [...ids])).all();
		},
		/** The earliest due time among introduced (not New) cards; null when there are none. */
		earliestIntroducedDue(): Date | null {
			const row = db.select({ due: min(cards.due) }).from(cards).where(ne(cards.state, 'New')).get();
			return row?.due ?? null;
		},
		/** Cloze item ids that already have a card. */
		clozeItemIdsWithCards(): Set<number> {
			const rows = db.select({ id: cards.clozeItemId }).from(cards).where(isNotNull(cards.clozeItemId)).all();
			return new Set(rows.map((r) => r.id!));
		},
		/** Lexemes that already have a card. */
		lexemeIdsWithCards(): Set<number> {
			const rows = db.select({ id: cards.lexemeId }).from(cards).where(isNotNull(cards.lexemeId)).all();
			return new Set(rows.map((r) => r.id!));
		},
		setPromptMode(id: number, mode: CardRow['promptMode']): void {
			db.update(cards).set({ promptMode: mode }).where(and(eq(cards.id, id), ne(cards.promptMode, mode))).run();
		},
		/** Persist a card's updated scheduling state (and prompt mode). */
		save(card: CardRow): CardRow {
			const { id, kind, lexemeId, sentenceId, grammarTopicId, ...mutable } = card;
			const row = db.update(cards).set(mutable).where(eq(cards.id, id)).returning().get();
			if (row === undefined) throw new Error(`card ${id} not found`);
			return row;
		}
	};
}
