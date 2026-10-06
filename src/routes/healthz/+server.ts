import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/client.js';
import { checkHealth } from '#lib/server/health.js';

// Public on purpose (src/lib/server/auth/guard.ts): the deploy scripts poll it after a restart.
export const GET: RequestHandler = () => {
	const health = checkHealth(getDb);
	return json(health.body, { status: health.status, headers: { 'cache-control': 'no-store' } });
};
