// Composing a session: which cards, in which order, in which mode. The ordering and selection
// rules are pure functions; composeSession() adds the database reads and creates the new cards.
// See docs/architecture.md Part I §8 and plans/phase-09a.md.
import type { FSRS } from 'ts-fsrs';
import type { DbOrTx } from '../db/client.ts';
import { type CardRow, cardsRepo } from '../db/repositories/cards.ts';
import { type SessionClozeItem, clozeItemsRepo } from '../db/repositories/cloze-items.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import { hashString } from '../generation/random.ts';
import { fillGap, tokenize, withGap } from '../generation/tokens.ts';
import { buildQueue, createScheduler, learningDayStart, newCardFields, previewIntervals, toFsrsCard } from '../srs/index.ts';
import type { PromptMode } from '../../session/rating.ts';
import type { EmptyReason, GapType, SessionItem, SessionShape } from '../../session/types.ts';

export const SECONDS_PER_ITEM = 20;
export const MAX_ITEMS = 30;
/** Due cards with the highest retrievability that open a session (an easy start). */
export const OPENING_REVIEWS = 3;
/** One new card after every this many reviews. */
export const REVIEWS_PER_NEW = 3;
/** No more than this many items of the same gap type in a row. */
export const MAX_SAME_GAP_RUN = 3;
/** At most this share of a session's items may come from sentences with stock names (Tom, Mary). */
export const STOCK_NAME_SHARE = 0.3;
/** Cards at or above this stability (days) are typed, unless New/Learning or an article gap. */
export const TYPING_MIN_STABILITY = 7;

/** Minutes an anchor (passage, writing, translation) takes out of a Đọc or Viết budget. */
export const ANCHOR_MINUTES = 3;

/**
 * Review items for a budget: about 20 s each, capped at 30 (at least 1). Đọc and Viết keep about
 * 3 minutes for their anchor: round((budget − 3) × 60 / 20).
 */
export function itemCount(budgetMin: number, shape: SessionShape = 'quick'): number {
	const minutes = shape === 'quick' ? budgetMin : budgetMin - ANCHOR_MINUTES;
	return Math.min(MAX_ITEMS, Math.max(1, Math.round((minutes * 60) / SECONDS_PER_ITEM)));
}

/**
 * Choice while a card is new, learning or weak (stability < 7 days); typing after. Articles: always
 * choice. A mined error without enough distractors: always typing.
 */
export function promptMode(card: Pick<CardRow, 'state' | 'stability'>, gapType: GapType, typingOnly = false): PromptMode {
	if (typingOnly) return 'typing';
	if (gapType === 'article') return 'choice';
	if (card.state === 'New' || card.state === 'Learning' || card.stability < TYPING_MIN_STABILITY) return 'choice';
	return 'typing';
}

/** Reviews with one new item after every `every` reviews; leftovers of either list at the end. */
export function interleave<T>(reviews: readonly T[], fresh: readonly T[], every = REVIEWS_PER_NEW): T[] {
	const out: T[] = [];
	let n = 0;
	reviews.forEach((review, i) => {
		out.push(review);
		if ((i + 1) % every === 0 && n < fresh.length) out.push(fresh[n++]);
	});
	return [...out, ...fresh.slice(n)];
}

interface Arrangeable {
	sentenceId: number;
	gapType: GapType;
}

const fits = (out: readonly Arrangeable[], x: Arrangeable, checkGap: boolean) => {
	const last = out.at(-1);
	if (last !== undefined && last.sentenceId === x.sentenceId) return false;
	if (!checkGap || out.length < MAX_SAME_GAP_RUN) return true;
	return !out.slice(-MAX_SAME_GAP_RUN).every((o) => o.gapType === x.gapType);
};

/**
 * Keep the planned order where possible, but never two items of the same sentence back to back
 * and never more than 3 of one gap type in a row: at each position take the first remaining item
 * that fits (both rules, else the sentence rule, else the next item when nothing can fit).
 */
export function arrange<T extends Arrangeable>(planned: readonly T[]): T[] {
	const rest = [...planned];
	const out: T[] = [];
	while (rest.length > 0) {
		let i = rest.findIndex((x) => fits(out, x, true));
		if (i < 0) i = rest.findIndex((x) => fits(out, x, false));
		if (i < 0) i = 0;
		out.push(rest.splice(i, 1)[0]);
	}
	return out;
}

/** Keep items in order up to `count`, with at most 30% from stock-name sentences (of the final list). */
export function capStockNames<T extends { hasStockNames: boolean }>(sequence: readonly T[], count: number, share = STOCK_NAME_SHARE): T[] {
	const kept: T[] = [];
	let stock = 0;
	const allowed = Number.isFinite(count) ? Math.floor(share * count) : Infinity;
	for (const x of sequence) {
		if (kept.length >= count) break;
		if (x.hasStockNames) {
			if (stock >= allowed) continue;
			stock++;
		}
		kept.push(x);
	}
	// With too little content the list is shorter than `count`: re-apply the share to its length.
	while (stock > Math.floor(share * kept.length)) {
		const last = kept.findLastIndex((x) => x.hasStockNames);
		kept.splice(last, 1);
		stock--;
	}
	return kept;
}

