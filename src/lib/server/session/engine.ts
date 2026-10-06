// Starting and finishing a session. One request in (start: the whole session), one request out
// (finish: every result, applied in one transaction); in between, a Viết session submits its
// writing (graded live, or queued). See plans/phase-09a.md and plans/phase-09b.md.
import { randomUUID } from 'node:crypto';
import type { DbOrTx } from '../db/client.ts';
import { cacheRepo } from '../db/repositories/cache.ts';
import { cardsRepo } from '../db/repositories/cards.ts';
import { clozeItemsRepo } from '../db/repositories/cloze-items.ts';
import { drillResultsRepo } from '../db/repositories/drill-results.ts';
import { sentencesRepo } from '../db/repositories/sentences.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import { type SessionRow, sessionsRepo } from '../db/repositories/sessions.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import { type WritingSubmission, writingRepo } from '../db/repositories/writing.ts';
import { type ServedSession, servedOf } from '../db/schema.ts';
import { type GradedWriting, applyWritingGrade } from '../grading/apply.ts';
import type { ReadingPayload } from '../generation/reading/build.ts';
import { readWritingPrompts } from '../generation/writing-prompts.ts';
import { type ReviewInput, ReviewTimeError, learningDayStart, newCardFields, ratingFromOutcome, reviewBatch } from '../srs/index.ts';
import type { AnchorOutcome, AnchorResponse, FinishRequest, FinishSummary, SessionShape, StartResponse } from '../../session/types.ts';
import { readingAnchor, writeAnchor } from './anchors.ts';
import { composeSession } from './compose.ts';
import { takeDrills, takeTopicDrills } from './drills.ts';
import { feedbackCard, unseenFeedbackCards } from './feedback.ts';
import { type Focus, composeFocus } from './focus.ts';
import { resolveShape, shapeContext } from './shape.ts';

/** Offsets may run this far past the server's own elapsed time (network, clocks). */
export const OFFSET_SLACK_MS = 5_000;
/** Response times are clamped to this (a phone left on the table). */
export const MAX_RESPONSE_MS = 10 * 60_000;
/** Live grading of a session writing waits this long, then the session goes on (queued). */
export const ANCHOR_GRADE_TIMEOUT_MS = 30_000;
export const MAX_ANCHOR_CHARS = 4000;

export class SessionError extends Error {
	readonly status: 400 | 404 | 409;
	readonly code: 'invalid' | 'not_found' | 'not_in_progress' | 'client_id_taken' | 'review_rejected' | 'shape_unavailable' | 'not_addable';
	constructor(status: SessionError['status'], code: SessionError['code'], message: string) {
		super(message);
		this.name = 'SessionError';
		this.status = status;
		this.code = code;
	}
}

/**
 * Start a session: abandon the one in progress (its answers are lost), choose the shape (or check
 * the override), compose the cards, take the drills and the anchor, and store what was served.
 * Unseen graded feedback comes first. An empty composition stores nothing and returns the reason.
 * A focus (the hardest cards, or one grammar topic) makes a Nhanh session of existing cards only.
 */
export function startSession(db: DbOrTx, now: Date, options: { budgetMin?: number; shape?: SessionShape; focus?: Focus } = {}): StartResponse {
	const { focus } = options;
	if (focus !== undefined && options.shape !== undefined && options.shape !== 'quick') {
		throw new SessionError(400, 'invalid', 'a focus session is always quick');
	}
	return db.transaction((tx) => {
		const sessions = sessionsRepo(tx);
		sessions.abandonInProgress(now);
		const budgetMin = options.budgetMin ?? settingsRepo(tx).get().defaultSessionBudget;
		const shape = focus === undefined ? resolveShape(shapeContext(tx, budgetMin), options.shape) : 'quick';
		if (shape === null) throw new SessionError(400, 'shape_unavailable', `shape ${options.shape} is not available now`);
		const feedback = unseenFeedbackCards(tx);
		const band = profileRepo(tx).get().knownBandCeiling;
		const seed = String(now.getTime());

		const composed = focus === undefined ? composeSession(tx, now, { budgetMin, shape }) : composeFocus(tx, now, focus, budgetMin);
		const drills = focus?.kind === 'topic' ? takeTopicDrills(tx, now, band, focus.code) : shape === 'quick' ? [] : takeDrills(tx, now, band, seed);
		const anchored = focus !== undefined ? null : shape === 'read' ? readingAnchor(tx, now, band) : shape === 'write' ? writeAnchor(tx, now, band, seed) : null;
		if (composed.items.length === 0 && drills.length === 0 && anchored === null) {
			return { sessionId: null, startedAt: now.getTime(), shape, items: [], drills: [], anchor: null, feedback, reason: composed.reason ?? 'all_done' };
		}
		const served: ServedSession = {
			cards: composed.items.map((i) => ({ cardId: i.cardId, mode: i.mode, isNew: i.isNew })),
			drills: drills.map((d) => ({ cacheId: d.cacheId, topicCode: d.topicCode })),
			anchor: anchored?.served ?? null
		};
		const row = sessions.start({ startedAt: now, budgetMin, shape, served, placeholderId: `pending:${randomUUID()}` });
		return { sessionId: row.id, startedAt: now.getTime(), shape, items: composed.items, drills, anchor: anchored?.anchor ?? null, feedback };
	});
}

