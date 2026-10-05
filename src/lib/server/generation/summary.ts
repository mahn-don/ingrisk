// The run summary shared by every generator and by prefetch.
import { sha256 } from './random.ts';

export interface GenSummary {
	/** Validated items stored, by stock key (e.g. "cloze", "error:ART", "reading") and band. */
	added: Record<string, Record<number, number>>;
	/** Items stored as rejected, by reason code (e.g. "rule:diff_too_large", "critic:no_error_found"). */
	rejected: Record<string, number>;
	/** Items not stored because an LLM call failed or left them out (a later run retries them). */
	llmFailed: Record<string, number>;
	/** Items not attempted because the call budget ran out. */
	notRun: number;
}

export const emptySummary = (): GenSummary => ({ added: {}, rejected: {}, llmFailed: {}, notRun: 0 });

export function countAdded(summary: GenSummary, key: string, band: number, n = 1): void {
	const bands = (summary.added[key] ??= {});
	bands[band] = (bands[band] ?? 0) + n;
}

export function countIn(counts: Record<string, number>, key: string, n = 1): void {
	counts[key] = (counts[key] ?? 0) + n;
}

export function mergeSummary(into: GenSummary, from: GenSummary): GenSummary {
	for (const [key, bands] of Object.entries(from.added)) {
		for (const [band, n] of Object.entries(bands)) countAdded(into, key, Number(band), n);
	}
	for (const [reason, n] of Object.entries(from.rejected)) countIn(into.rejected, reason, n);
	for (const [reason, n] of Object.entries(from.llmFailed)) countIn(into.llmFailed, reason, n);
	into.notRun += from.notRun;
	return into;
}

/** The reason code without its detail: "critic:several_errors (2)" -> "critic:several_errors". */
export const reasonCode = (reason: string) => reason.replace(/ \(.*\)$/, '');

/** generated_cache.params_hash: the generation parameters that define a stock (kind + params). */
export function paramsHash(kind: string, params: Record<string, string | number>): string {
	const canonical = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
	return sha256(`${kind}|${JSON.stringify(canonical)}`);
}

export function formatSummary(summary: GenSummary): string[] {
	const fmt = (r: Record<string, number>) =>
		Object.entries(r)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${k} ${v}`)
			.join(', ') || 'none';
	const lines = ['added (validated, by kind and band):'];
	const keys = Object.keys(summary.added).sort();
	if (keys.length === 0) lines.push('  none');
	for (const key of keys) {
		const bands = Object.entries(summary.added[key]).map(([b, n]) => `b${b} ${n}`);
		lines.push(`  ${key}: ${bands.join(', ')}`);
	}
	lines.push(`rejected: ${fmt(summary.rejected)}`);
	lines.push(`not stored (LLM failure, retried next run): ${fmt(summary.llmFailed)}`);
	lines.push(`not attempted (call budget reached): ${summary.notRun}`);
	return lines;
}
