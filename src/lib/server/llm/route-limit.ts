// Rate limit for the routes that call the LLM (Phase 11): 60 requests per hour in a sliding
// window, in memory (one process, one user; a restart clears it). The cron prefetch is not
// counted: it has its own secret, lock and daily call cap.
import { fill } from '../../format.ts';
import { t } from '../../messages/vi.ts';

export const LLM_ROUTE_MAX = 60;
export const LLM_ROUTE_WINDOW_MS = 60 * 60 * 1000;

export type Take = { ok: true } | { ok: false; retryAfterMs: number };

export interface RouteLimiter {
	/** Count one request now, or refuse it (refusals are not counted). */
	take(now: number): Take;
}

export function createRouteLimiter(max = LLM_ROUTE_MAX, windowMs = LLM_ROUTE_WINDOW_MS): RouteLimiter {
	let hits: number[] = [];
	return {
		take(now) {
			hits = hits.filter((t) => now - t < windowMs);
			if (hits.length >= max) return { ok: false, retryAfterMs: hits[0] + windowMs - now };
			hits.push(now);
			return { ok: true };
		}
	};
}

let limiter = createRouteLimiter();

/** The app's limiter for LLM-backed routes. */
export const llmRouteLimiter = (): RouteLimiter => limiter;

/** Tests only: start from an empty window. */
export function resetLlmRouteLimiter(max = LLM_ROUTE_MAX, windowMs = LLM_ROUTE_WINDOW_MS): void {
	limiter = createRouteLimiter(max, windowMs);
}

/** The Vietnamese message for a refused request. */
export function rateLimitMessage(retryAfterMs: number): string {
	return fill(t.errors.rateLimited, { max: LLM_ROUTE_MAX, minutes: Math.max(1, Math.ceil(retryAfterMs / 60_000)) });
}

/** A 429 JSON answer for the API routes: { error: 'rate_limited', message }. */
export function rateLimitedResponse(retryAfterMs: number): Response {
	return new Response(JSON.stringify({ error: 'rate_limited', message: rateLimitMessage(retryAfterMs) }), {
		status: 429,
		headers: { 'content-type': 'application/json', 'retry-after': String(Math.ceil(retryAfterMs / 1000)) }
	});
}

/** Run an LLM-backed API handler unless the hourly limit is reached. */
export async function llmLimited(handler: () => Promise<Response> | Response, now = Date.now()): Promise<Response> {
	const take = llmRouteLimiter().take(now);
	return take.ok ? handler() : rateLimitedResponse(take.retryAfterMs);
}
