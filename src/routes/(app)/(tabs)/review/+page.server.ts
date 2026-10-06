import { fail } from '@sveltejs/kit';
import { profileIdOf } from '#lib/server/auth/profile.js';
import { getDb } from '#lib/server/db/client.js';
import { cardDetail, hardList, learnedList, reviewNow, setSuspended } from '#lib/server/review-book/index.js';
import type { Actions, PageServerLoad } from './$types';

// The review book: ?tab=hard|learned, ?q= (search, "Đã học"), ?card=ID (the detail sheet).
export const load: PageServerLoad = ({ url, locals }) => {
	const db = getDb();
	const profileId = profileIdOf(locals);
	const now = new Date();
	const tab = url.searchParams.get('tab') === 'learned' ? ('learned' as const) : ('hard' as const);
	const q = tab === 'learned' ? (url.searchParams.get('q') ?? '').trim().slice(0, 100) : '';
	const cardId = Number(url.searchParams.get('card'));
	return {
		tab,
		q,
		rows: tab === 'hard' ? hardList(db, profileId, now) : learnedList(db, profileId, now, q),
		detail: Number.isInteger(cardId) && cardId > 0 ? cardDetail(db, profileId, now, cardId) : null,
		cardRequested: url.searchParams.has('card')
	};
};

const cardIdOf = async (request: Request) => {
	const id = Number((await request.formData()).get('cardId'));
	return Number.isInteger(id) && id > 0 ? id : null;
};

export const actions: Actions = {
	/** "Ôn ngay": due now. */
	reviewNow: async ({ request, locals }) => {
		const id = await cardIdOf(request);
		if (id === null || !reviewNow(getDb(), profileIdOf(locals), new Date(), id)) return fail(404, { done: null });
		return { done: 'reviewNow' as const, cardId: id };
	},
	suspend: async ({ request, locals }) => {
		const id = await cardIdOf(request);
		if (id === null || !setSuspended(getDb(), profileIdOf(locals), id, true)) return fail(404, { done: null });
		return { done: 'suspended' as const, cardId: id };
	},
	unsuspend: async ({ request, locals }) => {
		const id = await cardIdOf(request);
		if (id === null || !setSuspended(getDb(), profileIdOf(locals), id, false)) return fail(404, { done: null });
		return { done: 'unsuspended' as const, cardId: id };
	}
};
