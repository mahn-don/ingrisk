// Test helper: a fresh in-memory database with all migrations applied.
import { createDb, migrate, type Db } from './client.ts';

export function createTestDb(): Db {
	const db = createDb(':memory:');
	migrate(db);
	return db;
}
