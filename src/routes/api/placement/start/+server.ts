import type { RequestHandler } from './$types';
import { profileIdOf } from '#lib/server/auth/profile.js';
import { appEngineDeps } from '#lib/server/placement/app.js';
import { startPlacement } from '#lib/server/placement/engine.js';
import { StartBody, placementResponse, readBody } from '#lib/server/placement/http.js';

// Resume the attempt in progress or start one; `restart: true` abandons the one in progress.
export const POST: RequestHandler = ({ request, locals }) => {
	const deps = appEngineDeps(profileIdOf(locals));
	return placementResponse(async () => startPlacement(deps, await readBody(request, StartBody)));
};
