import { profileIdOf } from '#lib/server/auth/profile.js';
import { appEngineDeps } from '#lib/server/placement/app.js';
import { currentPlacement } from '#lib/server/placement/engine.js';
import type { PageServerLoad } from './$types';

// The attempt in progress (resumed where it stopped), or null: the page then offers to start.
// `?restart` (from Settings) shows the start screen; starting there abandons the old attempt.
export const load: PageServerLoad = ({ url, locals }) => {
	const restart = url.searchParams.has('restart');
	return { restart, view: restart ? null : currentPlacement(appEngineDeps(profileIdOf(locals))) };
};
