import { afterEach, describe, expect, it } from 'vitest';
import { LLM_ROUTE_MAX, LLM_ROUTE_WINDOW_MS, createRouteLimiter, llmLimited, rateLimitMessage, resetLlmRouteLimiter } from './route-limit.ts';

afterEach(() => resetLlmRouteLimiter());

describe('LLM route limiter', () => {
	it('allows 60 requests per sliding hour, then refuses with the wait', () => {
		const limiter = createRouteLimiter();
		const t0 = 1_000_000;
		for (let i = 0; i < LLM_ROUTE_MAX; i++) expect(limiter.take(t0 + i * 1000).ok).toBe(true);
		expect(limiter.take(t0 + 61_000)).toEqual({ ok: false, retryAfterMs: LLM_ROUTE_WINDOW_MS - 61_000 });
		// The first request leaves the window after an hour: one more is allowed.
		expect(limiter.take(t0 + LLM_ROUTE_WINDOW_MS).ok).toBe(true);
		expect(limiter.take(t0 + LLM_ROUTE_WINDOW_MS).ok).toBe(false);
	});

	it('answers 429 JSON with a Vietnamese message and Retry-After; refusals do not run the handler', async () => {
		resetLlmRouteLimiter(2);
		let ran = 0;
		const handler = () => {
			ran++;
			return new Response('{}');
		};
		expect((await llmLimited(handler, 0)).status).toBe(200);
		expect((await llmLimited(handler, 1000)).status).toBe(200);
		const refused = await llmLimited(handler, 2000);
		expect(refused.status).toBe(429);
		expect(refused.headers.get('retry-after')).toBe(String((LLM_ROUTE_WINDOW_MS - 2000) / 1000));
		expect(await refused.json()).toEqual({ error: 'rate_limited', message: rateLimitMessage(LLM_ROUTE_WINDOW_MS - 2000) });
		expect(ran).toBe(2);
		expect(rateLimitMessage(90_000)).toBe('Bạn đã dùng tính năng AI 60 lần trong một giờ, đó là giới hạn. Hãy thử lại sau khoảng 2 phút.');
	});
});
