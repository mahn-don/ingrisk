import { verify } from '@node-rs/argon2';
import { fail, redirect } from '@sveltejs/kit';
import { setSessionCookie } from '#lib/server/auth/cookies.js';
import { getAuthConfig } from '#lib/server/auth/index.js';
import { sanitizeNext } from '#lib/server/auth/next.js';
import { createLoginLimiter } from '#lib/server/auth/rate-limit.js';
import { createSession } from '#lib/server/auth/sessions.js';
import { getDb } from '#lib/server/db/client.js';
import type { Actions, PageServerLoad } from './$types';

/** One limiter for the process: 5 failures per IP per 10 minutes. */
const limiter = createLoginLimiter();
/** Every failure waits this long, so timing says nothing and guessing is slow. */
const FAILURE_DELAY_MS = 300;
const MAX_PASSWORD_LENGTH = 1024;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const load: PageServerLoad = ({ locals, url }) => {
	const next = sanitizeNext(url.searchParams.get('next'));
	if (locals.session !== null) redirect(303, next);
	const config = getAuthConfig();
	return { configured: config.passwordHash !== null, insecure: config.insecureRemote, next };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const config = getAuthConfig();
		if (config.passwordHash === null) return fail(503, { error: 'notConfigured' as const });
		const ip = getClientAddress();
		if (limiter.blocked(ip, Date.now())) return fail(429, { error: 'tooMany' as const });

		const form = await request.formData();
		const password = String(form.get('password') ?? '');
		const next = sanitizeNext(String(form.get('next') ?? ''));
		let ok = false;
		if (password !== '' && password.length <= MAX_PASSWORD_LENGTH) {
			try {
				ok = await verify(config.passwordHash, password);
			} catch {
				ok = false;
			}
		}
		if (!ok) {
			limiter.recordFailure(ip, Date.now());
			await sleep(FAILURE_DELAY_MS);
			return fail(400, { error: 'wrong' as const });
		}
		limiter.reset(ip);
		const { token, expiresAt } = createSession(getDb(), new Date());
		setSessionCookie(cookies, token, expiresAt, config.cookieSecure);
		redirect(303, next);
	}
};
