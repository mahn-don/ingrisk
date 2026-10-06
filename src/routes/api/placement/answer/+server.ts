import type { RequestHandler } from './$types';
import { profileIdOf } from '#lib/server/auth/profile.js';
import { appEngineDeps } from '#lib/server/placement/app.js';
import { answerPlacement } from '#lib/server/placement/engine.js';
import { AnswerBody, placementResponse, readBody } from '#lib/server/placement/http.js';

// One answer (Part A or B); the response is the next item.
export const POST: RequestHandler = ({ request, locals }) => {
	const deps = appEngineDeps(profileIdOf(locals));
	return placementResponse(async () => answerPlacement(deps, await readBody(request, AnswerBody)));
};
