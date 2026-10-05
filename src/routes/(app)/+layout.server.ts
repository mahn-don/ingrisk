import type { LayoutServerLoad } from './$types';

// NOT a security boundary. Authentication is enforced in src/hooks.server.ts for every request
// (layout loads do not run for +server.ts endpoints). This only exposes session info to pages.
export const load: LayoutServerLoad = ({ locals }) => ({
	sessionExpiresAt: locals.session?.expiresAt.toISOString() ?? null
});
