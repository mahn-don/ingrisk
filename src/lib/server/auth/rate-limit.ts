// Failed-login limiter: at most `max` failures per IP in a sliding window. In memory, which is
// fine for one process (a restart clears it).

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;

export interface LoginLimiter {
	/** True when the IP already has `max` failures inside the window: refuse without checking. */
	blocked(ip: string, now: number): boolean;
	recordFailure(ip: string, now: number): void;
	/** Forget an IP's failures (after a successful login). */
	reset(ip: string): void;
}

export function createLoginLimiter(max = LOGIN_MAX_FAILURES, windowMs = LOGIN_WINDOW_MS): LoginLimiter {
	const failures = new Map<string, number[]>();
	const recent = (ip: string, now: number) => {
		const kept = (failures.get(ip) ?? []).filter((t) => now - t < windowMs);
		if (kept.length === 0) failures.delete(ip);
		else failures.set(ip, kept);
		return kept;
	};
	return {
		blocked: (ip, now) => recent(ip, now).length >= max,
		recordFailure: (ip, now) => {
			failures.set(ip, [...recent(ip, now), now]);
		},
		reset: (ip) => {
			failures.delete(ip);
		}
	};
}
