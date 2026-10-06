// "Tải bản sao lưu": a consistent copy of the database (VACUUM INTO a temp file), read into memory
// for the download, then the temp file is deleted.
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../db/client.ts';

/** The backup file's name for `now` (Asia/Ho_Chi_Minh date). */
export function backupFileName(now: Date): string {
	return `silentenglish-${new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10)}.db`;
}

/** The database as SQLite file bytes; the temp file never outlives the call. */
export async function backupBytes(db: Db, dir: string = tmpdir()): Promise<Buffer> {
	const path = join(dir, `silentenglish-backup-${randomUUID()}.db`);
	try {
		db.$client.prepare('VACUUM INTO ?').run(path);
		return await readFile(path);
	} finally {
		await rm(path, { force: true });
	}
}
