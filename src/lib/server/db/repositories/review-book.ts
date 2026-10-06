import { and, asc, eq, gt, like, ne, or, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { cards, clozeItems, grammarTopics, sentences, type TOPIC_CODES } from '../schema.ts';
import type { CardRow } from './cards.ts';

/** A cloze card with its item, sentence and topic: what the review book and focus sessions show. */
export interface BookCard {
	card: CardRow;
	gapType: (typeof clozeItems.$inferSelect)['gapType'];
	answer: string;
	answerVi: string | null;
	tokenIndex: number;
	tokenCount: number;
	enText: string;
	viText: string;
	sentenceSource: string;
	topicCode: string | null;
	topicNameVi: string | null;
}

/** Read-only queries behind the review book ("Sổ ôn tập") and the focus sessions. */
export function reviewBookRepo(db: DbOrTx) {
	const base = () =>
		db
			.select({
				card: cards,
				gapType: clozeItems.gapType,
				answer: clozeItems.answer,
				answerVi: clozeItems.answerVi,
				tokenIndex: clozeItems.tokenIndex,
				tokenCount: clozeItems.tokenCount,
				enText: sentences.enText,
				viText: sentences.viText,
				sentenceSource: sentences.source,
				topicCode: grammarTopics.code,
				topicNameVi: grammarTopics.nameVi
			})
			.from(cards)
			.innerJoin(clozeItems, eq(clozeItems.id, cards.clozeItemId))
			.innerJoin(sentences, eq(sentences.id, clozeItems.sentenceId))
			.leftJoin(grammarTopics, eq(grammarTopics.id, cards.grammarTopicId));
	return {
		/** Cards often wrong: any lapse, plus every mined error (suspended ones too: the book shows them). */
		oftenWrong(): BookCard[] {
			return base()
				.where(or(gt(cards.lapses, 0), eq(clozeItems.gapType, 'user_error')))
				.all();
		},
		/** Every introduced card, optionally filtered by English, answer or Vietnamese text. */
		learned(query: string, limit: number): BookCard[] {
			const q = query.trim().toLowerCase();
			const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
			const match = (column: Parameters<typeof like>[0]) => sql`lower(${column}) like ${pattern} escape '\\'`;
			return base()
				.where(
					and(
						ne(cards.state, 'New'),
						q === '' ? undefined : or(match(sentences.enText), match(clozeItems.answer), match(sentences.viText), match(clozeItems.answerVi))
					)
				)
				.orderBy(asc(cards.due), asc(cards.id))
				.limit(limit)
				.all();
		},
		byCardId(cardId: number): BookCard | undefined {
			return base().where(eq(cards.id, cardId)).get();
		},
		/** Candidates for the "hard" focus session: not suspended, reviewed at least once or mined. */
		hardCandidates(): BookCard[] {
			return base()
				.where(and(eq(cards.suspended, false), or(ne(cards.state, 'New'), eq(clozeItems.gapType, 'user_error'))))
				.all();
		},
		/** Candidates for a topic focus session: not suspended, introduced, of this grammar topic. */
		topicCandidates(topicCode: (typeof TOPIC_CODES)[number]): BookCard[] {
			return base()
				.where(and(eq(cards.suspended, false), ne(cards.state, 'New'), eq(grammarTopics.code, topicCode)))
				.all();
		}
	};
}
