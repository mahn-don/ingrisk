/**
 * A random id for one session's results (idempotent finish). Not crypto.randomUUID(): that exists
 * only in secure contexts, and the app is served over plain HTTP.
 */
export function newClientSessionId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
