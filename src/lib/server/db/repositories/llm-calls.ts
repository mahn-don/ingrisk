import { asc, count, gt, gte, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { llmCalls } from '../schema.ts';

export type LlmCallRow = typeof llmCalls.$inferSelect;
export type NewLlmCall = Omit<typeof llmCalls.$inferInsert, 'id'>;

export interface UsageEntry {
	providerId: number;
	model: string;
	calls: number;
	inputTokens: number;
	outputTokens: number;
}

/** Metadata about every HTTP attempt to an LLM provider (never prompt/response text or keys). */
export function llmCallsRepo(db: DbOrTx) {
	return {
		record(call: NewLlmCall): LlmCallRow {
			return db.insert(llmCalls).values(call).returning().get();
		},
		/** HTTP attempts since `since` (inclusive); the basis for rate limiting. */
		countSince(since: Date): number {
			return db.select({ n: count() }).from(llmCalls).where(gte(llmCalls.createdAt, since)).get()?.n ?? 0;
		},
		/** Token totals per provider and model since `since`. */
		usageSince(since: Date): UsageEntry[] {
			return db
				.select({
					providerId: llmCalls.providerId,
					model: llmCalls.model,
					calls: count(),
					inputTokens: sql<number>`coalesce(sum(${llmCalls.inputTokens}), 0)`,
					outputTokens: sql<number>`coalesce(sum(${llmCalls.outputTokens}), 0)`
				})
				.from(llmCalls)
				.where(gte(llmCalls.createdAt, since))
				.groupBy(llmCalls.providerId, llmCalls.model)
				.orderBy(asc(llmCalls.providerId), asc(llmCalls.model))
				.all();
		},
		/** Highest row id so far (0 when empty): a baseline for counting one run's calls. */
		maxId(): number {
			return db.select({ id: sql<number>`coalesce(max(${llmCalls.id}), 0)` }).from(llmCalls).get()?.id ?? 0;
		},
		/** HTTP attempts recorded after row `id`. */
		countAfterId(id: number): number {
			return db.select({ n: count() }).from(llmCalls).where(gt(llmCalls.id, id)).get()?.n ?? 0;
		},
		/** Token totals per provider and model for rows after `id`. */
		usageAfterId(id: number): UsageEntry[] {
			return db
				.select({
					providerId: llmCalls.providerId,
					model: llmCalls.model,
					calls: count(),
					inputTokens: sql<number>`coalesce(sum(${llmCalls.inputTokens}), 0)`,
					outputTokens: sql<number>`coalesce(sum(${llmCalls.outputTokens}), 0)`
				})
				.from(llmCalls)
				.where(gt(llmCalls.id, id))
				.groupBy(llmCalls.providerId, llmCalls.model)
				.orderBy(asc(llmCalls.providerId), asc(llmCalls.model))
				.all();
		},
		all(): LlmCallRow[] {
			return db.select().from(llmCalls).orderBy(asc(llmCalls.id)).all();
		}
	};
}
