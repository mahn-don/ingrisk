// Error mining: every graded error (writing or translation, at most 3 per submission) becomes a
// cloze card on the learner's own corrected sentence, so reviews target real mistakes.
// See docs/architecture.md Part I §8 and plans/phase-09b.md.
import type { DbOrTx } from '../db/client.ts';
import { cardsRepo } from '../db/repositories/cards.ts';
import { clozeItemsRepo } from '../db/repositories/cloze-items.ts';
import { grammarTopicsRepo } from '../db/repositories/grammar-topics.ts';
import { lexemesRepo } from '../db/repositories/lexemes.ts';
import { sentencesRepo } from '../db/repositories/sentences.ts';
import type { WritingError } from '../db/schema.ts';
import { prepositionDistractors } from '../generation/cloze/prepositions.ts';
import { type FormIndex, buildFormIndex } from '../generation/forms.ts';
import { seededShuffle, sha256 } from '../generation/random.ts';
import { NO_WORD, capitalize, firstWordIndex, tokenize } from '../generation/tokens.ts';
import { newCardFields } from '../srs/mapping.ts';

/** A correction longer than this (tokens) is not a cloze gap. */
export const MAX_GAP_TOKENS = 4;
export const MAX_MINED_PER_SUBMISSION = 3;
/** Codes with a confusion or form table to draw distractors from (the rest are typed). */
const TABLE_CODES = new Set(['ART', 'PRE', 'SVA', 'TNS', 'PLU']);
const ARTICLES = ['a', 'an', 'the'];
const STOCK_NAMES = /\b(Tom|Mary)\b/;

export type Located = { sentence: string; tokenIndex: number; tokenCount: number } | { skip: 'empty' | 'too_long' | 'missing' | 'ambiguous' };

/** Sentences of a text: split after . ! ? (and …) followed by space. */
export const splitSentences = (text: string) =>
	text
		.split(/(?<=[.!?…])\s+/)
		.map((s) => s.trim())
		.filter(Boolean);

/**
 * The one place `correction` occurs (whole tokens, ignoring case) in the corrected text: its
 * sentence and token span. Skipped when empty, longer than 4 tokens, absent, or found twice.
 */
export function locateCorrection(correctedText: string, correction: string): Located {
	const wanted = tokenize(correction).map((t) => t.text.toLowerCase());
	if (wanted.length === 0) return { skip: 'empty' };
	if (wanted.length > MAX_GAP_TOKENS) return { skip: 'too_long' };
	const hits: { sentence: string; tokenIndex: number }[] = [];
	for (const sentence of splitSentences(correctedText)) {
		const tokens = tokenize(sentence).map((t) => t.text.toLowerCase());
		for (let i = 0; i + wanted.length <= tokens.length; i++) {
			if (wanted.every((w, k) => tokens[i + k] === w)) hits.push({ sentence, tokenIndex: i });
		}
	}
	if (hits.length === 0) return { skip: 'missing' };
	if (hits.length > 1) return { skip: 'ambiguous' };
	return { ...hits[0], tokenCount: wanted.length };
}

/** Distractors from the 5a tables for a one-word correction, or none for other codes. */
function tableDistractors(code: string, answer: string, forms: FormIndex): string[] {
	const word = answer.toLowerCase();
	if (code === 'ART') return [...ARTICLES, NO_WORD].filter((a) => a !== word);
	if (code === 'PRE') return prepositionDistractors(word);
	if (code === 'SVA' || code === 'TNS' || code === 'PLU') {
		const lemma = forms.lemmaOf.get(word)?.headword;
		if (lemma === undefined) return [];
		return (forms.formsOf.get(lemma) ?? []).filter((f) => f !== word && /^[a-z]+$/.test(f) && !f.endsWith('ings'));
	}
	return [];
}

/**
 * Options for a mined gap: the answer, the learner's own wrong form, and table distractors up to
 * four; typing-only (no options) for codes without a table or with fewer than 3 distractors.
 */