const GRAMMAR_TYPES = ['article', 'preposition', 'verb_form'] as const;

/**
 * Choose `n` items for new cards: about half lexical, the rest rotating article, preposition and
 * verb form; lower bands first (a seeded order within a band); lexical items whose lexeme has no
 * card yet first; avoiding sentences already used. When a type runs out, the others fill in.
 */
export function pickNewItems(
	candidates: readonly SessionClozeItem[],
	n: number,
	options: { lexemesWithCards: ReadonlySet<number>; avoidSentences: ReadonlySet<number>; seed: string }
): SessionClozeItem[] {
	if (n <= 0) return [];
	const order = (a: SessionClozeItem, b: SessionClozeItem) =>
		a.levelBand - b.levelBand || hashString(`${options.seed}|${a.id}`) - hashString(`${options.seed}|${b.id}`);
	const byType = new Map<GapType, SessionClozeItem[]>();
	for (const c of [...candidates].sort(order)) byType.set(c.gapType, [...(byType.get(c.gapType) ?? []), c]);
	// Lexical: unseen lexemes first (stable sort keeps the band order within each group).
	byType.set(
		'lexical',
		[...(byType.get('lexical') ?? [])].sort(
			(a, b) => Number(a.lexemeId !== null && options.lexemesWithCards.has(a.lexemeId)) - Number(b.lexemeId !== null && options.lexemesWithCards.has(b.lexemeId))
		)
	);
	const usedSentences = new Set(options.avoidSentences);
	const usedLexemes = new Set<number>();
	const picked: SessionClozeItem[] = [];
	const take = (type: GapType, strict: boolean): boolean => {
		const list = byType.get(type) ?? [];
		const i = list.findIndex((c) => !usedSentences.has(c.sentenceId) && (!strict || c.lexemeId === null || !usedLexemes.has(c.lexemeId)));
		if (i < 0) return false;
		const [c] = list.splice(i, 1);
		picked.push(c);
		usedSentences.add(c.sentenceId);
		if (c.lexemeId !== null) usedLexemes.add(c.lexemeId);
		return true;
	};
	let grammarTurn = 0;
	for (let slot = 0; picked.length < n; slot++) {
		const wanted: GapType = slot % 2 === 0 ? 'lexical' : GRAMMAR_TYPES[grammarTurn++ % GRAMMAR_TYPES.length];
		const fallbacks: GapType[] = wanted === 'lexical' ? ['lexical', ...GRAMMAR_TYPES] : [wanted, ...GRAMMAR_TYPES.filter((t) => t !== wanted), 'lexical'];
		if (!fallbacks.some((t) => take(t, true)) && !fallbacks.some((t) => take(t, false))) break;
	}
	return picked;
}

/** How many new items land among the first `count` of interleave(due reviews, new items). */
export function newItemsWanted(dueCount: number, newAvailable: number, count: number): number {
	return interleave(Array<boolean>(dueCount).fill(false), Array<boolean>(newAvailable).fill(true))
		.slice(0, count)
		.filter(Boolean).length;
}

interface Entry {
	card: CardRow | null;
	item: SessionClozeItem;
	sentenceId: number;
	gapType: GapType;
	hasStockNames: boolean;
}

export interface ComposedSession {
	items: SessionItem[];
	/** Set when there is nothing to study. */
	reason?: EmptyReason;
	/** New cards created for this session. */
	created: number;
}

export function toItem(card: CardRow, item: SessionClozeItem, now: Date, scheduler: FSRS): SessionItem {
	const mode = promptMode(card, item.gapType, item.typingOnly);
	const tokens = tokenize(item.enText);
	const first = tokens[item.tokenIndex];
	const last = tokens[item.tokenIndex + item.tokenCount - 1];
	const intervals = Object.fromEntries(previewIntervals(card, now, scheduler).map((p) => [p.rating, p.interval])) as SessionItem['intervals'];
	const single = item.tokenCount === 1;
	return {
		cardId: card.id,
		mode,
		gapType: item.gapType,
		isNew: card.state === 'New',
		isMined: item.gapType === 'user_error',
		sentenceWithGap: single ? withGap(item.enText, tokens, item.tokenIndex) : `${item.enText.slice(0, first.start)}___${item.enText.slice(last.end)}`,
		before: item.enText.slice(0, first.start),
		after: item.enText.slice(last.end),
		...(mode === 'choice' ? { options: item.options } : {}),
		answer: item.answer,
		filled: single ? fillGap(item.enText, tokens, item.tokenIndex, item.answer) : item.enText,
		viTranslation: item.viText,
		answerVi: item.answerVi,
		levelBand: item.levelBand,
		intervals
	};
}

