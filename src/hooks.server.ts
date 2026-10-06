import { json, redirect } from '@sveltejs/kit';
import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { getAuthConfig } from '#lib/server/auth/index.js';
import { clearSessionCookie, setSessionCookie } from '#lib/server/auth/cookies.js';
import { accessFor, isApiPath, needsProfile } from '#lib/server/auth/guard.js';
import { SESSION_COOKIE, resolveSession } from '#lib/server/auth/sessions.js';
import { getDb } from '#lib/server/db/client.js';
import { profilesRepo } from '#lib/server/db/repositories/profiles.js';
import { currentProfile } from '#lib/server/profiles/index.js';
import { startServer } from '#lib/server/startup.js';
import { THEME_COOKIE, parseTheme } from '#lib/theme.js';

// Runs before the first request. A migration error throws here, and adapter-node awaits
// init at startup, so the server refuses to start instead of serving a broken database.
// Skipped while building (`vite build` analyses the app): it must not open or migrate data/app.db.
export const init: ServerInit = () => {
	if (building) return;
	startServer();
	getAuthConfig();
};

/**
 * THE auth chokepoint. Every request (pages, form actions, data requests and +server.ts
 * endpoints alike) passes here; only paths on the allowlist in auth/guard.ts skip the session
 * check. Layouts are not a security boundary: they do not run for endpoints.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const config = getAuthConfig();
	const token = event.cookies.get(SESSION_COOKIE);
	event.locals.session = null;
	event.locals.profile = null;
	if (token !== undefined) {
		const session = config.passwordHash === null ? null : resolveSession(getDb(), token, new Date());
		if (session === null) clearSessionCookie(event.cookies, config.cookieSecure);
		else {
			event.locals.session = { expiresAt: session.expiresAt, profileId: session.profileId };
			// An archived profile no longer counts: back to the picker.
			const profile = session.profileId === null ? undefined : profilesRepo(getDb()).activeById(session.profileId);
			if (profile !== undefined) event.locals.profile = currentProfile(profile);
			if (session.refreshed) setSessionCookie(event.cookies, token, session.expiresAt, config.cookieSecure);
		}
	}
	event.locals.theme = parseTheme(event.cookies.get(THEME_COOKIE));

	const { pathname } = event.url;
	const access = accessFor(pathname, { configured: config.passwordHash !== null, authenticated: event.locals.session !== null });
	if (access === 'unauthorized') return json({ error: 'unauthorized' }, { status: 401 });
	if (access === 'not-configured') return json({ error: 'login is not configured' }, { status: 503 });
	// (url.search is read only here: prerendered public pages may not touch it.)
	if (access === 'login') redirect(303, config.passwordHash === null ? '/login' : `/login?next=${encodeURIComponent(pathname + event.url.search)}`);
	if (event.locals.session !== null && event.locals.profile === null && needsProfile(pathname)) {
		if (isApiPath(pathname)) return json({ error: 'no_profile' }, { status: 409 });
		// Back to the page asked for once a profile is picked (sanitized there, like /login's next).
		redirect(303, pathname === '/' ? '/profiles' : `/profiles?next=${encodeURIComponent(pathname + event.url.search)}`);
	}

	const theme = event.locals.theme;
	return resolve(event, { transformPageChunk: ({ html }) => html.replace('%theme%', theme) });
};
