// Every schema version upgrades cleanly (Phase 11): a database stopped after each earlier
// migration, then migrated to the latest, passes foreign_key_check and integrity_check and ends
// with exactly the schema a fresh database gets.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type Db, createDb, migrate, migrationsFolder } from './client.ts';

const full = migrationsFolder();
const journal = JSON.parse(readFileSync(join(full, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
const root = mkdtempSync(join(tmpdir(), 'se-migrations-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A migrations folder holding only the first `n` migrations. */
function prefix(n: number): string {
	const dir = join(root, `upto-${n}`);
	mkdirSync(join(dir, 'meta'), { recursive: true });
	writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, n) }));
	for (const entry of journal.entries.slice(0, n)) copyFileSync(join(full, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
	return dir;
}

/** The schema as SQL text, normalized (tables, indexes, triggers; drizzle's own table left out). */
function schemaOf(db: Db): string[] {
	const rows = db.$client
		.prepare("select type, name, sql from sqlite_master where sql is not null and name not like '__drizzle%' and name not like 'sqlite_%' order by type, name")
		.all() as { type: string; name: string; sql: string }[];
	return rows.map((r) => `${r.type} ${r.name}: ${r.sql.replace(/\s+/g, ' ').replace(/"/g, '`')}`);
}

const clean = (db: Db) => {
	expect(db.$client.pragma('foreign_key_check')).toEqual([]);
	expect(db.$client.pragma('integrity_check', { simple: true })).toBe('ok');
};

describe('migrations from every earlier version', () => {
	const fresh = createDb(':memory:');
	migrate(fresh);

	it('a fresh database is clean', () => {
		clean(fresh);
		expect(journal.entries.length).toBeGreaterThanOrEqual(10);
	});

	for (let n = 1; n < journal.entries.length; n++) {
		it(`a database at ${journal.entries[n - 1].tag} upgrades to the latest schema`, () => {
			const db = createDb(':memory:');
			migrate(db, prefix(n));
			clean(db);
			migrate(db);
			clean(db);
			expect(schemaOf(db)).toEqual(schemaOf(fresh));
			const applied = db.$client.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number };
			expect(applied.n).toBe(journal.entries.length);
			db.$client.close();
		});
	}
});
