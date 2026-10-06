import { and, asc, countDistinct, eq, gte, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { cards, clozeItems, reviewLogs } from '../schema.ts';

export type ReviewLogRow = typeof reviewLogs.$inferSelect;
export type NewReviewLog = Omit<typeof reviewLogs.$inferInsert, 'id'>;

/** Append-only history of reviews; never updated or deleted. */
export function reviewLogsRepo(db: DbOrTx) {
	return {
		append(log: NewReviewLog): ReviewLogRow {
			return db.insert(reviewLogs).values(log).returning().get();
		},
		/**
		 * Number of distinct cards first reviewed (pre-review state New) in [from, to): the cards
		 * introduced in that period, for the daily new-card limit. Cards on mined errors (gap type
		 * user_error) are exempt from that limit and not counted (Phase 9b).
		 */
		countIntroducedBetween(from: Date, to: Date): number {
			const row = db
				.select({ n: countDistinct(reviewLogs.cardId) })
				.from(reviewLogs)
				.innerJoin(cards, eq(cards.id, reviewLogs.cardId))
				.leftJoin(clozeItems, eq(clozeItems.id, cards.clozeItemId))
				.where(
					and(
						eq(reviewLogs.state, 'New'),
						gte(reviewLogs.review, from),
						lt(reviewLogs.review, to),
						or(isNull(clozeItems.gapType), ne(clozeItems.gapType, 'user_error'))
					)
				)
				.get();
			return row?.n ?? 0;
		},
		/** Lapses (Again) on grammar cards since `since`, per grammar topic id (the weakness profile). */
		againByGrammarTopicSince(since: Date): Map<number, number> {
			const rows = db
				.select({ topic: cards.grammarTopicId, n: countDistinct(reviewLogs.id) })
				.from(reviewLogs)
				.innerJoin(cards, eq(cards.id, reviewLogs.cardId))
				.where(and(eq(reviewLogs.rating, 'Again'), gte(reviewLogs.review, since), isNotNull(cards.grammarTopicId)))
				.groupBy(cards.grammarTopicId)
				.all();
			return new Map(rows.map((r) => [r.topic!, r.n]));
		},
		/** All reviews of a card, oldest first. */
		forCard(cardId: number): ReviewLogRow[] {
			return db
				.select()
				.from(reviewLogs)
				.where(eq(reviewLogs.cardId, cardId))
				.orderBy(asc(reviewLogs.review), asc(reviewLogs.id))
				.all();
		}
	};
}
