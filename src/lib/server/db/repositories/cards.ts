import { and, asc, eq, inArray, isNotNull, isNull, lte, min, ne, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { cards, clozeItems } from '../schema.ts';

export type CardRow = typeof cards.$inferSelect;
/** A card to create; the repository sets its profile (Phase 12). */
export type NewCard = Omit<typeof cards.$inferInsert, 'id' | 'profileId'>;

export interface CardCounts {
	/** Cards already introduced (not New) whose due time has passed. */
	due: number;
	/** Cards never reviewed. */
	new: number;
	/** Cards in Learning or Relearning, due or not. */
	learning: number;
}

/** One learner's cards: every query is limited to `profileId` (Phase 12). */
export function cardsRepo(db: DbOrTx, profileId: number) {
	const mine = eq(cards.profileId, profileId);
	return {
		byId(id: number): CardRow | undefined {
			return db.select().from(cards).where(and(mine, eq(cards.id, id))).get();
		},
		/** Introduced cards due at or before `now`, most overdue first. New cards are not included. */
		dueCards(now: Date, limit: number): CardRow[] {
			return db
				.select()
				.from(cards)
				.where(and(mine, ne(cards.state, 'New'), lte(cards.due, now), eq(cards.suspended, false)))
				.orderBy(asc(cards.due), asc(cards.id))
				.limit(limit)
				.all();
		},
		/**
		 * Cards never reviewed, oldest first (creation order), under the daily new-card limit: cards
		 * on mined errors are left out (see newMinedCards).
		 */
		newCards(limit: number): CardRow[] {
			return db
				.select({ card: cards })
				.from(cards)
				.leftJoin(clozeItems, eq(clozeItems.id, cards.clozeItemId))
				.where(and(mine, eq(cards.state, 'New'), eq(cards.suspended, false), or(isNull(clozeItems.gapType), ne(clozeItems.gapType, 'user_error'))))
				.orderBy(asc(cards.id))
				.limit(limit)
				.all()
				.map((r) => r.card);
		},
		/** New cards on the learner's own mined errors (exempt from the daily new-card limit), oldest first. */
		newMinedCards(limit: number): CardRow[] {
			return db
				.select({ card: cards })
				.from(cards)
				.innerJoin(clozeItems, eq(clozeItems.id, cards.clozeItemId))
				.where(and(mine, eq(cards.state, 'New'), eq(cards.suspended, false), eq(clozeItems.gapType, 'user_error')))
				.orderBy(asc(cards.id))
				.limit(limit)
				.all()
				.map((r) => r.card);
		},
		counts(now: Date): CardCounts {
			const row = db
				.select({
					due: sql<number>`coalesce(sum(${cards.state} != 'New' and ${cards.due} <= ${now.getTime()}), 0)`,
					new: sql<number>`coalesce(sum(${cards.state} = 'New'), 0)`,
					learning: sql<number>`coalesce(sum(${inArray(cards.state, ['Learning', 'Relearning'])}), 0)`
				})
				.from(cards)
				.where(and(mine, eq(cards.suspended, false)))
				.get();
			return { due: row?.due ?? 0, new: row?.new ?? 0, learning: row?.learning ?? 0 };
		},
		/**
		 * Create a card unless one already exists for the same kind and item
		 * (unique index cards_item_unique). Returns the new row, or undefined if it existed.
		 */
		insertIfAbsent(card: NewCard): CardRow | undefined {
			return db
				.insert(cards)
				.values({ ...card, profileId })
				.onConflictDoNothing()
				.returning()
				.get();
		},
		byIds(ids: readonly number[]): CardRow[] {
			if (ids.length === 0) return [];
			return db.select().from(cards).where(and(mine, inArray(cards.id, [...ids]))).all();
		},
		/** The earliest due time among introduced (not New), not suspended cards; null when there are none. */
		earliestIntroducedDue(): Date | null {
			const row = db.select({ due: min(cards.due) }).from(cards).where(and(mine, ne(cards.state, 'New'), eq(cards.suspended, false))).get();
			return row?.due ?? null;
		},
		/** Cloze item ids that already have a card. */
		clozeItemIdsWithCards(): Set<number> {
			const rows = db.select({ id: cards.clozeItemId }).from(cards).where(and(mine, isNotNull(cards.clozeItemId))).all();
			return new Set(rows.map((r) => r.id!));
		},
		/** Lexemes that already have a card. */
		lexemeIdsWithCards(): Set<number> {
			const rows = db.select({ id: cards.lexemeId }).from(cards).where(and(mine, isNotNull(cards.lexemeId))).all();
			return new Set(rows.map((r) => r.id!));
		},
		setPromptMode(id: number, mode: CardRow['promptMode']): void {
			db.update(cards).set({ promptMode: mode }).where(and(mine, eq(cards.id, id), ne(cards.promptMode, mode))).run();
		},
		/** Hide a card from every queue and count (its history stays), or show it again. */
		setSuspended(id: number, suspended: boolean): boolean {
			return db.update(cards).set({ suspended }).where(and(mine, eq(cards.id, id))).run().changes > 0;
		},
		/** "Ôn ngay": due now (FSRS later uses the real elapsed time). */
		dueNow(id: number, now: Date): boolean {
			return db.update(cards).set({ due: now }).where(and(mine, eq(cards.id, id))).run().changes > 0;
		},
		/** Introduced (not New), not suspended cards: their due times, for the review forecast. */
		introducedDue(): Date[] {
			return db
				.select({ due: cards.due })
				.from(cards)
				.where(and(mine, ne(cards.state, 'New'), eq(cards.suspended, false)))
				.all()
				.map((r) => r.due);
		},
		/** The stats page's card totals (suspended cards count: they were learned). */
		progressTotals(): { wordsLearned: number; cardsInLearning: number; minedAdded: number; minedInReview: number; minedWaiting: number } {
			const isMined = sql`${clozeItems.gapType} = 'user_error'`;
			const row = db
				.select({
					wordsLearned: sql<number>`coalesce(sum(${clozeItems.gapType} = 'lexical' and ${cards.state} = 'Review'), 0)`,
					cardsInLearning: sql<number>`coalesce(sum(${cards.state} in ('Learning', 'Relearning') and ${cards.suspended} = 0), 0)`,
					minedAdded: sql<number>`coalesce(sum(${isMined}), 0)`,
					minedInReview: sql<number>`coalesce(sum(${isMined} and ${cards.state} = 'Review'), 0)`,
					minedWaiting: sql<number>`coalesce(sum(${isMined} and ${cards.state} = 'New' and ${cards.suspended} = 0), 0)`
				})
				.from(cards)
				.leftJoin(clozeItems, eq(clozeItems.id, cards.clozeItemId))
				.where(mine)
				.get();
			return {
				wordsLearned: row?.wordsLearned ?? 0,
				cardsInLearning: row?.cardsInLearning ?? 0,
				minedAdded: row?.minedAdded ?? 0,
				minedInReview: row?.minedInReview ?? 0,
				minedWaiting: row?.minedWaiting ?? 0
			};
		},
		/** Persist a card's updated scheduling state (and prompt mode). */
		save(card: CardRow): CardRow {
			const { id, kind, lexemeId, sentenceId, grammarTopicId, profileId: _owner, ...mutable } = card;
			const row = db.update(cards).set(mutable).where(and(mine, eq(cards.id, id))).returning().get();
			if (row === undefined) throw new Error(`card ${id} not found`);
			return row;
		}
	};
}
