import { describe, expect, it } from 'vitest';
import { learningSettingsRepo } from '../db/repositories/settings.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { profilesRepo } from '../db/repositories/profiles.ts';
import { sessionsRepo } from '../db/repositories/sessions.ts';
import { TEST_PROFILE, createTestDb } from '../db/test-db.ts';
import { archiveProfile, createProfile, parseProfileForm, profileCards, renameProfile } from './index.ts';

const T0 = new Date('2026-10-05T02:00:00Z');
const form = (fields: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
};

describe('parseProfileForm', () => {
	it('trims, allows an empty emoji, and limits the lengths', () => {
		expect(parseProfileForm(form({ name: '  Bé Na ', emoji: ' 🐱 ' }))).toEqual({ ok: true, value: { name: 'Bé Na', emoji: '🐱' } });
		expect(parseProfileForm(form({ name: 'An', emoji: '' }))).toEqual({ ok: true, value: { name: 'An', emoji: null } });
		expect(parseProfileForm(form({ name: '   ' }))).toEqual({ ok: false, fields: ['name'] });
		expect(parseProfileForm(form({ name: 'x'.repeat(31), emoji: 'y'.repeat(17) }))).toEqual({ ok: false, fields: ['name', 'emoji'] });
	});
});

describe('profiles', () => {
	it('a new profile starts like a fresh install: no placement, band 1, default settings', () => {
		const db = createTestDb();
		learningSettingsRepo(db, TEST_PROFILE).update({ newCardsPerDay: 20 });
		profileRepo(db, TEST_PROFILE).update({ cefrEstimate: 'B1', knownBandCeiling: 4 }, T0);
		const created = createProfile(db, { name: 'Bé', emoji: '🐱' }, T0);
		if (!created.ok) throw new Error(created.error);
		const id = created.profile.id;
		expect(profileRepo(db, id).get()).toMatchObject({ cefrEstimate: null, knownBandCeiling: 1, placementSkippedAt: null });
		expect(learningSettingsRepo(db, id).get()).toMatchObject({ newCardsPerDay: 10, desiredRetention: 0.9 });
		expect(createProfile(db, { name: 'Bé', emoji: null }, T0)).toEqual({ ok: false, error: 'name_taken' });
	});

	it('renames, refuses a taken name, and archives without deleting', () => {
		const db = createTestDb();
		const created = createProfile(db, { name: 'Hai', emoji: null }, T0);
		if (!created.ok) throw new Error(created.error);
		const id = created.profile.id;
		expect(renameProfile(db, id, { name: 'Hồ sơ 1', emoji: null })).toEqual({ ok: false, error: 'name_taken' });
		expect(renameProfile(db, id, { name: 'Hai', emoji: '🦊' })).toMatchObject({ ok: true, profile: { name: 'Hai', emoji: '🦊' } });
		sessionsRepo(db, id).recordFinished({ clientSessionId: 'c', startedAt: T0, finishedAt: T0, itemsDone: 5, budgetMin: 5, shape: 'quick' });
		expect(archiveProfile(db, id, T0)).toBe(true);
		expect(archiveProfile(db, id, T0)).toBe(false);
		expect(profilesRepo(db).activeById(id)).toBeUndefined();
		expect(renameProfile(db, id, { name: 'Ba', emoji: null })).toEqual({ ok: false, error: 'not_found' });
		// The data stays.
		expect(profilesRepo(db).byId(id)?.archivedAt).toEqual(T0);
		expect(sessionsRepo(db, id).finishedHistory()).toHaveLength(1);
	});

	it('the picker shows each active profile with its level and streak', () => {
		const db = createTestDb();
		const created = createProfile(db, { name: 'Hai', emoji: '🦊' }, T0);
		if (!created.ok) throw new Error(created.error);
		profileRepo(db, TEST_PROFILE).update({ cefrEstimate: 'A2' }, T0);
		sessionsRepo(db, created.profile.id).recordFinished({ clientSessionId: 'c', startedAt: T0, finishedAt: T0, itemsDone: 5, budgetMin: 5, shape: 'quick' });
		expect(profileCards(db, T0)).toEqual([
			{ id: TEST_PROFILE, name: 'Hồ sơ 1', emoji: null, cefr: 'A2', streak: 0 },
			{ id: created.profile.id, name: 'Hai', emoji: '🦊', cefr: null, streak: 1 }
		]);
	});
});
