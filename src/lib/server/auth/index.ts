// The app's auth settings, read once from process.env (warnings logged once).
import { type AuthConfig, authConfig } from './config.ts';

let cached: AuthConfig | undefined;

export function getAuthConfig(): AuthConfig {
	if (cached === undefined) {
		cached = authConfig(process.env);
		for (const warning of cached.warnings) console.warn(`[auth] ${warning}`);
	}
	return cached;
}
