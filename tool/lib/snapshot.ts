// `npm run db:snapshot`: a VACUUM INTO copy of the app database in data/backups/, checked with
// PRAGMA integrity_check, keeping the newest N. Names sort by time: app-YYYYMMDD-HHMM[-label].db
// (Asia/Ho_Chi_Minh).
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { integrityCheck, vacuumInto } from '../../src/lib/server/settings/backup.ts';

export const DEFAULT_KEEP = 14;
export const DEFAULT_DIR = 'data/backups';
const SNAPSHOT = /^app-\d{8}-\d{4}(?:-[a-z0-9-]+)?\.db$/;
const LABEL = /^[a-z0-9-]{1,30}$/;

/** app-YYYYMMDD-HHMM[-label].db for `now` in Asia/Ho_Chi_Minh. */
export function snapshotName(now: Date, label?: string): string {
	if (label !== undefined && !LABEL.test(label)) throw new Error(`label must match ${LABEL}`);
	const t = new Date(now.getTime() + 7 * 3_600_000).toISOString();
	const stamp = `${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}-${t.slice(11, 13)}${t.slice(14, 16)}`;
	return `app-${stamp}${label === undefined ? '' : `-${label}`}.db`;
}

/** `name`, or name-2.db, name-3.db … when it is taken (two snapshots in one minute). */
export function uniqueName(name: string, taken: (name: string) => boolean): string {
	if (!taken(name)) return name;
	for (let n = 2; ; n++) {
		const candidate = name.replace(/\.db$/, `-${n}.db`);
		if (!taken(candidate)) return candidate;
	}
}

/** Snapshot files beyond the newest `keep` (other files in the directory are never touched). */
export function expiredSnapshots(names: readonly string[], keep: number): string[] {
	return names
		.filter((n) => SNAPSHOT.test(n))
		.sort()
		.reverse()
		.slice(keep);
}

export type SnapshotResult =
	| { status: 'skipped'; reason: string }
	| { status: 'ok'; path: string; bytes: number; deleted: string[] };

/**
 * Snapshot `dbPath` into `dir` (mode 600), verify it, then delete the snapshots beyond `keep`. A
 * snapshot that fails the integrity check is deleted and this throws (the old ones are kept).
 */
export function snapshotDatabase(options: { dbPath: string; dir: string; now: Date; keep?: number; label?: string }): SnapshotResult {
	const keep = options.keep ?? DEFAULT_KEEP;
	if (!Number.isInteger(keep) || keep < 1) throw new Error('keep must be a positive integer');
	if (!existsSync(options.dbPath)) return { status: 'skipped', reason: `no database at ${options.dbPath}` };
	mkdirSync(options.dir, { recursive: true });
	const path = join(options.dir, uniqueName(snapshotName(options.now, options.label), (n) => existsSync(join(options.dir, n))));
	const source = new Database(options.dbPath, { fileMustExist: true });
	try {
		source.pragma('busy_timeout = 5000');
		vacuumInto(source, path);
	} finally {
		source.close();
	}
	chmodSync(path, 0o600);
	const integrity = integrityCheck(path);
	if (integrity !== 'ok') {
		rmSync(path, { force: true });
		throw new Error(`snapshot failed the integrity check: ${integrity}`);
	}
	const deleted = expiredSnapshots(readdirSync(options.dir), keep);
	for (const name of deleted) rmSync(join(options.dir, name), { force: true });
	return { status: 'ok', path, bytes: statSync(path).size, deleted };
}
