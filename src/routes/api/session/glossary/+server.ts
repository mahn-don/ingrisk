import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/client.js';
import { addGlossaryCard } from '#lib/server/session/engine.js';
import { GlossaryBody, readBody, sessionResponse } from '#lib/server/session/http.js';

// "Thêm vào ôn tập": a card for a glossary word of the session's passage.
export const POST: RequestHandler = ({ request }) =>
	sessionResponse(async () => addGlossaryCard(getDb(), new Date(), await readBody(request, GlossaryBody)));
