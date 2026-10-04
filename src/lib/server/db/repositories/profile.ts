import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { userProfile } from '../schema.ts';

export type Profile = typeof userProfile.$inferSelect;
export type ProfilePatch = Partial<Omit<Profile, 'id' | 'updatedAt'>>;

/** The single learner profile row (id = 1, seeded by the initial migration). */
export function profileRepo(db: DbOrTx) {
	return {
		get(): Profile {
			const row = db.select().from(userProfile).where(eq(userProfile.id, 1)).get();
			if (row === undefined) throw new Error('user_profile row missing: run migrations');
			return row;
		},
		update(patch: ProfilePatch, now = new Date()): Profile {
			const row = db
				.update(userProfile)
				.set({ ...patch, updatedAt: now })
				.where(eq(userProfile.id, 1))
				.returning()
				.get();
			if (row === undefined) throw new Error('user_profile row missing: run migrations');
			return row;
		}
	};
}
