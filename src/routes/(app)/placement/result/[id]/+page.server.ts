import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/client.js';
import { resultView } from '#lib/server/placement/results.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const result = /^\d{1,9}$/.test(params.id) ? resultView(getDb(), Number(params.id)) : null;
	if (result === null) error(404);
	return { result };
};
