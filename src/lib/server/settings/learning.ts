// "Học tập" settings: validated with Zod (mirroring the database CHECKs) and saved; every
// session composed afterwards reads them (they apply from the next session).
import { z } from 'zod';
import type { DbOrTx } from '../db/client.ts';
import { type LearningSettings as LearningSettingsRow, learningSettingsRepo } from '../db/repositories/settings.ts';
import { FEEDBACK_MODES } from '../db/schema.ts';

export const BUDGET_CHOICES = [5, 8, 10] as const;

export const LearningSettings = z
	.object({
		desiredRetention: z.coerce
			.number()
			.min(0.7)
			.max(0.97)
			.transform((r) => Math.round(r * 100) / 100),
		newCardsPerDay: z.coerce.number().int().min(0).max(50),
		defaultSessionBudget: z.coerce.number().pipe(z.union([z.literal(5), z.literal(8), z.literal(10)])),
		weeklyGoalDays: z.coerce.number().int().min(1).max(7),
		feedbackMode: z.enum(FEEDBACK_MODES)
	})
	.strict();
export type LearningSettings = z.output<typeof LearningSettings>;

const FIELDS = ['desiredRetention', 'newCardsPerDay', 'defaultSessionBudget', 'weeklyGoalDays', 'feedbackMode'] as const;

/** Parse the form; on failure, the names of the invalid fields. */
export function parseLearningForm(form: FormData): { ok: true; value: LearningSettings } | { ok: false; fields: string[] } {
	const raw = Object.fromEntries(FIELDS.map((f) => [f, form.get(f) ?? undefined]));
	const parsed = LearningSettings.safeParse(raw);
	if (parsed.success) return { ok: true, value: parsed.data };
	return { ok: false, fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0])))] };
}

/** Saved for this profile only (profile_settings, Phase 12). */
export function saveLearningSettings(db: DbOrTx, profileId: number, value: LearningSettings): LearningSettingsRow {
	return learningSettingsRepo(db, profileId).update(value);
}
