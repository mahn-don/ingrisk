import type { RequestHandler } from './$types';
import { appEngineDeps } from '#lib/server/placement/app.js';
import { submitPlacementWriting } from '#lib/server/placement/engine.js';
import { WritingBody, placementResponse, readBody } from '#lib/server/placement/http.js';

// Part C: the writing sample (graded for up to 30 s) or `skip: true`; finishes the attempt.
export const POST: RequestHandler = ({ request }) =>
	placementResponse(async () => submitPlacementWriting(appEngineDeps(), await readBody(request, WritingBody)));
