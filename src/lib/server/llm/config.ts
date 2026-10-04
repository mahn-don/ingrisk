// Loading provider configuration from the database, with the base_url safety rule.
import type { DbOrTx } from '../db/client.ts';
import { providersRepo, type Provider } from '../db/repositories/providers.ts';
import { LlmConfigError, LlmMissingKeyError } from './errors.ts';

export type ProviderConfig = Provider;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * `base_url` must be https, except plain http to localhost / 127.0.0.1 (a local Ollama).
 * Throws LlmConfigError otherwise.
 */
export function assertAllowedBaseUrl(baseUrl: string, providerId?: number): URL {
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw new LlmConfigError(`Invalid base_url: ${baseUrl}`, providerId);
	}
	if (url.protocol === 'https:') return url;
	if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return url;
	throw new LlmConfigError(`base_url must use https (http only for localhost): ${baseUrl}`, providerId);
}

function checked(provider: Provider): ProviderConfig {
	assertAllowedBaseUrl(provider.baseUrl, provider.id);
	if (provider.wireFormat === 'anthropic' && provider.envKeyName === null) {
		throw new LlmConfigError(`Provider ${provider.name} (anthropic) needs env_key_name`, provider.id);
	}
	return provider;
}

/** The provider to call: `providerId` if given, else the active one. Must exist and be enabled. */
export function loadProvider(db: DbOrTx, providerId?: number): ProviderConfig {
	const repo = providersRepo(db);
	const provider = providerId === undefined ? repo.active() : repo.byId(providerId);
	if (provider === undefined) {
		throw new LlmConfigError(
			providerId === undefined ? 'No active LLM provider is configured' : `LLM provider ${providerId} does not exist`
		);
	}
	if (!provider.enabled) throw new LlmConfigError(`LLM provider ${provider.name} is disabled`, provider.id);
	return checked(provider);
}

/** The enabled fallback provider, if any (validated like any other). */
export function loadFallback(db: DbOrTx): ProviderConfig | undefined {
	const provider = providersRepo(db).fallback();
	return provider === undefined ? undefined : checked(provider);
}

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The provider's API key, read from the environment at call time (never cached).
 * Undefined for providers without env_key_name; throws if the variable is unset or empty.
 */
export function readKey(provider: ProviderConfig, env: Env): string | undefined {
	if (provider.envKeyName === null) return undefined;
	const key = env[provider.envKeyName];
	if (key === undefined || key.trim() === '') throw new LlmMissingKeyError(provider.envKeyName, provider.id);
	return key;
}
