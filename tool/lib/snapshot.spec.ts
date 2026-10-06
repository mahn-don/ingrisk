import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, migrate } from '../../src/lib/server/db/client.ts';
import { integrityCheck } from '../../src/lib/server/settings/backup.ts';
import { expiredSnapshots, snapshotDatabase, snapshotName, uniqueName } from './snapshot.ts';

const root = mkdtempSync(join(tmpdir(), 'se-snapshot-test-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A migrated database file with one card row's worth of content (a provider row). */
function liveDb(name: string): string {
	const path = join(root, name);
	const db = createDb(path);
	migrate(db);
	db.$client.prepare("insert into llm_providers (name, base_url, model, wire_format) values ('x', 'https://a.example', 'm', 'openai')").run();
	db.$client.close();
	return path;
}

describe('snapshot names and retention', () => {
	it('names sort by Asia/Ho_Chi_Minh time, with an optional label', () => {
		expect(snapshotName(new Date('2026-10-06T20:30:00Z'))).toBe('app-20261007-0330.db');
		expect(snapshotName(new Date('2026-10-06T20:30:00Z'), 'predeploy')).toBe('app-20261007-0330-predeploy.db');
		expect(() => snapshotName(new Date(), 'Bad Label')).toThrow(/label/);
		const taken = new Set(['app-20261007-0330.db', 'app-20261007-0330-2.db']);
		expect(uniqueName('app-20261007-0330.db', (n) => taken.has(n))).toBe('app-20261007-0330-3.db');
		expect(uniqueName('app-20261007-0331.db', (n) => taken.has(n))).toBe('app-20261007-0331.db');
	});

	it('keeps exactly the newest 14 snapshots and never touches other files', () => {
		const names = Array.from({ length: 20 }, (_, i) => `app-202610${String(i + 1).padStart(2, '0')}-0330.db`);
		const expired = expiredSnapshots([...names, 'notes.txt', 'app.db', 'app-2026-x.db'], 14);
		expect(expired).toHaveLength(6);
		expect(expired.sort()).toEqual(names.slice(0, 6));
		expect(expiredSnapshots(names.slice(0, 3), 14)).toEqual([]);
	});
});

describe('snapshotDatabase', () => {
	it('writes a valid, integrity-checked copy (mode 600) and keeps the newest 14', () => {
		const dbPath = liveDb('live.db');
		const dir = join(root, 'backups');
		// The live database is open (WAL) while the snapshot runs, as under the server.
		const server = new Database(dbPath);
		server.pragma('journal_mode = WAL');
		const result = snapshotDatabase({ dbPath, dir, now: new Date('2026-10-06T20:30:00Z') });
		server.close();
		if (result.status !== 'ok') throw new Error('skipped');
		expect(result.path).toBe(join(dir, 'app-20261007-0330.db'));
		expect(integrityCheck(result.path)).toBe('ok');
		expect(statSync(result.path).mode & 0o777).toBe(0o600);
		const copy = new Database(result.path, { readonly: true });
		expect(copy.prepare('select name from llm_providers').all()).toEqual([{ name: 'x' }]);
		copy.close();

		writeFileSync(join(dir, 'README.txt'), 'not a snapshot');
		for (let i = 1; i <= 16; i++) snapshotDatabase({ dbPath, dir, now: new Date(Date.UTC(2026, 9, 7 + i, 1, 0)) });
		const left = readdirSync(dir).filter((n) => n.startsWith('app-'));
		expect(left).toHaveLength(14);
		expect(left.sort()[0]).toBe('app-20261010-0800.db');
		expect(readdirSync(dir)).toContain('README.txt');
	});

	it('two snapshots in the same minute both survive; a missing database is skipped', () => {
		const dbPath = liveDb('twice.db');
		const dir = join(root, 'twice');
		const now = new Date('2026-10-06T20:30:00Z');
		snapshotDatabase({ dbPath, dir, now, label: 'predeploy' });
		snapshotDatabase({ dbPath, dir, now, label: 'predeploy' });
		expect(readdirSync(dir).sort()).toEqual(['app-20261007-0330-predeploy-2.db', 'app-20261007-0330-predeploy.db']);
		expect(snapshotDatabase({ dbPath: join(root, 'nope.db'), dir, now })).toEqual({ status: 'skipped', reason: `no database at ${join(root, 'nope.db')}` });
		expect(() => snapshotDatabase({ dbPath, dir, now, keep: 0 })).toThrow(/keep/);
	});

	it('a corrupt snapshot is refused: integrity_check reports it', () => {
		const path = join(root, 'corrupt.db');
		const db = new Database(path);
		db.exec('create table t (x); insert into t values (1);');
		db.close();
		const bytes = readFileSync(path);
		bytes.fill(0xff, 100, 4096); // trash the schema page after the header
		writeFileSync(path, bytes);
		let result: string;
		try {
			result = integrityCheck(path);
		} catch (error) {
			result = (error as Error).message;
		}
		expect(result).not.toBe('ok');
	});
});
