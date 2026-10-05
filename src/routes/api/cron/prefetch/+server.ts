import type { RequestHandler } from './$types';
import { getDb } from '#lib/server/db/client.js';
import { handlePrefetch } from '#lib/server/cron/prefetch-endpoint.js';
import { runPrefetch } from '#lib/server/cron/prefetch-run.js';

// Called by cron with `Authorization: Bearer $CRON_SECRET`; runs synchronously and returns the summary.
export const POST: RequestHandler = ({ request }) =>
	handlePrefetch(request, {
		env: process.env,
		db: getDb(),
		now: () => new Date(),
		run: runPrefetch,
		log: (message) => console.error(message)
	});
