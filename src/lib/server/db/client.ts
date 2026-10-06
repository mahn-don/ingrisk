// SQLite connection: pragmas, migrations and the app-wide singleton.
// Imports use explicit .ts extensions so `npm run db:migrate` can run this file with plain Node.
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
/** A database or an open transaction: repositories accept either, so callers can compose writes atomically. */
export type DbOrTx = BaseSQLiteDatabase<'sync', Database.RunResult, typeof schema>;

export const DEFAULT_DATABASE_PATH = 'data/app.db';

/**
 * Migrations are read from the source tree. The server runs from the repository root
 * (`node build` there; see deploy/), so this path resolves in dev, tests, scripts and production.
 * MIGRATIONS_DIR overrides it.
 */
export function migrationsFolder(): string {
	return resolve(process.env.MIGRATIONS_DIR ?? 'src/lib/server/db/migrations');
}

/** Open a database (a file path or ':memory:') with the pragmas the app relies on. */
export function createDb(path: string): Db {
	if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
	const sqlite = new Database(path);
	sqlite.pragma('journal_mode = WAL'); // required by Litestream
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('busy_timeout = 5000');
	sqlite.pragma('synchronous = NORMAL');
	return drizzle(sqlite, { schema });
}

/**
 * Apply pending migrations. Already-applied migrations are skipped, so this is safe to repeat.
 *
 * Foreign keys are off while migrations run (from 0008 on): drizzle's migrator wraps every
 * migration in one transaction, where the `PRAGMA foreign_keys=OFF` lines drizzle-kit emits are
 * no-ops, so a table rebuild (needed to change a CHECK) could not drop a table that others
 * reference (ON DELETE RESTRICT fails, SET NULL silently nulls the links). Afterwards
 * `foreign_key_check` must come back empty, or this throws and the server refuses to start.
 */
export function migrate(db: Db, folder = migrationsFolder()): void {
	if (!existsSync(folder)) throw new Error(`Migrations folder not found: ${folder}`);
	const enforced = db.$client.pragma('foreign_keys', { simple: true }) === 1;
	db.$client.pragma('foreign_keys = OFF');
	try {
		drizzleMigrate(db, { migrationsFolder: folder });
	} finally {
		if (enforced) db.$client.pragma('foreign_keys = ON');
	}
	const violations = db.$client.pragma('foreign_key_check') as unknown[];
	if (violations.length > 0) throw new Error(`Foreign key check failed after migrating: ${JSON.stringify(violations.slice(0, 5))}`);
}

let instance: Db | undefined;

/** The app database at DATABASE_PATH (default data/app.db), opened and migrated on first use. */
export function getDb(): Db {
	if (instance === undefined) {
		const db = createDb(process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH);
		try {
			migrate(db);
		} catch (error) {
			db.$client.close();
			throw new Error(`Database migration failed: ${(error as Error).message}`, { cause: error });
		}
		instance = db;
	}
	return instance;
}
