import type { RequestHandler } from './$types';
import { llmLimited } from '#lib/server/llm/route-limit.js';
import { appEngineDeps } from '#lib/server/placement/app.js';
import { submitPlacementWriting } from '#lib/server/placement/engine.js';
import { WritingBody, placementResponse, readBody } from '#lib/server/placement/http.js';

// Part C: the writing sample (graded for up to 30 s) or `skip: true`; finishes the attempt.
// LLM-backed: at most 60 requests per hour (src/lib/server/llm/route-limit.ts). Skipping the
// writing calls no LLM and is never refused.
export const POST: RequestHandler = async ({ request }) => {
	const skip = ((await request.clone().json().catch(() => null)) as { skip?: unknown } | null)?.skip === true;
	const run = () => placementResponse(async () => submitPlacementWriting(appEngineDeps(), await readBody(request, WritingBody)));
	return skip ? run() : llmLimited(run);
};
