// Deterministic checks for error-correction drills.
import type { BlocklistMatcher } from '../blocklist.ts';
import { MAX_DIFF_TOKENS, drillDiff } from './diff.ts';
import type { TopicCode } from './inject.ts';

export interface DrillPayload {
	sentence_with_error: string;
	corrected: string;
	original_span: string;
	corrected_span: string;
	topic_code: TopicCode;
	explanation_vi: string;
	source: 'tatoeba' | 'llm';
	sentence_id?: number;
}

export type DrillRuleCode =
	| 'identical'
	| 'diff_too_large'
	| 'spans_mismatch'
	| 'topic_mismatch'
	| 'blocklisted'
	| 'explanation';

export type DrillRuleResult = { ok: true } | { ok: false; code: DrillRuleCode; detail: string };

const fail = (code: DrillRuleCode, detail: string): DrillRuleResult => ({ ok: false, code, detail });

export const drillRuleReason = (r: Extract<DrillRuleResult, { ok: false }>) => `rule:${r.code} (${r.detail})`;

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `text` with `span` (whole words only) replaced by `replacement`, once per occurrence. */
export function replacements(text: string, span: string, replacement: string): string[] {
	const pattern = new RegExp(`(?<![A-Za-z'])${escape(span)}(?![A-Za-z'])`, 'g');
	return [...text.matchAll(pattern)].map((m) => text.slice(0, m.index) + replacement + text.slice(m.index + span.length));
}

/**
 * Structure checks: the sentences differ in one contiguous region of at most 3 tokens, the spans
 * describe that change (replacing original_span by corrected_span turns the erroneous sentence
 * into the corrected one, and the minimal diff lies inside them), the topic is the requested one,
 * and nothing is on the blocklist.
 */
export function checkDrill(
	drill: Omit<DrillPayload, 'explanation_vi' | 'source'>,
	requested: TopicCode,
	blocklist: Pick<BlocklistMatcher, 'match'>
): DrillRuleResult {
	const diff = drillDiff(drill.sentence_with_error, drill.corrected);
	if (diff === null) return fail('identical', 'no difference');
	if (diff.size > MAX_DIFF_TOKENS) return fail('diff_too_large', `${diff.size} tokens`);
	const spansOk =
		drill.original_span.trim() !== '' &&
		replacements(drill.sentence_with_error, drill.original_span, drill.corrected_span).some((t) => squash(t) === squash(drill.corrected)) &&
		drill.original_span.includes(diff.originalSpan.trim()) &&
		drill.corrected_span.includes(diff.correctedSpan.trim());
	if (!spansOk) return fail('spans_mismatch', `"${drill.original_span}" -> "${drill.corrected_span}"`);
	if (drill.topic_code !== requested) return fail('topic_mismatch', `${drill.topic_code}, wanted ${requested}`);
	const blocked = blocklist.match(drill.sentence_with_error) ?? blocklist.match(drill.corrected);
	if (blocked !== null) return fail('blocklisted', blocked);
	return { ok: true };
}

/** At most 2 sentences, non-empty, short. */
export function checkExplanation(text: string): DrillRuleResult {
	const trimmed = text.trim();
	if (trimmed === '') return fail('explanation', 'empty');
	const sentences = trimmed.split(/(?<=[.!?…])\s+/).filter((s) => s.trim() !== '');
	if (sentences.length > 2) return fail('explanation', `${sentences.length} sentences`);
	if (trimmed.length > 320) return fail('explanation', `${trimmed.length} characters`);
	return { ok: true };
}
