// The LLM dependencies the running app uses: the real providers, or (LLM_CANNED=1, tests and
// screenshots only) the canned endpoint from canned-llm.ts. Never a live call in canned mode.
import type { DbOrTx } from '../db/client.ts';
import { getDb } from '../db/client.ts';
import { providersRepo } from '../db/repositories/providers.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import type { LlmDeps } from '../llm/client.ts';
import { defaultTransportDeps } from '../llm/transport.ts';
import { CANNED_MODEL, cannedFetch } from './canned-llm.ts';
import { type GenerationContext, loadGenerationContext } from './context.ts';

type Env = Readonly<Record<string, string | undefined>>;

export const CANNED_PROVIDER = 'canned';

/** LLM_CANNED=1 answers every LLM call with canned responses (e2e tests and screenshots). */
export const cannedLlmEnabled = (env: Env = process.env) => env.LLM_CANNED === '1';

/** Refuse to run canned responses in production: startup throws (src/lib/server/startup.ts). */
export function assertLlmModeAllowed(env: Env = process.env): void {
	if (cannedLlmEnabled(env) && env.NODE_ENV === 'production') {
		throw new Error('LLM_CANNED=1 is for tests only and is refused when NODE_ENV=production');
	}
}

let canned: { fetch: typeof globalThis.fetch; context: GenerationContext } | undefined;

/** The canned provider row, made active (canned mode only: its database is a test one). */
function ensureCannedProvider(db: DbOrTx): void {
	const providers = providersRepo(db);
	if (providers.active()?.name === CANNED_PROVIDER) return;
	const provider = providers.upsert({
		name: CANNED_PROVIDER,
		baseUrl: 'http://localhost:9/v1',
		model: CANNED_MODEL,
		wireFormat: 'openai',
		structuredMode: 'json_schema',
		envKeyName: null
	});
	settingsRepo(db).update({ activeProviderId: provider.id });
}

/** LLM deps for the app database (or `db`), honouring LLM_CANNED. */
export function appLlmDeps(db: DbOrTx = getDb(), env: Env = process.env): LlmDeps {
	if (!cannedLlmEnabled(env)) return { ...defaultTransportDeps(), db, env, now: () => new Date() };
	assertLlmModeAllowed(env);
	ensureCannedProvider(db);
	if (canned === undefined) {
		const context = loadGenerationContext(db);
		canned = {
			context,
			fetch: cannedFetch({ forms: context.forms, blocklist: context.blocklist, isWord: context.isWord, corpus: context.corpus })
		};
	}
	return { ...defaultTransportDeps(), db, env: {}, now: () => new Date(), fetch: canned.fetch };
}

/** Whether an LLM call can be attempted at all: an active provider exists, or canned mode. */
export const llmConfigured = (db: DbOrTx = getDb(), env: Env = process.env) =>
	cannedLlmEnabled(env) || providersRepo(db).active() !== undefined;
