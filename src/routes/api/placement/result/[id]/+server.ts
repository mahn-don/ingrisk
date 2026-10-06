import type { RequestHandler } from './$types';
import { profileIdOf } from '#lib/server/auth/profile.js';
import { getDb } from '#lib/server/db/client.js';
import { PlacementError } from '#lib/server/placement/engine.js';
import { placementResponse } from '#lib/server/placement/http.js';
import { resultView } from '#lib/server/placement/results.js';

export const GET: RequestHandler = ({ params, locals }) => {
	const profileId = profileIdOf(locals);
	return placementResponse(() => {
		const id = /^\d{1,9}$/.test(params.id) ? Number(params.id) : 0;
		const view = id > 0 ? resultView(getDb(), profileId, id) : null;
		if (view === null) throw new PlacementError(404, 'not_found', 'no such result');
		return view;
	});
};
