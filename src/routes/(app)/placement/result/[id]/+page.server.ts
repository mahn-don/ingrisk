import { error } from '@sveltejs/kit';
import { profileIdOf } from '#lib/server/auth/profile.js';
import { getDb } from '#lib/server/db/client.js';
import { resultView } from '#lib/server/placement/results.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, locals }) => {
	const result = /^\d{1,9}$/.test(params.id) ? resultView(getDb(), profileIdOf(locals), Number(params.id)) : null;
	if (result === null) error(404);
	return { result };
};
