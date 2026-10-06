// Learner profiles (Phase 12): the /profiles picker. Netflix-style, behind the one app password;
// each profile has its own placement, cards, history, streak and learning settings. Archiving
// hides a profile and keeps its data (there is no hard delete). See plans/phase-12.md.
import { z } from 'zod';
import type { DbOrTx } from '../db/client.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { type ProfileRow, profilesRepo } from '../db/repositories/profiles.ts';
import { sessionsRepo } from '../db/repositories/sessions.ts';
import { computeStreak } from '../progress/streak.ts';

export const MAX_NAME = 30;
/** An emoji is a few code points (skin tones, ZWJ sequences); this is generous. */
export const MAX_EMOJI = 16;

/** What a page may show about the current profile (the header). */
export interface CurrentProfile {
	id: number;
	name: string;
	emoji: string | null;
}

export interface ProfileCard extends CurrentProfile {
	/** The CEFR estimate from the latest placement; null before one. */
	cefr: string | null;
	streak: number;
}

export const ProfileForm = z
	.object({
		name: z.string().trim().min(1).max(MAX_NAME),
		emoji: z
			.string()
			.trim()
			.max(MAX_EMOJI)
			.transform((e) => (e === '' ? null : e))
	})
	.strict();
export type ProfileForm = z.output<typeof ProfileForm>;

export function parseProfileForm(form: FormData): { ok: true; value: ProfileForm } | { ok: false; fields: string[] } {
	const parsed = ProfileForm.safeParse({ name: form.get('name') ?? undefined, emoji: form.get('emoji') ?? '' });
	if (parsed.success) return { ok: true, value: parsed.data };
	return { ok: false, fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0])))] };
}

export const currentProfile = (row: ProfileRow): CurrentProfile => ({ id: row.id, name: row.name, emoji: row.emoji });

/** The picker's grid: every non-archived profile with its level estimate and streak. */
export function profileCards(db: DbOrTx, now: Date): ProfileCard[] {
	return profilesRepo(db)
		.active()
		.map((p) => ({
			...currentProfile(p),
			cefr: profileRepo(db, p.id).get().cefrEstimate,
			streak: computeStreak(sessionsRepo(db, p.id).finishedHistory(), now).current
		}));
}

export type SaveProfileResult = { ok: true; profile: ProfileRow } | { ok: false; error: 'name_taken' | 'not_found' };

/** A new profile starts like a fresh install: no placement, no cards, default learning settings. */
export function createProfile(db: DbOrTx, value: ProfileForm, now: Date): SaveProfileResult {
	const repo = profilesRepo(db);
	if (repo.byName(value.name) !== undefined) return { ok: false, error: 'name_taken' };
	return { ok: true, profile: repo.create(value, now) };
}

export function renameProfile(db: DbOrTx, id: number, value: ProfileForm): SaveProfileResult {
	const repo = profilesRepo(db);
	if (repo.activeById(id) === undefined) return { ok: false, error: 'not_found' };
	const other = repo.byName(value.name);
	if (other !== undefined && other.id !== id) return { ok: false, error: 'name_taken' };
	return { ok: true, profile: repo.update(id, value)! };
}

/** Hide the profile from the picker (its data stays). */
export function archiveProfile(db: DbOrTx, id: number, now: Date): boolean {
	return profilesRepo(db).archive(id, now);
}
