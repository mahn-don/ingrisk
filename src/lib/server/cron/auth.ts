// Shared-secret check for cron endpoints.
import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest();

/**
 * Does the Authorization header carry `Bearer <secret>`? Both sides are hashed to the same length
 * first, then compared with crypto.timingSafeEqual, so the time taken says nothing about the secret.
 */
export function bearerMatches(header: string | null, secret: string): boolean {
	const presented = /^Bearer (.+)$/.exec(header ?? '')?.[1] ?? '';
	return timingSafeEqual(digest(presented), digest(secret));
}