/**
 * The items of a quick session for a budget: due cloze cards (an easy opening, then most overdue
 * first) with new cards interleaved, within the daily new-card limit and the stock-name cap. New
 * cards are created here (state New); an abandoned session simply leaves them New.
 */
export function composeSession(db: DbOrTx, now: Date, options: { budgetMin: number; shape?: SessionShape }): ComposedSession {
	const count = itemCount(options.budgetMin, options.shape);
	const settings = settingsRepo(db).get();
	const scheduler = createScheduler(settings);
	const cards = cardsRepo(db);
	const clozeItems = clozeItemsRepo(db);
	const queue = buildQueue(db, now, { reviewLimit: count, newLimit: settings.newCardsPerDay });

	// 9a serves cloze cards only (other kinds come with Phase 9b).
	const cloze = queue.cards.filter((c) => c.kind === 'cloze' && c.clozeItemId !== null);
	const details = new Map(clozeItems.forSession(cloze.map((c) => c.clozeItemId!)).map((i) => [i.id, i]));
	const entry = (card: CardRow | null, item: SessionClozeItem): Entry => ({ card, item, sentenceId: item.sentenceId, gapType: item.gapType, hasStockNames: item.hasStockNames });
	const withItem = (c: CardRow) => (details.has(c.clozeItemId!) ? [entry(c, details.get(c.clozeItemId!)!)] : []);
	const due = cloze.filter((c) => c.state !== 'New').flatMap(withItem);
	const existingNew = cloze.filter((c) => c.state === 'New').flatMap(withItem);
	// The learner's own mined errors: new cards outside the daily limit, served right after the opening.
	const minedCards = cards.newMinedCards(count);
	for (const [id, item] of clozeItems.forSession(minedCards.map((c) => c.clozeItemId!)).map((i) => [i.id, i] as const)) details.set(id, item);
	const mined = minedCards.flatMap(withItem);

	// Opening: the most retrievable due cards; then the rest, most overdue first (queue order).
	const retrievability = (c: CardRow) => scheduler.get_retrievability(toFsrsCard(c), now, false);
	const opening = [...due].sort((a, b) => retrievability(b.card!) - retrievability(a.card!)).slice(0, OPENING_REVIEWS);
	const reviews = [...opening, ...mined, ...due.filter((e) => !opening.includes(e))];

	// Stock-name budget for the session (Tom and Mary recur in Tatoeba).
	const allowedStock = Math.floor(STOCK_NAME_SHARE * count);
	let stock = 0;
	const admit = (e: Entry) => {
		if (!e.hasStockNames) return true;
		if (stock >= allowedStock) return false;
		stock++;
		return true;
	};
	const keptReviews = reviews.filter((e) => admit(e)).slice(0, count);

	// New items within the daily limit: the cards left New earlier first, then fresh cloze items
	// (their cards are created below). Extra fresh candidates cover the cap and card conflicts.
	const left = Math.max(0, settings.newCardsPerDay - queue.introducedToday);
	const wanted = newItemsWanted(keptReviews.length, left, count);
	const fresh = pickNewItems(clozeItems.newCardCandidates(profileRepo(db).get().knownBandCeiling + 1), Math.max(0, wanted - existingNew.length) * 2 + 5, {
		lexemesWithCards: cards.lexemeIdsWithCards(),
		avoidSentences: new Set([...keptReviews, ...existingNew].map((e) => e.sentenceId)),
		seed: String(learningDayStart(now).getTime())
	});
	const news: Entry[] = [];
	for (const e of [...existingNew, ...fresh.map((item) => entry(null, item))]) {
		if (news.length >= wanted) break;
		if (admit(e)) news.push(e);
	}

	// Interleave, re-apply the stock share if the session came out short, then fix the order.
	const chosen = arrange(capStockNames(interleave(keptReviews, news).slice(0, count), Infinity));
	const items: SessionItem[] = [];
	let created = 0;
	for (const e of chosen) {
		let card = e.card;
		if (card === null) {
			card =
				cards.insertIfAbsent({
					kind: 'cloze',
					lexemeId: e.item.lexemeId,
					sentenceId: e.item.sentenceId,
					grammarTopicId: e.item.grammarTopicId,
					clozeItemId: e.item.id,
					promptMode: 'choice',
					...newCardFields(now)
				}) ?? null;
			// Same lexeme or grammar topic in the same sentence as an existing card: skip it.
			if (card === null) continue;
			created++;
		}
		cards.setPromptMode(card.id, promptMode(card, e.gapType, e.item.typingOnly));
		items.push(toItem(card, e.item, now, scheduler));
	}
	if (items.length > 0) return { items, created };
	const hasContent = due.length > 0 || existingNew.length > 0 || clozeItems.hasValidated();
	return { items, created, reason: hasContent ? 'all_done' : 'no_content' };
}
