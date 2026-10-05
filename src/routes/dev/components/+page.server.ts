import { error } from '@sveltejs/kit';
import { dev } from '$app/env';
import type { PageServerLoad } from './$types';

// A component gallery for development only: production builds answer 404.
export const load: PageServerLoad = () => {
	if (!dev) error(404);
};
