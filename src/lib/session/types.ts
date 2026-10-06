// The session API's shapes, shared by the server and the session page.
import type { Grade } from 'ts-fsrs';
import type { PromptMode } from './rating.ts';

export type GapType = 'lexical' | 'article' | 'preposition' | 'verb_form';
export type IntervalUnit = 'minute' | 'hour' | 'day' | 'month' | 'year';

export interface SessionItem {
	cardId: number;
	mode: PromptMode;
	gapType: GapType;
	/** The card was never reviewed. */
	isNew: boolean;
	/** The sentence with the gap as "___". */
	sentenceWithGap: string;
	/** The sentence around the gap (for drawing it). */
	before: string;
	after: string;
	/** Choice mode only, in display order; "—" means "no word". */
	options?: string[];
	answer: string;
	/** The sentence with the answer filled in (the "—" answer removes the gap). */
	filled: string;
	viTranslation: string;
	answerVi: string | null;
	levelBand: number;
	/** The interval each rating would give, Again..Easy, computed when the session started. */
	intervals: Record<Grade, { value: number; unit: IntervalUnit }>;
}

export type EmptyReason = 'no_content' | 'all_done';

export type StartResponse =
	| { sessionId: number; startedAt: number; items: SessionItem[] }
	| { sessionId: null; startedAt: number; items: []; reason: EmptyReason };

export interface SessionResult {
	cardId: number;
	correct: boolean;
	mode: PromptMode;
	responseMs: number;
	hintUsed: boolean;
	ratingOverride?: Grade;
	/** Milliseconds after the session's start (the start response's arrival) when it was answered. */
	answeredOffsetMs: number;
}

export interface FinishRequest {
	sessionId: number;
	clientSessionId: string;
	results: SessionResult[];
}

export interface FinishSummary {
	answered: number;
	correct: number;
	accuracy: number;
	strengthened: number;
	newIntroduced: number;
	nextDueAt: number | null;
	studyMs: number;
	todayMinutes: number;
}

/** No-word option for article gaps. */
export const NO_WORD = '—';
