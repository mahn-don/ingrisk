// Shared fixtures for the SRS specs.
import type { Db } from '../db/client.ts';
import { cardsRepo, type CardRow } from '../db/repositories/cards.ts';
import { lexemes } from '../db/schema.ts';
import { createTestDb } from '../db/test-db.ts';
import { newCardFields } from './mapping.ts';

/** 2026-10-05 09:00 in Asia/Ho_Chi_Minh. */
export const T0 = new Date('2026-10-05T02:00:00Z');
export const MINUTE = 60_000;
export const DAY = 86_400_000;
export const NO_FUZZ = { fuzz: false } as const;

export function setupDb(): Db {
	return createTestDb();
}

let counter = 0;

/** Insert a New cloze card for a fresh lexeme, created at `now`. */
export function addNewCard(db: Db, now: Date = T0): CardRow {
	counter++;
	const lexeme = db
		.insert(lexemes)
		.values({ headword: `word${counter}`, forms: [`word${counter}`], source: 'test', licenseTag: 'test' })
		.returning()
		.get();
	const row = cardsRepo(db).insertIfAbsent({ kind: 'cloze', lexemeId: lexeme.id, ...newCardFields(now) });
	if (row === undefined) throw new Error('card already exists');
	return row;
}
