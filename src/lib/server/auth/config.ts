// Auth settings from the environment. Fails closed: a missing or malformed password hash means
// nobody can log in, never that everybody can.

export interface AuthConfig {
	/** The argon2id hash from APP_PASSWORD_HASH; null when unset or not an argon2id hash. */
	passwordHash: string | null;
	/** The `secure` flag for cookies. */
	cookieSecure: boolean;
	/** Cookies go over plain HTTP to a non-local origin: the login page shows a notice. */
	insecureRemote: boolean;
	/** Problems to log at startup (never containing the hash). */
	warnings: string[];
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/;

/**
 * COOKIE_SECURE defaults to true. "false" is allowed for any ORIGIN (the app may be served over
 * plain HTTP on an IP address, by the owner's decision); for a non-local ORIGIN that is flagged:
 * a warning at startup and a notice on the login page.
 */
export function authConfig(env: Readonly<Record<string, string | undefined>>): AuthConfig {
	const warnings: string[] = [];
	const raw = env.APP_PASSWORD_HASH?.trim() ?? '';
	let passwordHash: string | null = null;
	if (raw === '') warnings.push('APP_PASSWORD_HASH is not set: login is disabled and every page is closed.');
	else if (!raw.startsWith('$argon2id$')) warnings.push('APP_PASSWORD_HASH is not an argon2id hash (create one with npm run auth:hash): login is disabled.');
	else passwordHash = raw;

	const origin = env.ORIGIN?.trim() ?? '';
	const secureRaw = env.COOKIE_SECURE?.trim().toLowerCase() ?? '';
	let cookieSecure = true;
	let insecureRemote = false;
	if (secureRaw === 'false') {
		cookieSecure = false;
		if (LOCAL_ORIGIN.test(origin)) {
			warnings.push(`COOKIE_SECURE=false: session cookies go over plain HTTP (local ORIGIN ${origin}).`);
		} else {
			insecureRemote = true;
			warnings.push(
				`COOKIE_SECURE=false with ORIGIN ${origin || '(unset)'}: the password and session cookie cross the network unencrypted. Add HTTPS when you can (e.g. Tailscale or a Cloudflare Tunnel).`
			);
		}
	} else if (secureRaw !== '' && secureRaw !== 'true') {
		warnings.push(`COOKIE_SECURE must be true or false (got "${env.COOKIE_SECURE}"); using true.`);
	}
	return { passwordHash, cookieSecure, insecureRemote, warnings };
}
