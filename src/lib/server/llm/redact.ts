// Scrubbing secrets from anything that might leave the process (errors, logs).

const REDACTED = '[REDACTED]';

const PATTERNS: RegExp[] = [
	// Authorization / x-api-key / api-key header values, in "name: value" or JSON "name":"value" form.
	/((?:authorization|x-api-key|api-key)["']?\s*[:=]\s*["']?)(?:bearer\s+)?[^\s"',}]+/gi,
	/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
	// sk-… shaped tokens (OpenAI, Anthropic and many compatible providers).
	/\bsk-[A-Za-z0-9_-]{8,}/g
];

/** Remove every given secret, auth header value and `sk-…` token from `text`. */
export function redact(text: string, secrets: readonly (string | undefined | null)[] = []): string {
	let out = text;
	for (const secret of secrets) {
		if (secret && secret.length >= 4) out = out.split(secret).join(REDACTED);
	}
	for (const pattern of PATTERNS) {
		out = out.replace(pattern, (match, prefix?: string) =>
			typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}${REDACTED}` : REDACTED
		);
	}
	return out;
}
