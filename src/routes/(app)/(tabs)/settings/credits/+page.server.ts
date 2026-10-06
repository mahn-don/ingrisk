import { getDb } from '#lib/server/db/client.js';
import { credits } from '#lib/server/settings/credits.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ credits: credits(getDb()) });
