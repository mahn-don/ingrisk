import { and, asc, count, desc, eq, inArray, lt } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { clozeItems, placementAttempts, placementResults, sentences } from '../schema.ts';

export type PlacementAttempt = typeof placementAttempts.$inferSelect;
export type PlacementResult = typeof placementResults.$inferSelect;
export type NewPlacementResult = Omit<typeof placementResults.$inferInsert, 'id'>;

/** A validated cloze item as Part B selects it (no sentence text). */
export interface PoolItem {
	id: number;
	gapType: (typeof clozeItems.$inferSelect)['gapType'];
	levelBand: number;
}

/** Placement attempts (the test in progress) and results (never overwritten; retakes add rows). */
export function placementRepo(db: DbOrTx) {
	return {
		/** Every placement result, oldest first (the level history). */
		allResults(): PlacementResult[] {
			return db.select().from(placementResults).orderBy(asc(placementResults.id)).all();
		},
		inProgress(): PlacementAttempt | undefined {
			return db.select().from(placementAttempts).where(eq(placementAttempts.status, 'in_progress')).get();
		},
		attempt(id: number): PlacementAttempt | undefined {
			return db.select().from(placementAttempts).where(eq(placementAttempts.id, id)).get();
		},
		/** Abandon any attempt in progress, then start a new one. */
		startAttempt(startedAt: Date, state: unknown): PlacementAttempt {
			db.update(placementAttempts)
				.set({ status: 'abandoned', finishedAt: startedAt })
				.where(eq(placementAttempts.status, 'in_progress'))
				.run();
			return db.insert(placementAttempts).values({ startedAt, stateJson: state }).returning().get();
		},
		saveAttempt(id: number, values: Partial<Pick<PlacementAttempt, 'part' | 'stateJson'>>): void {
			db.update(placementAttempts).set(values).where(eq(placementAttempts.id, id)).run();
		},
		completeAttempt(id: number, resultId: number, finishedAt: Date, state: unknown): void {
			db.update(placementAttempts)
				.set({ status: 'completed', part: 'done', finishedAt, resultId, stateJson: state })
				.where(eq(placementAttempts.id, id))
				.run();
		},
		insertResult(result: NewPlacementResult): PlacementResult {
			return db.insert(placementResults).values(result).returning().get();
		},
		updateResult(id: number, values: Partial<NewPlacementResult>): PlacementResult {
			const row = db.update(placementResults).set(values).where(eq(placementResults.id, id)).returning().get();
			if (row === undefined) throw new Error(`placement result ${id} not found`);
			return row;
		},
		result(id: number): PlacementResult | undefined {
			return db.select().from(placementResults).where(eq(placementResults.id, id)).get();
		},
		latestResult(): PlacementResult | undefined {
			return db.select().from(placementResults).orderBy(desc(placementResults.id)).limit(1).get();
		},
		/** The result taken just before `id` (for the comparison on the result page). */
		previousResult(id: number): PlacementResult | undefined {
			return db.select().from(placementResults).where(lt(placementResults.id, id)).orderBy(desc(placementResults.id)).limit(1).get();
		},
		resultCount(): number {
			return db.select({ n: count() }).from(placementResults).get()?.n ?? 0;
		},
		resultByWritingSubmission(submissionId: number): PlacementResult | undefined {
			return db.select().from(placementResults).where(eq(placementResults.writingSubmissionId, submissionId)).get();
		},
		/** Every validated cloze item, for Part B's selection. */
		clozePool(): PoolItem[] {
			return db
				.select({ id: clozeItems.id, gapType: clozeItems.gapType, levelBand: clozeItems.levelBand })
				.from(clozeItems)
				.where(eq(clozeItems.validated, true))
				.orderBy(asc(clozeItems.id))
				.all();
		},
		/** The cloze items to show, with their sentence. */
		clozeItems(ids: readonly number[]) {
			if (ids.length === 0) return [];
			return db
				.select({ id: clozeItems.id, tokenIndex: clozeItems.tokenIndex, answer: clozeItems.answer, options: clozeItems.options, enText: sentences.enText })
				.from(clozeItems)
				.innerJoin(sentences, eq(clozeItems.sentenceId, sentences.id))
				.where(and(inArray(clozeItems.id, [...ids]), eq(clozeItems.validated, true)))
				.all();
		}
	};
}
