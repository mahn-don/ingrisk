import { getDb } from '#lib/server/db/client.js';
import { loadProgress } from '#lib/server/progress/index.js';
import type { PageServerLoad } from './$types';

// Everything is recomputed from the history on each visit (no stored streak state).
export const load: PageServerLoad = () => ({ progress: loadProgress(getDb(), new Date()) });
