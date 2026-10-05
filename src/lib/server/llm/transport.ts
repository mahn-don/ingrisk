// HTTP transport: timeout, retry with backoff (honouring Retry-After), per-attempt reporting.
import { LlmBadResponseError, LlmHttpError, LlmRetriesExhaustedError } from './errors.ts';
import type { HttpRequest } from './wire.ts';

export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_ATTEMPTS = 3;
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 504, 529]);
const BASE_BACKOFF_MS = 1_000;
const MAX_WAIT_MS = 60_000;

export interface TransportDeps {
	fetch: typeof globalThis.fetch;
	sleep: (ms: number) => Promise<void>;
	/** Uniform [0, 1); used for backoff jitter. */
	random: () => number;
	/** Milliseconds, for latency. */
	clock: () => number;
	timeoutMs: number;
}

export const defaultTransportDeps = (): TransportDeps => ({
	fetch: (...args) => globalThis.fetch(...args),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	random: Math.random,
	clock: () => performance.now(),
	timeoutMs: DEFAULT_TIMEOUT_MS
});

export interface AttemptReport {
	ok: boolean;
	httpStatus: number | null;
	errorCode: string | null;
	latencyMs: number;
}

export interface TransportResult {
	status: number;
	body: unknown;
	latencyMs: number;
}

/**
 * Seconds or an HTTP date, as milliseconds to wait (capped at 60 s); undefined when absent or
 * unparsable.
 */
export function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
	if (value === null || value.trim() === '') return undefined;
	const seconds = Number(value);
	const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - nowMs;
	return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_WAIT_MS) : undefined;
}

/** Exponential backoff with jitter: ~1 s, ~2 s, ~4 s (each ±50 %). */
export function backoffMs(attempt: number, random: () => number): number {
	return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1) * (0.5 + random()), MAX_WAIT_MS);
}

/** The provider's error message from a JSON error body, if there is one (short). */
function providerMessage(body: string): string {
	try {
		const parsed = JSON.parse(body) as { error?: { message?: unknown; type?: unknown } | string };
		const error = parsed.error;
		if (typeof error === 'string') return error.slice(0, 300);
		if (error && typeof error.message === 'string') return error.message.slice(0, 300);
	} catch {
		// not JSON
	}
	return body.slice(0, 200);
}

/**
 * POST `request` as JSON. Retries network errors, timeouts and 429/5xx/529 up to MAX_ATTEMPTS,
 * waiting Retry-After when given, else exponential backoff with jitter. Other 4xx fail at once.
 * `onAttempt` is called for every failed attempt; the caller reports the successful one, which it
 * can only judge after parsing.
 */
export async function postJson(
	request: HttpRequest,
	onAttempt: (report: AttemptReport) => void,
	deps: TransportDeps
): Promise<TransportResult> {
	let lastDetail = '';
	let lastStatus: number | null = null;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		const started = deps.clock();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
		let wait: number | undefined;
		try {
			const response = await deps.fetch(request.url, {
				method: 'POST',
				headers: request.headers,
				body: JSON.stringify(request.body),
				signal: controller.signal
			});
			const text = await response.text();
			const latencyMs = Math.round(deps.clock() - started);
			if (response.ok) {
				try {
					return { status: response.status, body: JSON.parse(text), latencyMs };
				} catch {
					onAttempt({ ok: false, httpStatus: response.status, errorCode: 'bad_response', latencyMs });
					throw new LlmBadResponseError(`HTTP ${response.status} with a non-JSON body`);
				}
			}
			lastStatus = response.status;
			lastDetail = `HTTP ${response.status}: ${providerMessage(text)}`;
			onAttempt({ ok: false, httpStatus: response.status, errorCode: `http_${response.status}`, latencyMs });
			if (!RETRYABLE_STATUSES.has(response.status)) throw new LlmHttpError(response.status, lastDetail);
			wait = parseRetryAfter(response.headers.get('retry-after'), Date.now());
		} catch (error) {
			if (error instanceof LlmHttpError || error instanceof LlmBadResponseError) throw error;
			const timedOut = controller.signal.aborted;
			lastStatus = null;
			lastDetail = timedOut ? `timed out after ${deps.timeoutMs} ms` : `network error: ${(error as Error).message}`;
			onAttempt({
				ok: false,
				httpStatus: null,
				errorCode: timedOut ? 'timeout' : 'network',
				latencyMs: Math.round(deps.clock() - started)
			});
		} finally {
			clearTimeout(timer);
		}
		if (attempt < MAX_ATTEMPTS) await deps.sleep(wait ?? backoffMs(attempt, deps.random));
	}
	throw new LlmRetriesExhaustedError(MAX_ATTEMPTS, lastStatus, lastDetail);
}
