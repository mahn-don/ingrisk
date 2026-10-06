// The session API's shapes, shared by the server and the session page.
import type { Grade } from 'ts-fsrs';
import type { PromptMode } from './rating.ts';

export type GapType = 'lexical' | 'article' | 'preposition' | 'verb_form' | 'user_error';
export type SessionShape = 'quick' | 'read' | 'write';
export type TopicCode = 'ART' | 'TNS' | 'PLU' | 'SVA' | 'COP' | 'PRE' | 'COL' | 'WFM' | 'WOR' | 'OTH';
export type IntervalUnit = 'minute' | 'hour' | 'day' | 'month' | 'year';

export interface SessionItem {
	cardId: number;
	mode: PromptMode;
	gapType: GapType;
	/** The card was never reviewed. */
	isNew: boolean;
	/** A card on the learner's own mined error ("Lỗi của bạn"). */
	isMined: boolean;
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
	/** The Vietnamese sentence ('' when there is none): always shown in typing mode as a cue. */
	viTranslation: string;
	/** Lexical gaps: the answer's meaning. Mined errors: why (explanation_vi). */
	answerVi: string | null;
	levelBand: number;
	/** The interval each rating would give, Again..Easy, computed when the session started. */
	intervals: Record<Grade, { value: number; unit: IntervalUnit }>;
}

/** focus_empty: a focus session (hardest cards, one topic) found nothing to practise. */
export type EmptyReason = 'no_content' | 'all_done' | 'focus_empty';

/** A one-off error-correction drill (Phase 9b): not a card. */
export interface DrillItem {
	cacheId: number;
	topicCode: TopicCode;
	topicNameVi: string;
	sentenceWithError: string;
	corrected: string;
	originalSpan: string;
	correctedSpan: string;
	explanationVi: string;
}

export interface GlossaryEntry {
	word: string;
	vi: string;
	/** A validated cloze item exists for its lexeme and has no card: "Thêm vào ôn tập". */
	addable: boolean;
}

export interface ReadingQuestion {
	question: string;
	options: string[];
	answerIndex: number;
	explanationVi: string;
}

export type Anchor =
	| { type: 'reading'; cacheId: number; title: string; passage: string; glossary: GlossaryEntry[]; questions: ReadingQuestion[] }
	| { type: 'writing'; promptId: string; promptVi: string; hint: string; minWords: number; maxWords: number }
	| { type: 'translation'; sentenceId: number; vi: string; referenceEn: string };

export interface FeedbackError {
	original: string;
	correction: string;
	topicCode: TopicCode;
	topicNameVi: string;
	explanationVi: string;
	/** Errors of this code in the text (2+: shown as "lặp lại N lần"). */
	repeats: number;
}

/** Graded writing the learner has not seen yet, or the feedback of the anchor just submitted. */
export interface FeedbackCard {
	submissionId: number;
	taskKind: 'writing' | 'translation';
	/** From the placement test (no session). */
	placement: boolean;
	prompt: string;
	userText: string;
	/** Null in indirect feedback mode (the learner corrects it). */
	correctedText: string | null;
	/** At most 3, distinct error codes first. */
	errors: FeedbackError[];
	/** Every error the grading found (all mined into cards). */
	totalErrors: number;
	cefr: string | null;
	onTopic: boolean | null;
	taskNoteVi: string | null;
	meaningOk: boolean | null;
	referenceEn: string | null;
	/** Cards made from its errors. */
	mined: number;
}

export interface ShapeOption {
	shape: SessionShape;
	available: boolean;
}

export type StartResponse =
	| {
			sessionId: number;
			startedAt: number;
			shape: SessionShape;
			items: SessionItem[];
			drills: DrillItem[];
			anchor: Anchor | null;
			feedback: FeedbackCard[];
	  }
	| { sessionId: null; startedAt: number; shape: SessionShape; items: []; drills: []; anchor: null; feedback: FeedbackCard[]; reason: EmptyReason };

/** POST /api/session/anchor: graded feedback, or queued when grading did not finish in time. */
/** Why a writing waits for grading: no active provider, the provider failed, or it took over 30 s. */
export type QueuedReason = 'no_provider' | 'llm_error' | 'timeout' | 'pending';
export type AnchorResponse = { queued: false; feedback: FeedbackCard } | { queued: true; reason: QueuedReason };

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

export interface DrillResult {
	cacheId: number;
	correct: boolean;
	responseMs: number;
}

export type AnchorResult = { type: 'reading'; cacheId: number; answers: number[] } | { type: 'writing' } | { type: 'translation' };

export interface FinishRequest {
	sessionId: number;
	clientSessionId: string;
	results: SessionResult[];
	drills?: DrillResult[];
	anchor?: AnchorResult;
}

export type AnchorOutcome =
	| { type: 'reading'; correct: number; total: number }
	| { type: 'writing' | 'translation'; status: 'scored' | 'queued' | 'skipped' };

export interface FinishSummary {
	answered: number;
	correct: number;
	accuracy: number;
	strengthened: number;
	newIntroduced: number;
	nextDueAt: number | null;
	studyMs: number;
	todayMinutes: number;
	// Phase 9b (absent from older stored summaries)
	shape?: SessionShape;
	anchor?: AnchorOutcome | null;
	drillsCorrect?: number;
	drillsTotal?: number;
	/** New cards made from the learner's errors in this session ("Lỗi mới được thêm vào ôn tập"). */
	minedErrors?: number;
}

/** No-word option for article gaps. */
export const NO_WORD = '—';
