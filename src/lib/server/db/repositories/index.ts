// Intent-level data access. Callers use these functions, never raw queries.
import { getDb, type DbOrTx } from '../client.ts';
import { cacheRepo } from './cache.ts';
import { cardsRepo } from './cards.ts';
import { clozeItemsRepo } from './cloze-items.ts';
import { grammarTopicsRepo } from './grammar-topics.ts';
import { jobLocksRepo } from './job-locks.ts';
import { lexemesRepo } from './lexemes.ts';
import { llmCallsRepo } from './llm-calls.ts';
import { placementRepo } from './placement.ts';
import { profileRepo } from './profile.ts';
import { providersRepo } from './providers.ts';
import { reviewLogsRepo } from './review-logs.ts';
import { sentencesRepo } from './sentences.ts';
import { sessionsRepo } from './sessions.ts';
import { settingsRepo } from './settings.ts';
import { writingRepo } from './writing.ts';

/** All repositories bound to one database (tests pass an in-memory one). */
export function createRepositories(db: DbOrTx) {
	return {
		settings: settingsRepo(db),
		profile: profileRepo(db),
		providers: providersRepo(db),
		cards: cardsRepo(db),
		reviewLogs: reviewLogsRepo(db),
		cache: cacheRepo(db),
		writing: writingRepo(db),
		sessions: sessionsRepo(db),
		grammarTopics: grammarTopicsRepo(db),
		llmCalls: llmCallsRepo(db),
		lexemes: lexemesRepo(db),
		sentences: sentencesRepo(db),
		clozeItems: clozeItemsRepo(db),
		jobLocks: jobLocksRepo(db),
		placement: placementRepo(db)
	};
}

export type Repositories = ReturnType<typeof createRepositories>;

let repositories: Repositories | undefined;

/** Repositories bound to the app database (opened and migrated on first use). */
export function repos(): Repositories {
	repositories ??= createRepositories(getDb());
	return repositories;
}
