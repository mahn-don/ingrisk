import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/client.js';
import { providerTestDeps } from '#lib/server/generation/app-llm.js';
import { smokeTest } from '#lib/server/llm/smoke.js';
import {
	deleteProvider,
	parseProviderForm,
	providerViews,
	saveProvider,
	setActiveProvider,
	setFallbackProvider
} from '#lib/server/settings/providers.js';
import type { Actions, PageServerLoad } from './$types';

// Providers: the env variable NAME and whether it is set, never a key (src/lib/server/settings/providers.ts).
export const load: PageServerLoad = ({ url }) => {
	const providers = providerViews(getDb());
	const editId = Number(url.searchParams.get('edit'));
	return {
		providers,
		editing: providers.find((p) => p.id === editId) ?? null,
		adding: url.searchParams.has('add'),
		saved: url.searchParams.has('saved')
	};
};

const idOf = (form: FormData) => {
	const id = Number(form.get('id'));
	return Number.isInteger(id) && id > 0 ? id : null;
};

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await request.formData();
		const raw = form.get('id');
		const id = raw === null || raw === '' ? undefined : (idOf(form) ?? -1);
		const parsed = parseProviderForm(form);
		if (!parsed.ok) return fail(400, { save: { error: 'invalid' as const, fields: parsed.fields } });
		const saved = saveProvider(getDb(), parsed.value, id);
		if (!saved.ok) return fail(saved.error === 'name_taken' ? 409 : 404, { save: { error: saved.error, fields: [] as string[] } });
		redirect(303, '/settings/providers?saved');
	},
	delete: async ({ request }) => {
		const id = idOf(await request.formData());
		if (id === null || !deleteProvider(getDb(), id)) return fail(404, { done: null });
		return { done: 'deleted' as const };
	},
	active: async ({ request }) => {
		const id = idOf(await request.formData());
		if (id === null || !setActiveProvider(getDb(), id)) return fail(404, { done: null });
		return { done: 'active' as const };
	},
	fallback: async ({ request }) => {
		const form = await request.formData();
		const id = form.get('id') === '' ? null : idOf(form);
		if (id === null && form.get('id') !== '') return fail(404, { done: null });
		if (!setFallbackProvider(getDb(), id)) return fail(404, { done: null });
		return { done: 'fallback' as const };
	},
	/** "Kiểm tra kết nối": the smoke call, without fallback; OK or the redacted error, with latency. */
	test: async ({ request }) => {
		const id = idOf(await request.formData());
		if (id === null) return fail(404, { done: null });
		const db = getDb();
		const result = await smokeTest(id, providerTestDeps(db));
		return {
			test: result.ok
				? { id, ok: true as const, latencyMs: result.latencyMs, model: result.model }
				: { id, ok: false as const, latencyMs: result.latencyMs, code: result.code, message: result.message }
		};
	}
};
