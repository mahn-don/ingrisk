import type { RequestHandler } from './$types';
import { appAnchorDeps } from '#lib/server/session/app.js';
import { submitAnchor } from '#lib/server/session/engine.js';
import { AnchorBody, readBody, sessionResponse } from '#lib/server/session/http.js';

// The Viết task: stored, then graded for up to 30 s (feedback), else { queued: true }.
export const POST: RequestHandler = ({ request }) => sessionResponse(async () => submitAnchor(appAnchorDeps(), await readBody(request, AnchorBody)));
