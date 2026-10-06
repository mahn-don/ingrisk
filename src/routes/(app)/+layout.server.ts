import type { LayoutServerLoad } from './$types';

// NOT a security boundary. Authentication is enforced in src/hooks.server.ts for every request
// (layout loads do not run for +server.ts endpoints). This only exposes session info to pages:
// the expiry, and the current profile for the header (null on /profiles before one is picked).
export const load: LayoutServerLoad = ({ locals }) => ({
	sessionExpiresAt: locals.session?.expiresAt.toISOString() ?? null,
	profile: locals.profile
});
