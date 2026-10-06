// Inferring a rating from how the learner answered. The rule lives in src/lib/session/rating.ts,
// shared with the session page (no server imports there); re-exported here for the engine.
export {
	EASY_THRESHOLD_MS,
	type Outcome,
	type PromptMode,
	SLOW_THRESHOLD_MS,
	ratingFromOutcome
} from '../../session/rating.ts';
