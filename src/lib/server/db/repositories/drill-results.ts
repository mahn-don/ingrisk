import { and, eq, gte } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { drillResults } from '../schema.ts';

export type DrillResultRow = typeof drillResults.$inferSelect;
export type NewDrillResult = Omit<typeof drillResults.$inferInsert, 'id' | 'profileId'>;

/** Answered error drills (one-off practice, not cards); the weakness profile reads the misses. */
export function drillResultsRepo(db: DbOrTx, profileId: number) {
	const mine = eq(drillResults.profileId, profileId);
	return {
		insert(row: NewDrillResult): DrillResultRow {
			return db
				.insert(drillResults)
				.values({ ...row, profileId })
				.returning()
				.get();
		},
		forSession(sessionId: number): DrillResultRow[] {
			return db.select().from(drillResults).where(and(mine, eq(drillResults.sessionId, sessionId))).all();
		},
		/** Every drill answered since `since` (the weakness profile's accuracy). */
		since(since: Date): DrillResultRow[] {
			return db.select().from(drillResults).where(and(mine, gte(drillResults.answeredAt, since))).all();
		},
		/** Drills answered wrongly since `since`. */
		missedSince(since: Date): DrillResultRow[] {
			return db
				.select()
				.from(drillResults)
				.where(and(mine, eq(drillResults.correct, false), gte(drillResults.answeredAt, since)))
				.all();
		}
	};
}
