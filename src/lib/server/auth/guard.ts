// Who may reach what. The allowlist of public paths is deliberate: anything not listed needs a
// session. Applied in src/hooks.server.ts, the single chokepoint (layouts do not run for
// +server.ts endpoints, so a layout guard would leave /api open).

/**
 * Exact public paths. /healthz (Phase 7) is public on purpose: deploy/deploy.sh and install.sh poll
 * it after a restart, without a session. It answers only {ok, db, migrations} (src/lib/server/health.ts).
 */
const PUBLIC_EXACT = new Set(['/login', '/healthz', '/favicon.svg', '/robots.txt', '/_app/version.json', '/_app/env.js']);

/** Public path prefixes. (Not all of /_app/: /_app/remote/ would be server code.) */
const PUBLIC_PREFIXES = ['/api/cron/', '/_app/immutable/'];

export function isPublicPath(pathname: string): boolean {
	return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export const isApiPath = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/');

/**
 * Logged in but no profile picked yet (Phase 12): every non-public path needs one, except the
 * picker itself. Pages go to /profiles, /api answers 409. Not part of the public allowlist.
 */
export const needsProfile = (pathname: string) => !isPublicPath(pathname) && pathname !== '/profiles' && !pathname.startsWith('/profiles/');

export type Access = 'allow' | 'login' | 'unauthorized' | 'not-configured';

/**
 * - public paths: allow;
 * - auth not configured: pages go to /login (which says so), /api answers 503;
 * - no session: pages go to /login?next=..., /api answers 401;
 * - otherwise allow.
 */
export function accessFor(pathname: string, state: { configured: boolean; authenticated: boolean }): Access {
	if (isPublicPath(pathname)) return 'allow';
	if (!state.configured) return isApiPath(pathname) ? 'not-configured' : 'login';
	if (!state.authenticated) return isApiPath(pathname) ? 'unauthorized' : 'login';
	return 'allow';
}
