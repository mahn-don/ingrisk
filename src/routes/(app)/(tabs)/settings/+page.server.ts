import { fail, redirect } from '@sveltejs/kit';
import { clearSessionCookie, setThemeCookie } from '#lib/server/auth/cookies.js';
import { getAuthConfig } from '#lib/server/auth/index.js';
import { SESSION_COOKIE, deleteSession } from '#lib/server/auth/sessions.js';
import { getDb } from '#lib/server/db/client.js';
import { placementRepo } from '#lib/server/db/repositories/placement.js';
import { THEMES, type Theme } from '#lib/theme.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const latest = placementRepo(getDb()).latestResult();
	return { placement: latest === undefined ? null : { id: latest.id, cefr: latest.cefr, takenAt: latest.takenAt.getTime() } };
};

export const actions: Actions = {
	theme: async ({ request, cookies }) => {
		const value = (await request.formData()).get('theme');
		if (typeof value !== 'string' || !(THEMES as readonly string[]).includes(value)) return fail(400);
		setThemeCookie(cookies, value as Theme, getAuthConfig().cookieSecure);
		return { theme: value };
	},
	logout: ({ cookies }) => {
		deleteSession(getDb(), cookies.get(SESSION_COOKIE));
		clearSessionCookie(cookies, getAuthConfig().cookieSecure);
		redirect(303, '/login');
	}
};
