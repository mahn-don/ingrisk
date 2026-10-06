// Error drills in every non-quick session: 2 from the 5b stock, on the learner's weakest topics.
import type { DbOrTx } from '../db/client.ts';
import { cacheRepo } from '../db/repositories/cache.ts';
import { drillResultsRepo } from '../db/repositories/drill-results.ts';
import { grammarTopicsRepo } from '../db/repositories/grammar-topics.ts';
import { reviewLogsRepo } from '../db/repositories/review-logs.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import type { TOPIC_CODES } from '../db/schema.ts';
import { DRILL_CODES, drillParamsHash } from '../generation/drills/build.ts';
import type { DrillPayload } from '../generation/drills/rules.ts';
import { hashString } from '../generation/random.ts';
import type { DrillItem } from '../../session/types.ts';

export type TopicCode = (typeof TOPIC_CODES)[number];
export const DRILLS_PER_SESSION = 2;
export const WEAKNESS_WINDOW_DAYS = 30;
const DAY = 86_400_000;

/**
 * Errors per topic code over the last 30 days: codes of graded writing errors, lapses (Again) on
 * grammar cloze cards, and missed drills.
 */
export function weaknessProfile(db: DbOrTx, profileId: number, now: Date): Map<TopicCode, number> {
	const since = new Date(now.getTime() - WEAKNESS_WINDOW_DAYS * DAY);
	const profile = new Map<TopicCode, number>();
	const add = (code: TopicCode, n = 1) => profile.set(code, (profile.get(code) ?? 0) + n);
	for (const submission of writingRepo(db, profileId).scoredSince(since)) for (const e of submission.errorsJson ?? []) add(e.topic_code);
	const topics = new Map(grammarTopicsRepo(db).all().map((t) => [t.id, t.code as TopicCode]));
	for (const [topicId, n] of reviewLogsRepo(db, profileId).againByGrammarTopicSince(since)) {
		const code = topics.get(topicId);
		if (code !== undefined) add(code, n);
	}
	for (const missed of drillResultsRepo(db, profileId).missedSince(since)) add(missed.topicCode);
	return profile;
}

/**
 * The topic codes to drill: the weakest codes that have drills in stock, most errors first; then
 * (no errors yet, or not enough stock) other codes with stock in a seeded random order. With a
 * single code in stock, that code twice.
 */
export function chooseDrillCodes(profile: ReadonlyMap<string, number>, inStock: readonly string[], n: number, seed: string): string[] {
	const weak = inStock.filter((c) => (profile.get(c) ?? 0) > 0).sort((a, b) => profile.get(b)! - profile.get(a)! || a.localeCompare(b));
	const rest = inStock.filter((c) => !weak.includes(c)).sort((a, b) => hashString(`${seed}|${a}`) - hashString(`${seed}|${b}`));
	const order = [...weak, ...rest];
	if (order.length === 0) return [];
	return Array.from({ length: n }, (_, i) => order[i % order.length]);
}

function toDrillItem(row: { id: number; payloadJson: unknown }, names: ReadonlyMap<string, string>): DrillItem {
	const p = row.payloadJson as DrillPayload;
	return {
		cacheId: row.id,
		topicCode: p.topic_code as TopicCode,
		topicNameVi: names.get(p.topic_code) ?? p.topic_code,
		sentenceWithError: p.sentence_with_error,
		corrected: p.corrected,
		originalSpan: p.original_span,
		correctedSpan: p.corrected_span,
		explanationVi: p.explanation_vi
	};
}

function takeForCodes(db: DbOrTx, now: Date, band: number, codes: readonly string[]): DrillItem[] {
	const cache = cacheRepo(db);
	const names = new Map(grammarTopicsRepo(db).all().map((t) => [t.code, t.nameVi]));
	const drills: DrillItem[] = [];
	for (const code of codes) {
		const row = cache.takeNearest('error', band, { paramsHash: drillParamsHash(code as TopicCode), now });
		if (row !== undefined) drills.push(toDrillItem(row, names));
	}
	return drills;
}

/** Take the session's drills (marked served) for these codes, nearest to `band`. */
export function takeDrills(db: DbOrTx, profileId: number, now: Date, band: number, seed: string): DrillItem[] {
	const cache = cacheRepo(db);
	const inStock = DRILL_CODES.filter((code) => cache.hasUnservedNear('error', band, 8, drillParamsHash(code)));
	return takeForCodes(db, now, band, chooseDrillCodes(weaknessProfile(db, profileId, now), inStock, DRILLS_PER_SESSION, seed));
}

/** A topic focus session: up to 2 cached drills of that code (none when it has no drill stock). */
export function takeTopicDrills(db: DbOrTx, now: Date, band: number, code: TopicCode): DrillItem[] {
	if (!(DRILL_CODES as readonly string[]).includes(code)) return [];
	return takeForCodes(db, now, band, Array<string>(DRILLS_PER_SESSION).fill(code));
}
