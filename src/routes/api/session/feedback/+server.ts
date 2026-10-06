import type { RequestHandler } from './$types';
import { profileIdOf } from '#lib/server/auth/profile.js';
import { getDb } from '#lib/server/db/client.js';
import { markFeedbackSeen } from '#lib/server/session/engine.js';
import { FeedbackSeenBody, readBody, sessionResponse } from '#lib/server/session/http.js';

// A feedback card was dismissed: it is not shown again.
export const POST: RequestHandler = ({ request, locals }) => {
	const profileId = profileIdOf(locals);
	return sessionResponse(async () => {
		markFeedbackSeen(getDb(), profileId, new Date(), (await readBody(request, FeedbackSeenBody)).submissionId);
		return { ok: true };
	});
};
