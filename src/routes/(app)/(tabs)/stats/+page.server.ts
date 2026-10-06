import { profileIdOf } from '#lib/server/auth/profile.js';
import { getDb } from '#lib/server/db/client.js';
import { loadProgress } from '#lib/server/progress/index.js';
import type { PageServerLoad } from './$types';

// Everything is recomputed from the history on each visit (no stored streak state).
export const load: PageServerLoad = ({ locals }) => ({ progress: loadProgress(getDb(), profileIdOf(locals), new Date()) });
