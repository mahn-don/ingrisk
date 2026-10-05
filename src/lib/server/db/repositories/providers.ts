import { and, asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { llmProviders, settings } from '../schema.ts';

export type Provider = typeof llmProviders.$inferSelect;
export type ProviderInput = Omit<typeof llmProviders.$inferInsert, 'id'>;

/** LLM provider configuration. Rows name the env variable holding the key, never the key. */
export function providersRepo(db: DbOrTx) {
	return {
		list(): Provider[] {
			return db.select().from(llmProviders).orderBy(asc(llmProviders.id)).all();
		},
		/** The provider selected in settings, if it exists and is enabled. */
		active(): Provider | undefined {
			return db
				.select({ provider: llmProviders })
				.from(settings)
				.innerJoin(llmProviders, eq(settings.activeProviderId, llmProviders.id))
				.where(and(eq(settings.id, 1), eq(llmProviders.enabled, true)))
				.get()?.provider;
		},
		/** The enabled provider flagged as fallback (at most one can be flagged). */
		fallback(): Provider | undefined {
			return db
				.select()
				.from(llmProviders)
				.where(and(eq(llmProviders.isFallback, true), eq(llmProviders.enabled, true)))
				.get();
		},
		/** Insert, or update the provider with the same name. */
		upsert(input: ProviderInput): Provider {
			const { name, ...rest } = input;
			return db
				.insert(llmProviders)
				.values(input)
				.onConflictDoUpdate({ target: llmProviders.name, set: rest })
				.returning()
				.get();
		},
		/** Delete a provider; settings.active_provider_id falls back to NULL. Returns whether one was deleted. */
		remove(id: number): boolean {
			return db.delete(llmProviders).where(eq(llmProviders.id, id)).run().changes > 0;
		}
	};
}
