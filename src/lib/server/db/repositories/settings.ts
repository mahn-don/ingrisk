import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { profileSettings, settings } from '../schema.ts';

export type Settings = typeof settings.$inferSelect;
export type SettingsPatch = Partial<Omit<Settings, 'id'>>;
export type LearningSettings = typeof profileSettings.$inferSelect;
export type LearningSettingsPatch = Partial<Omit<LearningSettings, 'profileId'>>;

/** The global settings row (id = 1): only what every profile shares, the active LLM provider. */
export function settingsRepo(db: DbOrTx) {
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

/** A profile's learning settings (profile_settings, Phase 12): retention, new cards, budget, goal, feedback. */
export function learningSettingsRepo(db: DbOrTx, profileId: number) {
	const mine = eq(profileSettings.profileId, profileId);
	return {
		get(): LearningSettings {
			const row = db.select().from(profileSettings).where(mine).get();
			if (row === undefined) throw new Error(`profile_settings row missing for profile ${profileId}`);
			return row;
		},
		update(patch: LearningSettingsPatch): LearningSettings {
			const row = db.update(profileSettings).set(patch).where(mine).returning().get();
			if (row === undefined) throw new Error(`profile_settings row missing for profile ${profileId}`);
			return row;
		}
	};
}
