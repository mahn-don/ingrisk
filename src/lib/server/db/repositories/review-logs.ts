import { asc, eq } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { reviewLogs } from '../schema.ts';

export type ReviewLogRow = typeof reviewLogs.$inferSelect;
export type NewReviewLog = Omit<typeof reviewLogs.$inferInsert, 'id'>;

/** Append-only history of reviews; never updated or deleted. */
export function reviewLogsRepo(db: Db) {
	return {
		append(log: NewReviewLog): ReviewLogRow {
			return db.insert(reviewLogs).values(log).returning().get();
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
