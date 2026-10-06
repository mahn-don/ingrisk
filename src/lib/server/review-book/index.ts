// The review book ("Sổ ôn tập"): the cards often wrong, every card learned (searchable), and one
// card's detail with its review history. Actions: "Ôn ngay" and "Tạm ẩn / Bỏ ẩn". See plans/phase-10.md.
import type { DbOrTx } from '../db/client.ts';
import { cardsRepo } from '../db/repositories/cards.ts';
import { type BookCard, reviewBookRepo } from '../db/repositories/review-book.ts';
import { reviewLogsRepo } from '../db/repositories/review-logs.ts';
import { learningSettingsRepo } from '../db/repositories/settings.ts';
import { tokenize, withGap } from '../generation/tokens.ts';
import { dayIndex } from '../progress/days.ts';
import { byHardness, retrievabilityOf } from '../session/focus.ts';
import { createScheduler } from '../srs/index.ts';
import type { BookDetail, BookRow, NextReview } from '../../review/types.ts';
import { describeInterval } from '../../session/interval.ts';
import type { TopicCode } from '../../session/types.ts';

/** The "Đã học" tab lists at most this many cards (search narrows it). */
export const LEARNED_LIMIT = 200;
/** The "Hay sai" tab lists at most this many. */
export const HARD_LIMIT = 100;

export function nextReview(card: BookCard['card'], now: Date): NextReview {
	if (card.suspended) return { kind: 'suspended' };
	if (card.state === 'New') return { kind: 'new' };
	if (card.due.getTime() <= now.getTime()) return { kind: 'now' };
	const days = dayIndex(card.due) - dayIndex(now);
	if (days <= 0) return { kind: 'today' };
	if (days === 1) return { kind: 'tomorrow' };
	if (days < 45) return { kind: 'days', n: days };
	return { kind: 'months', n: Math.round(days / 30) };
}

function gapParts(row: BookCard): { before: string; after: string; sentenceWithGap: string } {
	const tokens = tokenize(row.enText);
	const first = tokens[row.tokenIndex];
	const last = tokens[row.tokenIndex + row.tokenCount - 1];
	if (first === undefined || last === undefined) return { before: row.enText, after: '', sentenceWithGap: row.enText };
	return {
		before: row.enText.slice(0, first.start),
		after: row.enText.slice(last.end),
		sentenceWithGap: row.tokenCount === 1 ? withGap(row.enText, tokens, row.tokenIndex) : `${row.enText.slice(0, first.start)}___${row.enText.slice(last.end)}`
	};
}

function toRow(row: BookCard, now: Date): BookRow {
	return {
		cardId: row.card.id,
		answer: row.answer,
		answerVi: row.answerVi,
		sentenceWithGap: gapParts(row).sentenceWithGap,
		gapType: row.gapType,
		mined: row.gapType === 'user_error',
		suspended: row.card.suspended,
		lapses: row.card.lapses,
		next: nextReview(row.card, now)
	};
}

/** "Hay sai": cards with lapses and every mined error, most lapses first, then the weakest. */
export function hardList(db: DbOrTx, profileId: number, now: Date): BookRow[] {
	const scheduler = createScheduler(learningSettingsRepo(db, profileId).get());
	return byHardness(reviewBookRepo(db, profileId).oftenWrong(), (card) => retrievabilityOf(scheduler, card, now))
		.slice(0, HARD_LIMIT)
		.map((r) => toRow(r, now));
}

/** "Đã học": every introduced card, soonest due first, matching `query` when given. */
export function learnedList(db: DbOrTx, profileId: number, now: Date, query: string): BookRow[] {
	return reviewBookRepo(db, profileId)
		.learned(query.slice(0, 100), LEARNED_LIMIT)
		.map((r) => toRow(r, now));
}

const SOURCES = new Set(['tatoeba', 'user', 'llm']);

export function cardDetail(db: DbOrTx, profileId: number, now: Date, cardId: number): BookDetail | null {
	const row = reviewBookRepo(db, profileId).byCardId(cardId);
	if (row === undefined) return null;
	const logs = reviewLogsRepo(db, profileId).forCard(cardId);
	const { before, after } = gapParts(row);
	return {
		...toRow(row, now),
		before,
		after,
		viText: row.viText,
		topicCode: row.topicCode as TopicCode | null,
		topicNameVi: row.topicNameVi,
		source: row.gapType === 'user_error' ? 'user' : SOURCES.has(row.sentenceSource) ? (row.sentenceSource as BookDetail['source']) : 'other',
		// A log's `due` is the due time before that review, so review i set the due of log i + 1
		// (or the card's current due, for the latest review).
		history: logs.map((log, i) => ({
			review: log.review.getTime(),
			rating: log.rating,
			interval: describeInterval(Math.max(0, (logs[i + 1]?.due ?? row.card.due).getTime() - log.review.getTime()))
		}))
	};
}

/** "Ôn ngay": the card is due now (and shown again if it was hidden). */
export function reviewNow(db: DbOrTx, profileId: number, now: Date, cardId: number): boolean {
	const cards = cardsRepo(db, profileId);
	if (!cards.dueNow(cardId, now)) return false;
	cards.setSuspended(cardId, false);
	return true;
}

export function setSuspended(db: DbOrTx, profileId: number, cardId: number, suspended: boolean): boolean {
	return cardsRepo(db, profileId).setSuspended(cardId, suspended);
}
