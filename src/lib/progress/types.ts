// What the stats page and Home's "today" card show (Phase 10); computed on the server
// (src/lib/server/progress/), shared with the pages.
import type { TopicCode } from '../session/types.ts';

/** A learning date: the Asia/Ho_Chi_Minh calendar date its learning day (from 04:00) starts on. */
export type LearningDate = string;

export interface Streak {
	/** Studied days in a row up to today (a day not yet studied today does not break it). */
	current: number;
	longest: number;
	/** Freezes waiting to cover a missed day (at most 2). */
	freezesBanked: number;
	/** The missed days a freeze covered, oldest first. */
	freezesUsedDates: LearningDate[];
	studiedToday: boolean;
}

export interface WeekGoal {
	/** Monday of the week. */
	weekStart: LearningDate;
	studiedDays: number;
	goal: number;
	/** Null for a week before the first session. */
	hit: boolean | null;
}

export interface WeeklyGoal {
	goal: number;
	thisWeek: WeekGoal;
	/** The 8 weeks before this one, oldest first. */
	past: WeekGoal[];
}

/** 0: no study; 1: under 5 minutes; 2: 5 to under 10; 3: 10 or more. */
export type HeatBucket = 0 | 1 | 2 | 3;

export interface HeatCell {
	date: LearningDate;
	minutes: number;
	bucket: HeatBucket;
	/** After today (the rest of this week): drawn empty. */
	future: boolean;
}

/** 12 weeks (Monday first), oldest first; each week holds 7 days, Monday to Sunday. */
export type HeatMap = HeatCell[][];

export interface ForecastDay {
	date: LearningDate;
	/** Cards due that day; today's count includes the overdue ones. */
	due: number;
}

export interface Totals {
	/** Lexical cards in the Review state. */
	wordsLearned: number;
	/** Cards in Learning or Relearning. */
	cardsInLearning: number;
	minutes: number;
	sessions: number;
	minedAdded: number;
	minedInReview: number;
}

export interface TopicWeakness {
	code: TopicCode;
	nameVi: string;
	/** Errors in graded writing over the last 30 days. */
	writingErrors: number;
	drillsCorrect: number;
	drillsTotal: number;
	/** Reviews of this topic's grammar cloze cards over the last 30 days. */
	clozeCorrect: number;
	clozeTotal: number;
	/** Accuracy per gap type (the topic's grammar cards). */
	byGapType: { gapType: string; correct: number; total: number }[];
	/** writing errors + missed drills + Again on cloze cards: higher is weaker. */
	score: number;
	/** The topic has introduced, unsuspended cards or cached drills: "Luyện chủ đề này" works. */
	practicable: boolean;
}

export interface LevelEntry {
	takenAt: number;
	cefr: string;
	abilityBand: number;
	vocabBand: number;
}

export interface Progress {
	streak: Streak;
	weekly: WeeklyGoal;
	heatMap: HeatMap;
	forecast: ForecastDay[];
	totals: Totals;
	weakness: TopicWeakness[];
	levels: LevelEntry[];
}

/** Home's compact "today" card. */
export interface TodaySummary {
	streak: Streak;
	thisWeek: WeekGoal;
	/** The next review time (ms), or null when nothing is introduced. */
	nextReviewAt: number | null;
	/** Mined error cards not yet reviewed. */
	minedWaiting: number;
}
