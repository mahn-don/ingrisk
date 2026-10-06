import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { userProfile } from '../schema.ts';

export type Profile = typeof userProfile.$inferSelect;
export type ProfilePatch = Partial<Omit<Profile, 'id' | 'profileId' | 'updatedAt'>>;

/**
 * A learner's level estimates (user_profile): one row per profile, created with the profile
 * (Phase 12; before, a single row).
 */
export function profileRepo(db: DbOrTx, profileId: number) {
	const mine = eq(userProfile.profileId, profileId);
	return {
		get(): Profile {
			const row = db.select().from(userProfile).where(mine).get();
			if (row === undefined) throw new Error(`user_profile row missing for profile ${profileId}`);
			return row;
		},
		update(patch: ProfilePatch, now = new Date()): Profile {
			const row = db
				.update(userProfile)
				.set({ ...patch, updatedAt: now })
				.where(mine)
				.returning()
				.get();
			if (row === undefined) throw new Error(`user_profile row missing for profile ${profileId}`);
			return row;
		}
	};
}
