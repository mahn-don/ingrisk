import { getDb } from '#lib/server/db/client.js';
import { counts } from '#lib/server/srs/queue.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ counts: counts(getDb(), new Date()) });