function inProgress(db: DbOrTx, sessionId: number): SessionRow {
	const session = sessionsRepo(db).byId(sessionId);
	if (session === undefined) throw new SessionError(404, 'not_found', 'no such session');
	if (session.status !== 'in_progress') throw new SessionError(409, 'not_in_progress', `session is ${session.status}`);
	return session;
}

export interface AnchorDeps {
	db: DbOrTx;
	now: () => Date;
	/** Grades a submission; null when no provider is configured (the writing stays queued). */
	grade: ((submission: WritingSubmission, levelBand: number) => Promise<GradedWriting>) | null;
	timeoutMs?: number;
	logError?: (message: string, error: unknown) => void;
}

/**
 * The writing or translation of a Viết session: always stored (queued) first, then graded for up
 * to 30 s. In time: the feedback (marked seen; errors mined). Otherwise `{ queued: true }`; a late
 * grade is still stored and mined, and its feedback waits for the next session start. A repeated
 * submit returns what the first one produced.
 */
export async function submitAnchor(deps: AnchorDeps, input: { sessionId: number; text: string }): Promise<AnchorResponse> {
	const { db } = deps;
	const writing = writingRepo(db);
	const session = inProgress(db, input.sessionId);
	const anchor = servedOf(session.servedJson).anchor;
	if (anchor === null || anchor.type === 'reading') throw new SessionError(400, 'invalid', 'this session has no writing task');
	const existing = writing.forSession(session.id);
	if (existing !== undefined) {
		return existing.status === 'scored' ? { queued: false, feedback: feedbackCard(db, existing) } : { queued: true };
	}
	const text = input.text.trim();
	if (!/[A-Za-z]/.test(text) || text.length > MAX_ANCHOR_CHARS) throw new SessionError(400, 'invalid', 'empty or too long');

	const band = profileRepo(db).get().knownBandCeiling;
	let submission;
	if (anchor.type === 'writing') {
		const prompt = readWritingPrompts().find((p) => p.id === anchor.promptId);
		submission = writing.queue({ sessionId: session.id, prompt: prompt?.prompt_vi ?? '', userText: text, submittedAt: deps.now(), taskKind: 'writing', promptId: anchor.promptId });
	} else {
		const sentence = sentencesRepo(db).byId(anchor.sentenceId);
		submission = writing.queue({
			sessionId: session.id,
			prompt: sentence?.viText ?? '',
			userText: text,
			submittedAt: deps.now(),
			taskKind: 'translation',
			sentenceId: anchor.sentenceId,
			referenceEn: sentence?.enText ?? null
		});
	}
	if (deps.grade === null) return { queued: true };

	const queued = submission;
	const graded = deps.grade(queued, band).then(
		(grade) => applyWritingGrade(db, queued.id, grade, deps.now()),
		(error: unknown) => {
			deps.logError?.('session writing not graded; it stays queued', error);
			return false;
		}
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<'timeout'>((resolve) => {
		timer = setTimeout(() => resolve('timeout'), deps.timeoutMs ?? ANCHOR_GRADE_TIMEOUT_MS);
	});
	const outcome = await Promise.race([graded, timeout]);
	clearTimeout(timer);
	if (outcome !== true) return { queued: true };
	// Shown now, inline: it must not come back at the next session start.
	const scored = writing.markSeen(queued.id, deps.now());
	return { queued: false, feedback: feedbackCard(db, scored) };
}

/**
 * "Thêm vào ôn tập" on a glossary word of the session's passage: create the card (state New) for
 * the validated cloze item found at start. It is introduced within the daily new-card limit.
 */
export function addGlossaryCard(db: DbOrTx, now: Date, input: { sessionId: number; word: string }): { cardId: number } {
	return db.transaction((tx) => {
		const session = inProgress(tx, input.sessionId);
		const anchor = servedOf(session.servedJson).anchor;
		const itemId = anchor?.type === 'reading' ? anchor.glossary[input.word] : undefined;
		if (itemId === undefined || itemId === null) throw new SessionError(409, 'not_addable', 'no review item for this word');
		const item = clozeItemsRepo(tx).byId(itemId);
		if (item === undefined) throw new SessionError(409, 'not_addable', 'no review item for this word');
		const card = cardsRepo(tx).insertIfAbsent({
			kind: 'cloze',
			lexemeId: item.lexemeId,
			sentenceId: item.sentenceId,
			grammarTopicId: item.grammarTopicId,
			clozeItemId: item.id,
			promptMode: 'choice',
			...newCardFields(now)
		});
		if (card === undefined) throw new SessionError(409, 'not_addable', 'already in your reviews');
		return { cardId: card.id };
	});
}

/** A feedback card was dismissed: do not show it again. */
export function markFeedbackSeen(db: DbOrTx, now: Date, submissionId: number): void {
	const writing = writingRepo(db);
	const submission = writing.byId(submissionId);
	if (submission === undefined || submission.status !== 'scored') throw new SessionError(404, 'not_found', 'no such feedback');
	if (submission.feedbackSeenAt === null) writing.markSeen(submissionId, now);
}

/** Check the results against the served items and the clock; returns the reviews to apply. */
export function validateResults(session: SessionRow, request: FinishRequest, now: Date): ReviewInput[] {
	const served = servedOf(session.servedJson);
	const cards = new Map(served.cards.map((s) => [s.cardId, s]));
	const seen = new Set<number>();
	const latestOffset = now.getTime() - session.startedAt.getTime() + OFFSET_SLACK_MS;
	let previousOffset = 0;
	const reviews = request.results.map((r) => {
		const item = cards.get(r.cardId);
		if (item === undefined) throw new SessionError(400, 'invalid', `card ${r.cardId} was not served in this session`);
		if (seen.has(r.cardId)) throw new SessionError(400, 'invalid', `card ${r.cardId} appears twice`);
		seen.add(r.cardId);
		if (r.mode !== item.mode) throw new SessionError(400, 'invalid', `card ${r.cardId} was served in ${item.mode} mode`);
		if (r.answeredOffsetMs < 0 || r.answeredOffsetMs > latestOffset) throw new SessionError(400, 'invalid', `offset out of range for card ${r.cardId}`);
		if (r.answeredOffsetMs < previousOffset) throw new SessionError(400, 'invalid', 'offsets must not decrease');
		previousOffset = r.answeredOffsetMs;
		const responseMs = Math.min(MAX_RESPONSE_MS, Math.max(0, r.responseMs));
		return {
			cardId: r.cardId,
			rating: r.ratingOverride ?? ratingFromOutcome({ correct: r.correct, mode: r.mode, responseMs, hintUsed: r.hintUsed }),
			reviewedAt: new Date(session.startedAt.getTime() + r.answeredOffsetMs)
		};
	});

	// Drills and the anchor are checked against what was served, like cards.
	const drills = new Map(served.drills.map((d) => [d.cacheId, d]));
	const seenDrills = new Set<number>();
	for (const d of request.drills ?? []) {
		if (!drills.has(d.cacheId)) throw new SessionError(400, 'invalid', `drill ${d.cacheId} was not served in this session`);
		if (seenDrills.has(d.cacheId)) throw new SessionError(400, 'invalid', `drill ${d.cacheId} appears twice`);
		seenDrills.add(d.cacheId);
	}
	const anchor = request.anchor;
	if (anchor !== undefined) {
		if (served.anchor === null || anchor.type !== served.anchor.type) throw new SessionError(400, 'invalid', `no ${anchor.type} anchor was served`);
		if (anchor.type === 'reading' && served.anchor.type === 'reading') {
			if (anchor.cacheId !== served.anchor.cacheId) throw new SessionError(400, 'invalid', 'not the passage served');
			if (anchor.answers.length > served.anchor.questions) throw new SessionError(400, 'invalid', 'too many answers');
		}
	}
	return reviews;
}

function anchorOutcome(db: DbOrTx, session: SessionRow, request: FinishRequest): AnchorOutcome | null {
	const served = servedOf(session.servedJson).anchor;
	if (served === null) return null;
	if (served.type === 'reading') {
		const payload = cacheRepo(db).byId(served.cacheId)?.payloadJson as ReadingPayload | undefined;
		const answers = request.anchor?.type === 'reading' ? request.anchor.answers : [];
		const correct = answers.filter((a, i) => payload?.questions[i]?.answer_index === a).length;
		return { type: 'reading', correct, total: served.questions };
	}
	const submission = writingRepo(db).forSession(session.id);
	return { type: served.type, status: submission === undefined ? 'skipped' : submission.status === 'scored' ? 'scored' : 'queued' };
}

/**
 * Finish a session: validate, apply every review, record the drills and the session in ONE
 * transaction, and return the summary. A repeated call with the same clientSessionId returns the
 * stored summary without applying anything again. A partial finish (ended early) sends only the
 * answered items.
 */
export function finishSession(db: DbOrTx, now: Date, request: FinishRequest): FinishSummary {
	return db.transaction((tx) => {
		const sessions = sessionsRepo(tx);
		const byClient = sessions.byClientSessionId(request.clientSessionId);
		if (byClient !== undefined) {
			if (byClient.id === request.sessionId && byClient.status === 'finished' && byClient.summaryJson !== null) return byClient.summaryJson;
			throw new SessionError(409, 'client_id_taken', 'clientSessionId belongs to another session');
		}
		const session = inProgress(tx, request.sessionId);
		const reviews = validateResults(session, request, now);
		let applied;
		try {
			applied = reviewBatch(tx, reviews, now);
		} catch (error) {
			if (error instanceof ReviewTimeError) throw new SessionError(409, 'review_rejected', error.message);
			throw error;
		}
		const served = servedOf(session.servedJson);
		const topics = new Map(served.drills.map((d) => [d.cacheId, d.topicCode]));
		for (const d of request.drills ?? []) {
			drillResultsRepo(tx).insert({ sessionId: session.id, cacheId: d.cacheId, topicCode: topics.get(d.cacheId)!, correct: d.correct, answeredAt: now });
		}
		const clamp = (ms: number) => Math.min(MAX_RESPONSE_MS, Math.max(0, ms));
		const correct = request.results.filter((r) => r.correct).length;
		const studyMs = [...request.results, ...(request.drills ?? [])].reduce((n, r) => n + clamp(r.responseMs), 0);
		const earlierToday = sessions.finishedSince(learningDayStart(now)).reduce((n, s) => n + (s.summaryJson?.studyMs ?? 0), 0);
		const summary: FinishSummary = {
			answered: request.results.length,
			correct,
			accuracy: request.results.length === 0 ? 0 : correct / request.results.length,
			// A first review raises stability from 0 even when wrong, so new cards do not count.
			strengthened: applied.filter((r) => r.log.state !== 'New' && r.log.newS > r.log.oldS).length,
			newIntroduced: applied.filter((r) => r.log.state === 'New').length,
			nextDueAt: cardsRepo(tx).earliestIntroducedDue()?.getTime() ?? null,
			studyMs,
			todayMinutes: Math.round((earlierToday + studyMs) / 60_000),
			shape: session.shape,
			anchor: anchorOutcome(tx, session, request),
			drillsCorrect: (request.drills ?? []).filter((d) => d.correct).length,
			drillsTotal: served.drills.length,
			minedErrors: writingRepo(tx).forSession(session.id)?.minedCount ?? 0
		};
		sessions.markFinished(session.id, { clientSessionId: request.clientSessionId, finishedAt: now, itemsDone: request.results.length, summary });
		return summary;
	});
}
