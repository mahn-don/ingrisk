import type { RequestHandler } from './$types';
import { profileIdOf } from '#lib/server/auth/profile.js';
import { getDb } from '#lib/server/db/client.js';
import { finishSession } from '#lib/server/session/engine.js';
import { FinishBody, readBody, sessionResponse } from '#lib/server/session/http.js';

// Every result at once, applied in one transaction; idempotent on clientSessionId.
export const POST: RequestHandler = ({ request, locals }) => {
	const profileId = profileIdOf(locals);
	return sessionResponse(async () => finishSession(getDb(), profileId, new Date(), await readBody(request, FinishBody)));
};
