import { eq } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { settings } from '../schema.ts';

export type Settings = typeof settings.$inferSelect;
export type SettingsPatch = Partial<Omit<Settings, 'id'>>;

/** The single settings row (id = 1, seeded by the initial migration). */
export function settingsRepo(db: Db) {
	return {
		get(): Settings {
			const row = db.select().from(settings).where(eq(settings.id, 1)).get();
			if (row === undefined) throw new Error('settings row missing: run migrations');
			return row;
		},
		update(patch: SettingsPatch): Settings {
			const row = db.update(settings).set(patch).where(eq(settings.id, 1)).returning().get();
			if (row === undefined) throw new Error('settings row missing: run migrations');
			return row;
		}
	};
}
