// Learner profiles (Phase 12): Netflix-style, behind the single app password. Creating a profile
// also creates its level row (user_profile) and learning settings (profile_settings), so a new
// profile starts exactly like a fresh install. Archiving hides a profile and keeps its data.
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { profileSettings, profiles, userProfile } from '../schema.ts';

export type ProfileRow = typeof profiles.$inferSelect;

/** "Hồ sơ 1": created by migration 0010, owner of everything learned before profiles existed. */
export const FIRST_PROFILE_ID = 1;

export function profilesRepo(db: DbOrTx) {
	return {
		/** Profiles not archived, oldest first. */
		active(): ProfileRow[] {
			return db.select().from(profiles).where(isNull(profiles.archivedAt)).orderBy(asc(profiles.id)).all();
		},
		all(): ProfileRow[] {
			return db.select().from(profiles).orderBy(asc(profiles.id)).all();
		},
		byId(id: number): ProfileRow | undefined {
			return db.select().from(profiles).where(eq(profiles.id, id)).get();
		},
		/** A usable (not archived) profile, or undefined. */
		activeById(id: number): ProfileRow | undefined {
			return db.select().from(profiles).where(and(eq(profiles.id, id), isNull(profiles.archivedAt))).get();
		},
		byName(name: string): ProfileRow | undefined {
			return db.select().from(profiles).where(eq(profiles.name, name)).get();
		},
		/** Create a profile with its own level row and default learning settings, in one transaction. */
		create(values: { name: string; emoji: string | null }, now: Date): ProfileRow {
			return db.transaction((tx) => {
				const row = tx
					.insert(profiles)
					.values({ name: values.name, emoji: values.emoji, createdAt: now })
					.returning()
					.get();
				tx.insert(userProfile).values({ profileId: row.id, updatedAt: now }).run();
				tx.insert(profileSettings).values({ profileId: row.id }).run();
				return row;
			});
		},
		update(id: number, values: { name: string; emoji: string | null }): ProfileRow | undefined {
			return db.update(profiles).set(values).where(eq(profiles.id, id)).returning().get();
		},
		/** Hide a profile from the picker; its data stays. */
		archive(id: number, now: Date): boolean {
			return db
				.update(profiles)
				.set({ archivedAt: now })
				.where(and(eq(profiles.id, id), isNull(profiles.archivedAt)))
				.run().changes > 0;
		}
	};
}
