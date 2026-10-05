// The post-login redirect target must be a path on this site, never another origin.

/**
 * `raw` if it is a same-origin relative path ("/stats?x=1"), else "/". Rejects absolute URLs,
 * protocol-relative "//evil.com", backslash tricks ("/\evil.com"), control characters and
 * anything that resolves to another origin; never sends the user back to /login.
 */
export function sanitizeNext(raw: string | null | undefined): string {
	if (raw === null || raw === undefined || raw === '') return '/';
	if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f\u007f]/.test(raw)) return '/';
	const base = 'http://self.invalid';
	let url: URL;
	try {
		url = new URL(raw, base);
	} catch {
		return '/';
	}
	if (url.origin !== base) return '/';
	if (url.pathname === '/login' || url.pathname.startsWith('/login/')) return '/';
	return `${url.pathname}${url.search}${url.hash}`;
}
