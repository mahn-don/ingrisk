import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { CARD_KINDS, generatedCache } from '../schema.ts';

export type CacheItem = typeof generatedCache.$inferSelect;
export type CacheKind = (typeof CARD_KINDS)[number];
export type NewCacheItem = Omit<
	typeof generatedCache.$inferInsert,
	'id' | 'validated' | 'validationNotes' | 'servedAt'
>;

export interface StockEntry {
	kind: CacheKind;
	levelBand: number;
	/** Validated items not yet served. */
	available: number;
}

/** Pre-generated exercise items (filled by prefetch, consumed by sessions). */
export function cacheRepo(db: Db) {
	return {
		/** Store a validated item. Returns undefined if an item with the same content_hash exists. */
		insertValidated(item: NewCacheItem): CacheItem | undefined {
			return db
				.insert(generatedCache)
				.values({ ...item, validated: true })
				.onConflictDoNothing({ target: generatedCache.contentHash })
				.returning()
				.get();
		},
		/**
		 * Take up to `n` validated, unserved items of a kind and band, oldest first, and mark them
		 * served in the same transaction, so no item is ever handed out twice.
		 */
		takeUnserved(kind: CacheKind, levelBand: number, n: number, now = new Date()): CacheItem[] {
			return db.transaction(
				(tx) => {
					const ids = tx
						.select({ id: generatedCache.id })
						.from(generatedCache)
						.where(
							and(
								eq(generatedCache.kind, kind),
								eq(generatedCache.levelBand, levelBand),
								eq(generatedCache.validated, true),
								isNull(generatedCache.servedAt)
							)
						)
						.orderBy(asc(generatedCache.id))
						.limit(n)
						.all()
						.map((r) => r.id);
					if (ids.length === 0) return [];
					return tx
						.update(generatedCache)
						.set({ servedAt: now })
						.where(and(inArray(generatedCache.id, ids), isNull(generatedCache.servedAt)))
						.returning()
						.all()
						.sort((a, b) => a.id - b.id);
				},
				{ behavior: 'immediate' }
			);
		},
		/** Unserved validated items per kind and band. */
		stock(): StockEntry[] {
			return db
				.select({
					kind: generatedCache.kind,
					levelBand: generatedCache.levelBand,
					available: count()
				})
				.from(generatedCache)
				.where(and(eq(generatedCache.validated, true), isNull(generatedCache.servedAt)))
				.groupBy(generatedCache.kind, generatedCache.levelBand)
				.orderBy(asc(generatedCache.kind), asc(generatedCache.levelBand))
				.all();
		}
	};
}
