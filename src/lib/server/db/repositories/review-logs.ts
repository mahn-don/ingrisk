import { and, asc, countDistinct, eq, gte, lt } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { reviewLogs } from '../schema.ts';

export type ReviewLogRow = typeof reviewLogs.$inferSelect;
export type NewReviewLog = Omit<typeof reviewLogs.$inferInsert, 'id'>;

/** Append-only history of reviews; never updated or deleted. */
export function reviewLogsRepo(db: DbOrTx) {
	return {
		append(log: NewReviewLog): ReviewLogRow {
			return db.insert(reviewLogs).values(log).returning().get();
		},
		/**
		 * Number of distinct cards first reviewed (pre-review state New) in [from, to):
		 * the cards introduced in that period.
		 */
		countIntroducedBetween(from: Date, to: Date): number {
			const row = db
				.select({ n: countDistinct(reviewLogs.cardId) })
				.from(reviewLogs)
				.where(and(eq(reviewLogs.state, 'New'), gte(reviewLogs.review, from), lt(reviewLogs.review, to)))
				.get();
			return row?.n ?? 0;
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