export function minedOptions(error: Pick<WritingError, 'original' | 'topic_code'>, answer: string, initial: boolean, forms: FormIndex, seed: string): { options: string[]; typingOnly: boolean } {
	const wrong = error.original.trim();
	const singleWord = tokenize(answer).length === 1;
	const table = TABLE_CODES.has(error.topic_code) && singleWord ? tableDistractors(error.topic_code, answer, forms) : [];
	const seen = new Set([answer.toLowerCase()]);
	const distractors: string[] = [];
	for (const option of [wrong, ...table]) {
		const key = option.toLowerCase();
		if (option === '' || seen.has(key)) continue;
		seen.add(key);
		distractors.push(option);
	}
	if (!TABLE_CODES.has(error.topic_code) || distractors.length < 3) return { options: [], typingOnly: true };
	// The learner's own form always stays; the rest of the table fills up to three.
	const chosen = [distractors[0], ...seededShuffle(distractors.slice(1), seed).slice(0, 2)];
	const cased = (o: string) => (initial ? capitalize(o) : o);
	return { options: seededShuffle([answer, ...chosen.map(cased)], `${seed}|order`), typingOnly: false };
}

export interface MiningSource {
	correctedText: string;
	errors: readonly WritingError[];
	/** The Vietnamese prompt or source sentence; '' when there is none. */
	viText: string;
	levelBand: number;
}

export interface MiningResult {
	created: number;
	skipped: { reason: string; correction: string }[];
}

/**
 * Turn graded errors into user_error cloze items with a card each (state New, created now; exempt
 * from the daily new-card limit). An identical sentence and span already mined is skipped.
 */
export function mineErrors(db: DbOrTx, source: MiningSource, now: Date, forms: FormIndex = buildFormIndex(lexemesRepo(db).all())): MiningResult {
	const result: MiningResult = { created: 0, skipped: [] };
	const clozeItems = clozeItemsRepo(db);
	const topics = grammarTopicsRepo(db);
	for (const error of source.errors.slice(0, MAX_MINED_PER_SUBMISSION)) {
		const located = locateCorrection(source.correctedText, error.correction);
		if ('skip' in located) {
			result.skipped.push({ reason: located.skip, correction: error.correction });
			continue;
		}
		const tokens = tokenize(located.sentence);
		const first = tokens[located.tokenIndex];
		const last = tokens[located.tokenIndex + located.tokenCount - 1];
		const answer = located.sentence.slice(first.start, last.end);
		const contentHash = sha256(`user_error|${located.sentence.replace(/\s+/g, ' ').toLowerCase()}|${located.tokenIndex}|${located.tokenCount}`);
		if (clozeItems.existingHashes([contentHash]).size > 0) {
			result.skipped.push({ reason: 'duplicate', correction: error.correction });
			continue;
		}
		const { options, typingOnly } = minedOptions(error, answer, located.tokenIndex === firstWordIndex(tokens), forms, contentHash);
		const sentence = sentencesRepo(db).insert({
			enText: located.sentence,
			viText: source.viText,
			source: 'user_error',
			licenseTag: 'user',
			levelBand: source.levelBand,
			hasStockNames: STOCK_NAMES.test(located.sentence)
		});
		const topicId = topics.byCode(error.topic_code)?.id ?? null;
		const item = clozeItems.insert({
			sentenceId: sentence.id,
			gapType: 'user_error',
			tokenIndex: located.tokenIndex,
			tokenCount: located.tokenCount,
			typingOnly,
			answer,
			options,
			answerVi: error.explanation_vi,
			lexemeId: null,
			grammarTopicId: topicId,
			levelBand: source.levelBand,
			ruleOk: true,
			criticOk: null,
			validated: true,
			promptVersion: 'user_error',
			model: null,
			contentHash,
			createdAt: now
		});
		if (item === undefined) continue;
		cardsRepo(db).insertIfAbsent({
			kind: 'cloze',
			lexemeId: null,
			sentenceId: sentence.id,
			grammarTopicId: topicId,
			clozeItemId: item.id,
			promptMode: typingOnly ? 'typing' : 'choice',
			...newCardFields(now)
		});
		result.created++;
	}
	return result;
}
