// Consistent copies of the database (VACUUM INTO). "Tải bản sao lưu" reads one into memory for the
// download and deletes it; `npm run db:snapshot` (deploy/backup.sh, deploy/deploy.sh) keeps them
// in data/backups/.
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Db } from '../db/client.ts';

/** The backup file's name for `now` (Asia/Ho_Chi_Minh date). */
export function backupFileName(now: Date): string {
	return `silentenglish-${new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)}.db`;
}

/** Write a consistent, compacted copy of the open database to `path` (which must not exist). */
export function vacuumInto(sqlite: Database.Database, path: string): void {
	sqlite.prepare('VACUUM INTO ?').run(path);
}

/** `PRAGMA integrity_check` on a database file, opened read-only: 'ok', or the problems found. */
export function integrityCheck(path: string): string {
	const db = new Database(path, { readonly: true, fileMustExist: true });
	try {
		const rows = db.pragma('integrity_check') as { integrity_check: string }[];
		return rows.map((r) => r.integrity_check).join('; ');
	} finally {
		db.close();
	}
}

/** The database as SQLite file bytes; the temp file never outlives the call. */
export async function backupBytes(db: Db, dir: string = tmpdir()): Promise<Buffer> {
	const path = join(dir, `silentenglish-backup-${randomUUID()}.db`);
	try {
		vacuumInto(db.$client, path);
		return await readFile(path);
	} finally {
		await rm(path, { force: true });
	}
}
