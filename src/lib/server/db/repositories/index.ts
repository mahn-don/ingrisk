// Intent-level data access. Callers use these functions, never raw queries.
import { getDb, type DbOrTx } from '../client.ts';
import { cacheRepo } from './cache.ts';
import { cardsRepo } from './cards.ts';
import { clozeItemsRepo, learnerClozeRepo } from './cloze-items.ts';
import { drillResultsRepo } from './drill-results.ts';
import { grammarTopicsRepo } from './grammar-topics.ts';
import { jobLocksRepo } from './job-locks.ts';
import { lexemesRepo } from './lexemes.ts';
import { llmCallsRepo } from './llm-calls.ts';
import { placementRepo } from './placement.ts';
import { profileRepo } from './profile.ts';
import { profilesRepo } from './profiles.ts';
import { providersRepo } from './providers.ts';
import { reviewBookRepo } from './review-book.ts';
import { reviewLogsRepo } from './review-logs.ts';
import { sentencesRepo } from './sentences.ts';
import { sessionsRepo } from './sessions.ts';
import { learningSettingsRepo, settingsRepo } from './settings.ts';
import { writingRepo } from './writing.ts';

/** The shared repositories bound to one database (tests pass an in-memory one). */
export function createRepositories(db: DbOrTx) {
	return {
		settings: settingsRepo(db),
		profiles: profilesRepo(db),
		providers: providersRepo(db),
		cache: cacheRepo(db),
		grammarTopics: grammarTopicsRepo(db),
		llmCalls: llmCallsRepo(db),
		lexemes: lexemesRepo(db),
		sentences: sentencesRepo(db),
		clozeItems: clozeItemsRepo(db),
		jobLocks: jobLocksRepo(db)
	};
}

/** One learner's repositories (Phase 12): every query limited to `profileId`. */
export function learnerRepositories(db: DbOrTx, profileId: number) {
	return {
		profile: profileRepo(db, profileId),
		learningSettings: learningSettingsRepo(db, profileId),
		cards: cardsRepo(db, profileId),
		reviewLogs: reviewLogsRepo(db, profileId),
		writing: writingRepo(db, profileId),
		sessions: sessionsRepo(db, profileId),
		placement: placementRepo(db, profileId),
		drillResults: drillResultsRepo(db, profileId),
		clozeItems: learnerClozeRepo(db, profileId),
		reviewBook: reviewBookRepo(db, profileId)
	};
}

export type Repositories = ReturnType<typeof createRepositories>;

let repositories: Repositories | undefined;

/** Repositories bound to the app database (opened and migrated on first use). */
export function repos(): Repositories {
	repositories ??= createRepositories(getDb());
	return repositories;
}
