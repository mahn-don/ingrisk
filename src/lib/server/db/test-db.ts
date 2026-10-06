// Test helper: a fresh in-memory database with all migrations applied.
import { createDb, migrate, type Db } from './client.ts';
import { FIRST_PROFILE_ID } from './repositories/profiles.ts';

export function createTestDb(): Db {
	const db = createDb(':memory:');
	migrate(db);
	return db;
}

/** The profile every migrated database starts with ("Hồ sơ 1", migration 0010): tests use it as the learner. */
export const TEST_PROFILE = FIRST_PROFILE_ID;
