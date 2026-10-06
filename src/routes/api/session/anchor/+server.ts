import type { RequestHandler } from './$types';
import { profileIdOf } from '#lib/server/auth/profile.js';
import { llmLimited } from '#lib/server/llm/route-limit.js';
import { appAnchorDeps } from '#lib/server/session/app.js';
import { submitAnchor } from '#lib/server/session/engine.js';
import { AnchorBody, readBody, sessionResponse } from '#lib/server/session/http.js';

// The Viết task: stored, then graded for up to 30 s (feedback), else { queued: true }.
// LLM-backed: at most 60 requests per hour (src/lib/server/llm/route-limit.ts).
export const POST: RequestHandler = ({ request, locals }) => {
	const deps = appAnchorDeps(profileIdOf(locals));
	return llmLimited(() => sessionResponse(async () => submitAnchor(deps, await readBody(request, AnchorBody))));
};
