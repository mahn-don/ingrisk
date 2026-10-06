// The anchor of a Đọc or Viết session: a graded passage, or a writing or translation task.
import type { DbOrTx } from '../db/client.ts';
import { cacheRepo } from '../db/repositories/cache.ts';
import { learnerClozeRepo } from '../db/repositories/cloze-items.ts';
import { lexemesRepo } from '../db/repositories/lexemes.ts';
import { sentencesRepo } from '../db/repositories/sentences.ts';
import { sessionsRepo } from '../db/repositories/sessions.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import { type ServedSession, servedOf } from '../db/schema.ts';
import { buildFormIndex } from '../generation/forms.ts';
import { seededPick } from '../generation/random.ts';
import type { ReadingPayload } from '../generation/reading/build.ts';
import { type WritingPrompt, readWritingPrompts } from '../generation/writing-prompts.ts';
import { pickPrompt } from '../placement/engine.ts';
import type { Anchor } from '../../session/types.ts';
import { READING_BAND_DISTANCE } from './shape.ts';

/** A writing prompt is not given again within this many days. */
export const PROMPT_REPEAT_DAYS = 14;
const DAY = 86_400_000;

type ServedAnchor = ServedSession['anchor'];

/**
 * The passage nearest to `band` (within one band), marked served. Each glossary word is "addable"
 * when a validated lexical cloze item for its lexeme has no card yet.
 */
export function readingAnchor(db: DbOrTx, profileId: number, now: Date, band: number): { anchor: Anchor; served: ServedAnchor } | null {
	const row = cacheRepo(db).takeNearest('reading', band, { maxDistance: READING_BAND_DISTANCE, now });
	if (row === undefined) return null;
	const payload = row.payloadJson as ReadingPayload;
	const forms = buildFormIndex(lexemesRepo(db).all());
	const glossaryItems: Record<string, number | null> = {};
	const glossary = payload.glossary.map((g) => {
		const lemma = forms.lemmaOf.get(g.word.toLowerCase());
		const itemId = lemma === undefined ? undefined : learnerClozeRepo(db, profileId).uncardedLexicalFor(lemma.lexemeId);
		glossaryItems[g.word] = itemId ?? null;
		return { word: g.word, vi: g.vi, addable: itemId !== undefined };
	});
	return {
		anchor: {
			type: 'reading',
			cacheId: row.id,
			title: payload.title_en,
			passage: payload.passage_en,
			glossary,
			questions: payload.questions.map((q) => ({ question: q.question_en, options: q.options, answerIndex: q.answer_index, explanationVi: q.explanation_vi }))
		},
		served: { type: 'reading', cacheId: row.id, questions: payload.questions.length, glossary: glossaryItems }
	};
}

/** A writing prompt for `band`, not used in the last 14 days (all used: the least recently used). */
export function writingAnchor(db: DbOrTx, profileId: number, now: Date, band: number, seed: string, prompts: readonly WritingPrompt[] = readWritingPrompts()): { anchor: Anchor; served: ServedAnchor } {
	const recent = writingRepo(db, profileId).promptIdsSince(new Date(now.getTime() - PROMPT_REPEAT_DAYS * DAY));
	const fresh = prompts.filter((p) => !recent.has(p.id));
	const prompt = pickPrompt(fresh.length > 0 ? fresh : prompts, band, seed);
	return {
		anchor: { type: 'writing', promptId: prompt.id, promptVi: prompt.prompt_vi, hint: prompt.hint_en, minWords: prompt.min_words, maxWords: prompt.max_words },
		served: { type: 'writing', promptId: prompt.id }
	};
}

/** A Tatoeba sentence never given before, at the learner's band (or below), to translate into English. */
export function translationAnchor(db: DbOrTx, profileId: number, band: number, seed: string): { anchor: Anchor; served: ServedAnchor } | null {
	const used = writingRepo(db, profileId).translationSentenceIds();
	const sentences = sentencesRepo(db);
	const pool = sentences.forTranslation(Math.max(1, band - 1), band, used);
	const sentence = seededPick(pool.length > 0 ? pool : sentences.forTranslation(1, band, used), `${seed}|translation`);
	if (sentence === undefined) return null;
	return {
		anchor: { type: 'translation', sentenceId: sentence.id, vi: sentence.viText, referenceEn: sentence.enText },
		served: { type: 'translation', sentenceId: sentence.id }
	};
}

/** Viết alternates writing and translation across Viết sessions (writing first; translation needs a sentence). */
export function writeAnchor(db: DbOrTx, profileId: number, now: Date, band: number, seed: string): { anchor: Anchor; served: ServedAnchor } {
	const last = sessionsRepo(db, profileId).lastFinishedWrite();
	const lastType = last === undefined ? null : servedOf(last.servedJson).anchor?.type;
	if (lastType === 'writing') {
		const translation = translationAnchor(db, profileId, band, seed);
		if (translation !== null) return translation;
	}
	return writingAnchor(db, profileId, now, band, seed);
}
