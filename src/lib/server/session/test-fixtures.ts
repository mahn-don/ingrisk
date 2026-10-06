// Session test fixtures: a database with cloze items, cards in chosen states, and a clock.
import type { Db } from '../db/client.ts';
import { type CardRow, cardsRepo } from '../db/repositories/cards.ts';
import { clozeItemsRepo } from '../db/repositories/cloze-items.ts';
import { grammarTopicsRepo } from '../db/repositories/grammar-topics.ts';
import { sentencesRepo } from '../db/repositories/sentences.ts';
import { lexemes } from '../db/schema.ts';
import { createTestDb } from '../db/test-db.ts';
import { newCardFields } from '../srs/mapping.ts';
import type { GapType } from '../../session/types.ts';

/** 2026-10-05 09:00 in Asia/Ho_Chi_Minh. */
export const T0 = new Date('2026-10-05T02:00:00Z');
export const MINUTE = 60_000;
export const DAY = 86_400_000;

const TOPIC: Record<Exclude<GapType, 'lexical'>, 'ART' | 'PRE' | 'TNS'> = { article: 'ART', preposition: 'PRE', verb_form: 'TNS' };
const GAPS: Record<GapType, { text: string; index: number; answer: string; options: string[] }> = {
	// tokens: The(0) teacher(1) reads(2) a(3) story(4) in(5) class(6)
	lexical: { text: 'The teacher reads a story in class', index: 4, answer: 'story', options: ['story', 'table', 'river', 'shoe'] },
	article: { text: 'The teacher reads a story in class', index: 3, answer: 'a', options: ['a', 'an', 'the', '—'] },
	preposition: { text: 'The teacher reads a story in class', index: 5, answer: 'in', options: ['in', 'on', 'at', 'of'] },
	verb_form: { text: 'The teacher reads a story in class', index: 2, answer: 'reads', options: ['read', 'reads', 'reading', 'readed'] }
};

export interface ItemSpec {
	gapType?: GapType;
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
	const addDueCard = (spec: ItemSpec & { overdueDays?: number; stability?: number; state?: CardRow['state']; now?: Date } = {}): CardRow => {
		const item = addItem(spec);
		const now = spec.now ?? T0;
		const card = cardsRepo(db).insertIfAbsent({
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
	return { db, addItem, addDueCard };
}
