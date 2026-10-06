import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/client.js';
import { finishSession } from '#lib/server/session/engine.js';
import { FinishBody, readBody, sessionResponse } from '#lib/server/session/http.js';

// Every result at once, applied in one transaction; idempotent on clientSessionId.
export const POST: RequestHandler = ({ request }) =>
	sessionResponse(async () => finishSession(getDb(), new Date(), await readBody(request, FinishBody)));
