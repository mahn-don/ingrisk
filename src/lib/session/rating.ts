// Inferring an FSRS rating from how the learner answered, so sessions need no rating buttons.
// Shared by the session page (to show "Ôn lại sau …") and the server (src/lib/server/srs/rating.ts).
import type { Grade } from 'ts-fsrs';

export type PromptMode = 'choice' | 'typing';

/** ts-fsrs Rating values (kept as plain numbers so the client bundle needs no ts-fsrs). */
export const AGAIN = 1 as Grade;
export const HARD = 2 as Grade;
export const GOOD = 3 as Grade;
export const EASY = 4 as Grade;
export const GRADES: readonly Grade[] = [AGAIN, HARD, GOOD, EASY];

/** Correct answers slower than this (ms) are rated Hard. */
export const SLOW_THRESHOLD_MS: Readonly<Record<PromptMode, number>> = { choice: 8_000, typing: 15_000 };
/** Correct typed answers faster than this (ms), without a hint, are rated Easy. */
export const EASY_THRESHOLD_MS = 5_000;

export interface Outcome {
	correct: boolean;
	mode: PromptMode;
	responseMs: number;
	hintUsed: boolean;
}

/**
 * Wrong -> Again. Correct with a hint or slower than the slow threshold -> Hard.
 * Correct, typed, faster than 5 s, no hint -> Easy. Any other correct answer -> Good.
 * Multiple choice never gives Easy: recognising an answer is easier than recalling it.
 * Thresholds are strict: exactly 8 s (choice) is not slow, exactly 5 s is not Easy.
 */
export function ratingFromOutcome({ correct, mode, responseMs, hintUsed }: Outcome): Grade {
	if (!correct) return AGAIN;
	if (hintUsed || responseMs > SLOW_THRESHOLD_MS[mode]) return HARD;
	if (mode === 'typing' && responseMs < EASY_THRESHOLD_MS) return EASY;
	return GOOD;
}
