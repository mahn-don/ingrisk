// Starting and finishing a session. One request in (start: the whole session), one request out
// (finish: every result, applied in one transaction). See plans/phase-09a.md.
import { randomUUID } from 'node:crypto';
import type { DbOrTx } from '../db/client.ts';
import { cardsRepo } from '../db/repositories/cards.ts';
import { type SessionRow, sessionsRepo } from '../db/repositories/sessions.ts';
import { settingsRepo } from '../db/repositories/settings.ts';
import type { ServedItem } from '../db/schema.ts';
import { type ReviewInput, ReviewTimeError, learningDayStart, ratingFromOutcome, reviewBatch } from '../srs/index.ts';
import type { FinishRequest, FinishSummary, StartResponse } from '../../session/types.ts';
import { composeSession } from './compose.ts';

/** Offsets may run this far past the server's own elapsed time (network, clocks). */
export const OFFSET_SLACK_MS = 5_000;
/** Response times are clamped to this (a phone left on the table). */
export const MAX_RESPONSE_MS = 10 * 60_000;

export class SessionError extends Error {
	readonly status: 400 | 404 | 409;
	readonly code: 'invalid' | 'not_found' | 'not_in_progress' | 'client_id_taken' | 'review_rejected';
	constructor(status: SessionError['status'], code: SessionError['code'], message: string) {
		super(message);
		this.name = 'SessionError';
		this.status = status;
		this.code = code;
	}
}

/**
 * Start a quick session: abandon the one in progress (its answers are lost), compose, and store the
 * served items. An empty composition stores nothing and returns the reason.
 */
export function startSession(db: DbOrTx, now: Date, options: { budgetMin?: number } = {}): StartResponse {
	return db.transaction((tx) => {
		const sessions = sessionsRepo(tx);
		sessions.abandonInProgress(now);
		const budgetMin = options.budgetMin ?? settingsRepo(tx).get().defaultSessionBudget;
		const composed = composeSession(tx, now, { budgetMin });
		if (composed.items.length === 0) return { sessionId: null, startedAt: now.getTime(), items: [], reason: composed.reason ?? 'all_done' };
		const served: ServedItem[] = composed.items.map((i) => ({ cardId: i.cardId, mode: i.mode, isNew: i.isNew }));
		const row = sessions.start({ startedAt: now, budgetMin, shape: 'quick', served, placeholderId: `pending:${randomUUID()}` });
		return { sessionId: row.id, startedAt: now.getTime(), items: composed.items };
	});
}

/** Check the results against the served items and the clock; returns the reviews to apply. */
export function validateResults(session: SessionRow, request: FinishRequest, now: Date): ReviewInput[] {
	const served = new Map(session.servedJson.map((s) => [s.cardId, s]));
	const seen = new Set<number>();
	const latestOffset = now.getTime() - session.startedAt.getTime() + OFFSET_SLACK_MS;
	let previousOffset = 0;
	return request.results.map((r) => {
		const item = served.get(r.cardId);
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
}

/**
 * Finish a session: validate, apply every review and record the session in ONE transaction, and
 * return the summary. A repeated call with the same clientSessionId returns the stored summary
 * without applying anything again. A partial finish (ended early) sends only the answered items.
 */
export function finishSession(db: DbOrTx, now: Date, request: FinishRequest): FinishSummary {
	return db.transaction((tx) => {
		const sessions = sessionsRepo(tx);
		const byClient = sessions.byClientSessionId(request.clientSessionId);
		if (byClient !== undefined) {
			if (byClient.id === request.sessionId && byClient.status === 'finished' && byClient.summaryJson !== null) return byClient.summaryJson;
			throw new SessionError(409, 'client_id_taken', 'clientSessionId belongs to another session');
		}
		const session = sessions.byId(request.sessionId);
		if (session === undefined) throw new SessionError(404, 'not_found', 'no such session');
		if (session.status !== 'in_progress') throw new SessionError(409, 'not_in_progress', `session is ${session.status}`);

		const reviews = validateResults(session, request, now);
		let applied;
		try {
			applied = reviewBatch(tx, reviews, now);
		} catch (error) {
			if (error instanceof ReviewTimeError) throw new SessionError(409, 'review_rejected', error.message);
			throw error;
		}
		const correct = request.results.filter((r) => r.correct).length;
		const studyMs = request.results.reduce((n, r) => n + Math.min(MAX_RESPONSE_MS, Math.max(0, r.responseMs)), 0);
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
			todayMinutes: Math.round((earlierToday + studyMs) / 60_000)
		};
		sessions.markFinished(session.id, { clientSessionId: request.clientSessionId, finishedAt: now, itemsDone: request.results.length, summary });
		return summary;
	});
}
