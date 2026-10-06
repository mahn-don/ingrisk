import type { RequestHandler } from './$types';
import { profileIdOf } from '#lib/server/auth/profile.js';
import { getDb } from '#lib/server/db/client.js';
import { addGlossaryCard } from '#lib/server/session/engine.js';
import { GlossaryBody, readBody, sessionResponse } from '#lib/server/session/http.js';

// "Thêm vào ôn tập": a card for a glossary word of the session's passage.
export const POST: RequestHandler = ({ request, locals }) => {
	const profileId = profileIdOf(locals);
	return sessionResponse(async () => addGlossaryCard(getDb(), profileId, new Date(), await readBody(request, GlossaryBody)));
};
