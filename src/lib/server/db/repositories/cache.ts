import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { CARD_KINDS, generatedCache } from '../schema.ts';

export type CacheItem = typeof generatedCache.$inferSelect;
export type CacheKind = (typeof CARD_KINDS)[number];
export type NewCacheItem = Omit<
	typeof generatedCache.$inferInsert,
	'id' | 'validated' | 'validationNotes' | 'servedAt'
>;

export interface ParamsStock {
	paramsHash: string;
	levelBand: number;
	n: number;
}

export interface StockEntry {
	kind: CacheKind;
	levelBand: number;
	/** Validated items not yet served. */
	available: number;
}

/** Pre-generated exercise items (filled by prefetch, consumed by sessions). */
export function cacheRepo(db: DbOrTx) {
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
		 * Store a generated item, validated or rejected (rejections keep their notes for inspection).
		 * Returns undefined if an item with the same content_hash exists.
		 */
		insert(item: NewCacheItem & { validated: boolean; validationNotes: string | null }): CacheItem | undefined {
			return db.insert(generatedCache).values(item).onConflictDoNothing({ target: generatedCache.contentHash }).returning().get();
		},
		/** Which of these content hashes are already stored (any kind, validated or not). */
		existingHashes(hashes: readonly string[]): Set<string> {
			const found = new Set<string>();
			for (let i = 0; i < hashes.length; i += 500) {
				const rows = db
					.select({ h: generatedCache.contentHash })
					.from(generatedCache)
					.where(inArray(generatedCache.contentHash, hashes.slice(i, i + 500)))
					.all();
				for (const row of rows) found.add(row.h);
			}
			return found;
		},
		/**
		 * Item counts of a kind per params hash and band: validated and unserved (the stock), or with
		 * `includeServed`, every validated item ever made (used to spread topics).
		 */
		countByParams(kind: CacheKind, options: { includeServed?: boolean } = {}): ParamsStock[] {
			const conditions = [eq(generatedCache.kind, kind), eq(generatedCache.validated, true)];
			if (!options.includeServed) conditions.push(isNull(generatedCache.servedAt));
			return db
				.select({ paramsHash: generatedCache.paramsHash, levelBand: generatedCache.levelBand, n: count() })
				.from(generatedCache)
				.where(and(...conditions))
				.groupBy(generatedCache.paramsHash, generatedCache.levelBand)
				.all();
		},
		/** Items of a kind by validation status, newest first (evaluation sheets). */
		byKind(kind: CacheKind, validated: boolean): CacheItem[] {
			return db
				.select()
				.from(generatedCache)
				.where(and(eq(generatedCache.kind, kind), eq(generatedCache.validated, validated)))
				.orderBy(desc(generatedCache.id))
				.all();
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
