import { fail, redirect } from '@sveltejs/kit';
import { clearSessionCookie } from '#lib/server/auth/cookies.js';
import { getAuthConfig } from '#lib/server/auth/index.js';
import { sanitizeNext } from '#lib/server/auth/next.js';
import { SESSION_COOKIE, deleteSession, selectProfile } from '#lib/server/auth/sessions.js';
import { getDb } from '#lib/server/db/client.js';
import { profilesRepo } from '#lib/server/db/repositories/profiles.js';
import { archiveProfile, createProfile, parseProfileForm, profileCards, renameProfile } from '#lib/server/profiles/index.js';
import type { Actions, PageServerLoad } from './$types';

// The profile picker (Phase 12). Logged in without a profile, every page redirects here
// (src/hooks.server.ts); "Đổi hồ sơ" in the header comes here too.
export const load: PageServerLoad = ({ locals, url }) => ({
	profiles: profileCards(getDb(), new Date()),
	currentId: locals.profile?.id ?? null,
	next: sanitizeNext(url.searchParams.get('next'))
});

const idOf = (form: FormData) => {
	const id = Number(form.get('id'));
	return Number.isInteger(id) && id > 0 ? id : null;
};

export const actions: Actions = {
	/** Learn as this profile: the login session remembers it. Then the page first asked for (`next`). */
	select: async ({ request, cookies }) => {
		const form = await request.formData();
		const id = idOf(form);
		const db = getDb();
		if (id === null || profilesRepo(db).activeById(id) === undefined) return fail(404, { error: 'not_found' as const });
		selectProfile(db, cookies.get(SESSION_COOKIE), id);
		const next = sanitizeNext(String(form.get('next') ?? ''));
		redirect(303, next.startsWith('/profiles') ? '/' : next);
	},
	/** A new profile starts like a fresh install (Home offers the placement test or the basics). */
	create: async ({ request, cookies }) => {
		const parsed = parseProfileForm(await request.formData());
		if (!parsed.ok) return fail(400, { error: 'invalid' as const, form: 'create' as const });
		const db = getDb();
		const created = createProfile(db, parsed.value, new Date());
		if (!created.ok) return fail(409, { error: created.error, form: 'create' as const });
		selectProfile(db, cookies.get(SESSION_COOKIE), created.profile.id);
		redirect(303, '/');
	},
	rename: async ({ request }) => {
		const form = await request.formData();
		const id = idOf(form);
		const parsed = parseProfileForm(form);
		if (id === null) return fail(404, { error: 'not_found' as const, form: 'edit' as const });
		if (!parsed.ok) return fail(400, { error: 'invalid' as const, form: 'edit' as const, id });
		const saved = renameProfile(getDb(), id, parsed.value);
		if (!saved.ok) return fail(saved.error === 'name_taken' ? 409 : 404, { error: saved.error, form: 'edit' as const, id });
		return { done: 'saved' as const };
	},
	/** Hidden from the picker; the data stays (no hard delete). */
	archive: async ({ request }) => {
		const id = idOf(await request.formData());
		if (id === null || !archiveProfile(getDb(), id, new Date())) return fail(404, { error: 'not_found' as const });
		return { done: 'archived' as const };
	},
	logout: ({ cookies }) => {
		deleteSession(getDb(), cookies.get(SESSION_COOKIE));
		clearSessionCookie(cookies, getAuthConfig().cookieSecure);
		redirect(303, '/login');
	}
};
