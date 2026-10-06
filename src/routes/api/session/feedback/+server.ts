import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/client.js';
import { markFeedbackSeen } from '#lib/server/session/engine.js';
import { FeedbackSeenBody, readBody, sessionResponse } from '#lib/server/session/http.js';

// A feedback card was dismissed: it is not shown again.
export const POST: RequestHandler = ({ request }) =>
	sessionResponse(async () => {
		markFeedbackSeen(getDb(), new Date(), (await readBody(request, FeedbackSeenBody)).submissionId);
		return { ok: true };
	});
