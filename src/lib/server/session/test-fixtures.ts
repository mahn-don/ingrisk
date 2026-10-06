// Session test fixtures: a database with cloze items, cards in chosen states, and a clock.
import type { Db } from '../db/client.ts';
import { cacheRepo } from '../db/repositories/cache.ts';
import { providersRepo } from '../db/repositories/providers.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import type { TOPIC_CODES } from '../db/schema.ts';
import { drillParamsHash } from '../generation/drills/build.ts';
import { type CardRow, cardsRepo } from '../db/repositories/cards.ts';
import { clozeItemsRepo } from '../db/repositories/cloze-items.ts';
import { grammarTopicsRepo } from '../db/repositories/grammar-topics.ts';
import { sentencesRepo } from '../db/repositories/sentences.ts';
import { lexemes } from '../db/schema.ts';
import { TEST_PROFILE, createTestDb } from '../db/test-db.ts';
import { newCardFields } from '../srs/mapping.ts';
import type { GapType } from '../../session/types.ts';

type TopicCode = (typeof TOPIC_CODES)[number];

/** 2026-10-05 09:00 in Asia/Ho_Chi_Minh. */
export const T0 = new Date('2026-10-05T02:00:00Z');
export const MINUTE = 60_000;
export const DAY = 86_400_000;

const TOPIC: Record<Exclude<GapType, 'lexical' | 'user_error'>, 'ART' | 'PRE' | 'TNS'> = { article: 'ART', preposition: 'PRE', verb_form: 'TNS' };
const GAPS: Record<Exclude<GapType, 'user_error'>, { text: string; index: number; answer: string; options: string[] }> = {
	// tokens: The(0) teacher(1) reads(2) a(3) story(4) in(5) class(6)
	lexical: { text: 'The teacher reads a story in class', index: 4, answer: 'story', options: ['story', 'table', 'river', 'shoe'] },
	article: { text: 'The teacher reads a story in class', index: 3, answer: 'a', options: ['a', 'an', 'the', '—'] },
	preposition: { text: 'The teacher reads a story in class', index: 5, answer: 'in', options: ['in', 'on', 'at', 'of'] },
	verb_form: { text: 'The teacher reads a story in class', index: 2, answer: 'reads', options: ['read', 'reads', 'reading', 'readed'] }
};

export interface ItemSpec {
	gapType?: Exclude<GapType, 'user_error'>;
	band?: number;
	stock?: boolean;
	/** Reuse this sentence (several gaps in one sentence). */
	sentenceId?: number;
	/** Lexical items: reuse this lexeme. */
	lexemeId?: number;
}

let n = 0;

export function setup() {
	const db: Db = createTestDb();
	const topics = grammarTopicsRepo(db);
	/** A validated cloze item (and its sentence, lexeme). */
	const addItem = (spec: ItemSpec = {}) => {
		const gapType = spec.gapType ?? 'lexical';
		const gap = GAPS[gapType];
		n++;
		const sentenceId =
			spec.sentenceId ??
			sentencesRepo(db).insert({
				enText: `${spec.stock ? 'Tom' : 'The'}${gap.text.slice(3)} number ${n}.`,
				viText: `(vi) câu ${n}`,
				source: 'llm',
				licenseTag: 'test',
				levelBand: spec.band ?? 1,
				hasStockNames: spec.stock ?? false
			}).id;
		const lexemeId =
			gapType !== 'lexical'
				? null
				: (spec.lexemeId ?? db.insert(lexemes).values({ headword: `w${n}`, forms: [`w${n}`], source: 'test', licenseTag: 'test', freqBand: 1 }).returning().get().id);
		return clozeItemsRepo(db).insert({
			sentenceId,
			gapType,
			tokenIndex: gap.index,
			answer: gap.answer,
			options: gap.options,
			answerVi: gapType === 'lexical' ? 'câu chuyện' : null,
			lexemeId,
			grammarTopicId: gapType === 'lexical' ? null : topics.byCode(TOPIC[gapType])!.id,
			levelBand: spec.band ?? 1,
			ruleOk: true,
			criticOk: true,
			validated: true,
			promptVersion: 'test',
			contentHash: `session-test-${n}`,
			createdAt: new Date(0)
		})!;
	};
	/** A card on an item, already introduced: due `overdueDays` ago, with this stability. */
	const addDueCard = (spec: ItemSpec & { overdueDays?: number; stability?: number; state?: CardRow['state']; now?: Date; profileId?: number } = {}): CardRow => {
		const item = addItem(spec);
		const now = spec.now ?? T0;
		const card = cardsRepo(db, spec.profileId ?? TEST_PROFILE).insertIfAbsent({
			kind: 'cloze',
			lexemeId: item.lexemeId,
			sentenceId: item.sentenceId,
			grammarTopicId: item.grammarTopicId,
			clozeItemId: item.id,
			...newCardFields(now),
			state: spec.state ?? 'Review',
			stability: spec.stability ?? 3,
			difficulty: 5,
			reps: 3,
			scheduledDays: 3,
			due: new Date(now.getTime() - (spec.overdueDays ?? 1) * DAY),
			lastReview: new Date(now.getTime() - ((spec.overdueDays ?? 1) + 3) * DAY)
		})!;
		return card;
	};
	/** A validated, unserved reading passage at `band` (2 questions, answers 0 and 1). */
	const addReading = (band = 1, glossary: { word: string; vi: string }[] = [{ word: 'teacher', vi: 'giáo viên' }]) =>
		cacheRepo(db).insert({
			kind: 'reading',
			paramsHash: 'reading-test',
			contentHash: `reading-${++n}`,
			levelBand: band,
			payloadJson: {
				title_en: `A day at school ${n}`,
				passage_en: 'The teacher reads a story in class. The children listen.',
				questions: [
					{ question_en: 'Who reads?', options: ['The teacher', 'A child', 'A cat', 'Nobody'], answer_index: 0, explanation_vi: 'Câu đầu tiên.' },
					{ question_en: 'What do the children do?', options: ['Sleep', 'Listen', 'Run', 'Eat'], answer_index: 1, explanation_vi: 'Câu thứ hai.' }
				],
				glossary,
				topic: 'school',
				word_count: 11,
				coverage: 1
			},
			model: 'test',
			promptVersion: 'test',
			createdAt: new Date(0),
			validated: true,
			validationNotes: null
		})!;
	/** A validated, unserved error drill of a topic code. */
	const addDrill = (code: TopicCode, band = 1) =>
		cacheRepo(db).insert({
			kind: 'error',
			paramsHash: drillParamsHash(code),
			contentHash: `drill-${++n}`,
			levelBand: band,
			payloadJson: {
				sentence_with_error: 'She go to work.',
				corrected: 'She goes to work.',
				original_span: 'She go',
				corrected_span: 'She goes',
				topic_code: code,
				explanation_vi: 'Sau "she" động từ thêm -s.',
				source: 'tatoeba'
			},
			model: 'test',
			promptVersion: 'test',
			createdAt: new Date(0),
			validated: true,
			validationNotes: null
		})!;
	/** An active (keyless) provider, so Viết is available. */
	const addProvider = () => {
		const provider = providersRepo(db).upsert({ name: 'local', baseUrl: 'http://localhost:9/v1', model: 'm', wireFormat: 'openai', structuredMode: 'json_schema', envKeyName: null });
		settingsRepo(db).update({ activeProviderId: provider.id });
	};
	return { db, addItem, addDueCard, addReading, addDrill, addProvider };
}
