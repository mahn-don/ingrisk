import { fail, redirect } from '@sveltejs/kit';
import { clearSessionCookie, setThemeCookie } from '#lib/server/auth/cookies.js';
import { profileIdOf } from '#lib/server/auth/profile.js';
import { getAuthConfig } from '#lib/server/auth/index.js';
import { SESSION_COOKIE, deleteSession } from '#lib/server/auth/sessions.js';
import { prefetchRunning, startBackgroundPrefetch } from '#lib/server/cron/prefetch-endpoint.js';
import { runPrefetch } from '#lib/server/cron/prefetch-run.js';
import { getDb } from '#lib/server/db/client.js';
import { placementRepo } from '#lib/server/db/repositories/placement.js';
import { providersRepo } from '#lib/server/db/repositories/providers.js';
import { learningSettingsRepo } from '#lib/server/db/repositories/settings.js';
import { llmConfigured } from '#lib/server/generation/app-llm.js';
import { dailyCapFromEnv } from '#lib/server/generation/budget.js';
import { llmRouteLimiter, rateLimitMessage } from '#lib/server/llm/route-limit.js';
import { stockOverview } from '#lib/server/settings/content.js';
import { parseLearningForm, saveLearningSettings } from '#lib/server/settings/learning.js';
import { usageLastDays } from '#lib/server/settings/usage.js';
import { THEMES, type Theme } from '#lib/theme.js';
import type { Actions, PageServerLoad } from './$types';

// Two parts (Phase 12): this profile's learning settings, placement and AI usage; then what every
// profile shares (theme on this device, content stock, providers, all AI usage, backup, account).
export const load: PageServerLoad = ({ locals }) => {
	const db = getDb();
	const now = new Date();
	const profileId = profileIdOf(locals);
	const latest = placementRepo(db, profileId).latestResult();
	const settings = learningSettingsRepo(db, profileId).get();
	return {
		placement: latest === undefined ? null : { id: latest.id, cefr: latest.cefr, takenAt: latest.takenAt.getTime() },
		learning: {
			desiredRetention: settings.desiredRetention,
			newCardsPerDay: settings.newCardsPerDay,
			defaultSessionBudget: settings.defaultSessionBudget,
			weeklyGoalDays: settings.weeklyGoalDays,
			feedbackMode: settings.feedbackMode
		},
		stock: stockOverview(db),
		generating: prefetchRunning(db, now),
		canGenerate: llmConfigured(db),
		activeProvider: providersRepo(db).active()?.name ?? null,
		usage: usageLastDays(db, now),
		profileUsage: usageLastDays(db, now, { profileId })
	};
};

export const actions: Actions = {
	theme: async ({ request, cookies }) => {
		const value = (await request.formData()).get('theme');
		if (typeof value !== 'string' || !(THEMES as readonly string[]).includes(value)) return fail(400);
		setThemeCookie(cookies, value as Theme, getAuthConfig().cookieSecure);
		return { theme: value };
	},
	/** "Học tập": validated like the database CHECKs; read by the next session composed. */
	learning: async ({ request, locals }) => {
		const parsed = parseLearningForm(await request.formData());
		if (!parsed.ok) return fail(400, { learning: { ok: false as const, fields: parsed.fields } });
		saveLearningSettings(getDb(), profileIdOf(locals), parsed.value);
		return { learning: { ok: true as const, fields: [] as string[] } };
	},
	/** "Tạo thêm bài tập": a prefetch run of at most 30 calls, in the background. */
	generate: () => {
		const db = getDb();
		if (!llmConfigured(db)) return fail(409, { generate: 'no_provider' as const });
		const take = llmRouteLimiter().take(Date.now());
		if (!take.ok) return fail(429, { generate: 'rate_limited' as const, message: rateLimitMessage(take.retryAfterMs) });
		let dailyCap: number;
		try {
			dailyCap = dailyCapFromEnv(process.env);
		} catch {
			return fail(500, { generate: 'no_provider' as const });
		}
		const started = startBackgroundPrefetch({ db, now: () => new Date(), dailyCap, run: runPrefetch, log: (message) => console.error(message) });
		if (started.status === 'locked') return fail(409, { generate: 'locked' as const });
		if (started.status === 'capped') return fail(429, { generate: 'capped' as const, used: started.used, cap: started.cap });
		return { generate: 'started' as const };
	},
	logout: ({ cookies }) => {
		deleteSession(getDb(), cookies.get(SESSION_COOKIE));
		clearSessionCookie(cookies, getAuthConfig().cookieSecure);
		redirect(303, '/login');
	}
};
