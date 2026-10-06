import type { RequestHandler } from './$types';
import { appEngineDeps } from '#lib/server/placement/app.js';
import { startPlacement } from '#lib/server/placement/engine.js';
import { StartBody, placementResponse, readBody } from '#lib/server/placement/http.js';

// Resume the attempt in progress or start one; `restart: true` abandons the one in progress.
export const POST: RequestHandler = ({ request }) =>
	placementResponse(async () => startPlacement(appEngineDeps(), await readBody(request, StartBody)));
