// Focus sessions (Phase 10): a Nhanh session restricted to the hardest cards ("Ôn các thẻ hay sai"
// in the review book) or to one grammar topic ("Luyện chủ đề này" on the stats page). They serve
// existing cards only (no new cards, no anchor) regardless of due; a topic session adds that
// topic's cached drills. See plans/phase-10.md.
import type { FSRS } from 'ts-fsrs';
import type { DbOrTx } from '../db/client.ts';
import { type CardRow, cardsRepo } from '../db/repositories/cards.ts';
import { clozeItemsRepo } from '../db/repositories/cloze-items.ts';
import { reviewBookRepo } from '../db/repositories/review-book.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import { createScheduler, toFsrsCard } from '../srs/index.ts';
import type { SessionItem, TopicCode } from '../../session/types.ts';
import { type ComposedSession, arrange, itemCount, promptMode, toItem } from './compose.ts';

export type Focus = { kind: 'hard' } | { kind: 'topic'; code: TopicCode };

/** "Ôn các thẻ hay sai": this many of the hardest cards. */
export const HARD_FOCUS_CARDS = 15;

/** Retrievability now; 0 for a card never reviewed (a New mined error is as weak as it gets). */
export function retrievabilityOf(scheduler: FSRS, card: CardRow, now: Date): number {
	return card.state === 'New' ? 0 : scheduler.get_retrievability(toFsrsCard(card), now, false);
}

/** Hardest first: most lapses, then the lowest retrievability, then the oldest card. */
export function byHardness<T extends { card: CardRow }>(rows: readonly T[], retrievability: (card: CardRow) => number): T[] {
	const r = new Map(rows.map((x) => [x.card.id, retrievability(x.card)]));
	return [...rows].sort((a, b) => b.card.lapses - a.card.lapses || r.get(a.card.id)! - r.get(b.card.id)! || a.card.id - b.card.id);
}

/** A topic session: due cards first (most overdue first), then the rest by lowest retrievability. */
export function byTopicPriority<T extends { card: CardRow }>(rows: readonly T[], now: Date, retrievability: (card: CardRow) => number): T[] {
	const r = new Map(rows.map((x) => [x.card.id, retrievability(x.card)]));
	const isDue = (c: CardRow) => c.due.getTime() <= now.getTime();
	return [...rows].sort(
		(a, b) =>
			Number(isDue(b.card)) - Number(isDue(a.card)) ||
			(isDue(a.card) ? a.card.due.getTime() - b.card.due.getTime() : r.get(a.card.id)! - r.get(b.card.id)!) ||
			a.card.id - b.card.id
	);
}

/** The cards of a focus session, in order, as session items (prompt modes updated). */
export function composeFocus(db: DbOrTx, now: Date, focus: Focus, budgetMin: number): ComposedSession {
	const scheduler = createScheduler(settingsRepo(db).get());
	const retrievability = (card: CardRow) => retrievabilityOf(scheduler, card, now);
	const book = reviewBookRepo(db);
	const picked =
		focus.kind === 'hard'
			? byHardness(book.hardCandidates(), retrievability).slice(0, HARD_FOCUS_CARDS)
			: byTopicPriority(book.topicCandidates(focus.code), now, retrievability).slice(0, itemCount(budgetMin, 'quick'));
	const details = new Map(clozeItemsRepo(db).forSession(picked.map((x) => x.card.clozeItemId!)).map((i) => [i.id, i]));
	const entries = picked.flatMap((x) => {
		const item = details.get(x.card.clozeItemId!);
		return item === undefined ? [] : [{ card: x.card, item, sentenceId: item.sentenceId, gapType: item.gapType }];
	});
	const cards = cardsRepo(db);
	const items: SessionItem[] = arrange(entries).map((e) => {
		cards.setPromptMode(e.card.id, promptMode(e.card, e.gapType, e.item.typingOnly));
		return toItem(e.card, e.item, now, scheduler);
	});
	return items.length > 0 ? { items, created: 0 } : { items, created: 0, reason: 'focus_empty' };
}
