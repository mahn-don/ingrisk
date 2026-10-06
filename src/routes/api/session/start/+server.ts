import type { RequestHandler } from './$types';
import { profileIdOf } from '#lib/server/auth/profile.js';
import { getDb } from '#lib/server/db/client.js';
import { startSession } from '#lib/server/session/engine.js';
import { StartBody, readBody, sessionResponse } from '#lib/server/session/http.js';

// The whole session in one response; abandons the session in progress.
export const POST: RequestHandler = ({ request, locals }) => {
	const profileId = profileIdOf(locals);
	return sessionResponse(async () => startSession(getDb(), profileId, new Date(), await readBody(request, StartBody)));
};
