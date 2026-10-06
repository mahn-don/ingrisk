import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/client.js';
import { providerTestDeps } from '#lib/server/generation/app-llm.js';
import { providersRepo } from '#lib/server/db/repositories/providers.js';
import { llmRouteLimiter, rateLimitMessage } from '#lib/server/llm/route-limit.js';
import { smokeTest } from '#lib/server/llm/smoke.js';
import { t } from '#lib/messages/vi.js';
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

/**
 * The provider was deleted elsewhere (another tab, the CLI) while this page was open: a 404 with a
 * Vietnamese message; the page shows it as a toast and reloads the list.
 */
const gone = () => fail(404, { toast: t.settings.providersPage.gone, stale: true });

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
		if (id === null || !deleteProvider(getDb(), id)) return gone();
		return { done: 'deleted' as const };
	},
	active: async ({ request }) => {
		const id = idOf(await request.formData());
		if (id === null || !setActiveProvider(getDb(), id)) return gone();
		return { done: 'active' as const };
	},
	fallback: async ({ request }) => {
		const form = await request.formData();
		const clear = form.get('id') === '';
		const id = clear ? null : idOf(form);
		if ((!clear && id === null) || !setFallbackProvider(getDb(), id)) return gone();
		return { done: 'fallback' as const };
	},
	/** "Kiểm tra kết nối": the smoke call, without fallback; OK or the redacted error, with latency. */
	test: async ({ request }) => {
		const id = idOf(await request.formData());
		const db = getDb();
		if (id === null || providersRepo(db).byId(id) === undefined) return gone();
		const take = llmRouteLimiter().take(Date.now());
		if (!take.ok) return fail(429, { toast: rateLimitMessage(take.retryAfterMs), stale: false });
		const result = await smokeTest(id, providerTestDeps(db));
		return {
			test: result.ok
				? { id, ok: true as const, latencyMs: result.latencyMs, model: result.model }
				: { id, ok: false as const, latencyMs: result.latencyMs, code: result.code, message: result.message }
		};
	}
};
