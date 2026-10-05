import type { RequestHandler } from './$types';
import { appEngineDeps } from '#lib/server/placement/app.js';
import { answerPlacement } from '#lib/server/placement/engine.js';
import { AnswerBody, placementResponse, readBody } from '#lib/server/placement/http.js';

// One answer (Part A or B); the response is the next item.
export const POST: RequestHandler = ({ request }) =>
	placementResponse(async () => answerPlacement(appEngineDeps(), await readBody(request, AnswerBody)));
