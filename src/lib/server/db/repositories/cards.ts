import { and, asc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../client.ts';
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

export function cardsRepo(db: Db) {
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
		/** Persist a card's updated scheduling state (and prompt mode). */
		save(card: CardRow): CardRow {
			const { id, kind, lexemeId, sentenceId, grammarTopicId, ...mutable } = card;
			const row = db.update(cards).set(mutable).where(eq(cards.id, id)).returning().get();
			if (row === undefined) throw new Error(`card ${id} not found`);
			return row;
		}
	};
}
