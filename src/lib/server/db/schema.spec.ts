import { eq } from 'drizzle-orm';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyCard } from 'ts-fsrs';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, migrate, migrationsFolder, type Db } from './client.ts';
import {
	cards,
	collocations,
	grammarTopics,
	lexemes,
	llmProviders,
	placementResults,
	reviewLogs,
	sentences,
	sessions,
	settings,
	userProfile
} from './schema.ts';
import { createTestDb } from './test-db.ts';

function tableNames(db: Db): string[] {
	return db.$client
		.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
		.pluck()
		.all() as string[];
}

function columnNames(db: Db, table: string): string[] {
	return (db.$client.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}

const newCard = (overrides: Partial<typeof cards.$inferInsert> = {}): typeof cards.$inferInsert => ({
	kind: 'cloze',
	due: new Date(1_800_000_000_000),
	stability: 0,
	difficulty: 0,
	elapsedDays: 0,
	scheduledDays: 0,
	learningSteps: 0,
	reps: 0,
	lapses: 0,
	state: 'New',
	...overrides
});

describe('migrations', () => {
	it('creates every table and seeds the taxonomy, settings and profile', () => {
		const db = createTestDb();
		expect(tableNames(db)).toEqual([
			'__drizzle_migrations',
			'auth_sessions',
			'cards',
			'cloze_items',
			'collocations',
			'generated_cache',
			'grammar_topics',
			'job_locks',
			'lexemes',
			'llm_calls',
			'llm_providers',
			'placement_results',
			'review_logs',
			'sentences',
			'sessions',
			'settings',
			'user_profile',
			'writing_submissions'
		]);
		expect(db.select().from(grammarTopics).all().map((t) => t.code)).toEqual([
			'ART', 'TNS', 'PLU', 'SVA', 'COP', 'PRE', 'COL', 'WFM', 'WOR', 'OTH'
		]);
		expect(db.select().from(settings).all()).toEqual([
			{
				id: 1,
				desiredRetention: 0.9,
				weeklyGoalDays: 5,
				defaultSessionBudget: 8,
				feedbackMode: 'direct',
				newCardsPerDay: 10,
				activeProviderId: null
			}
		]);
		expect(db.select().from(userProfile).all()).toMatchObject([{ id: 1, theta: null, knownBandCeiling: 1 }]);
	});

	it('is a no-op on an already migrated database', () => {
		const db = createTestDb();
		const snapshot = () => ({
			schema: db.$client.prepare('select type, name, sql from sqlite_master order by name').all(),
			migrations: db.$client.prepare('select * from __drizzle_migrations').all(),
			topics: db.select().from(grammarTopics).all().length,
			settings: db.select().from(settings).all().length
		});
		const before = snapshot();
		migrate(db);
		migrate(db);
		expect(snapshot()).toEqual(before);
	});

	it('upgrades an existing database without losing settings (0000 -> 0001)', () => {
		const dir = mkdtempSync(join(tmpdir(), 'silentenglish-mig-'));
		try {
			const full = migrationsFolder();
			const partial = join(dir, 'migrations');
			mkdirSync(join(partial, 'meta'), { recursive: true });
			copyFileSync(join(full, '0000_init.sql'), join(partial, '0000_init.sql'));
			const journal = JSON.parse(readFileSync(join(full, 'meta', '_journal.json'), 'utf8'));
			journal.entries = journal.entries.slice(0, 1);
			writeFileSync(join(partial, 'meta', '_journal.json'), JSON.stringify(journal));

			const db = createDb(':memory:');
			migrate(db, partial);
			// Raw SQL: at schema 0000 the table lacks columns that later migrations add.
			const providerId = Number(
				db.$client
					.prepare("insert into llm_providers (name, base_url, model, wire_format, env_key_name) values ('p', 'https://x', 'm', 'openai', 'OPENAI_API_KEY')")
					.run().lastInsertRowid
			);
			db.$client.prepare('update settings set desired_retention = 0.85, active_provider_id = ?').run(providerId);
			migrate(db, full);
			expect(db.select().from(settings).get()).toMatchObject({
				desiredRetention: 0.85,
				activeProviderId: providerId,
				newCardsPerDay: 10
			});
			expect(db.$client.pragma('foreign_key_check')).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('rebuilds llm_providers (0001 -> 0002) without losing the active provider', () => {
		const dir = mkdtempSync(join(tmpdir(), 'silentenglish-mig2-'));
		try {
			const full = migrationsFolder();
			const partial = join(dir, 'migrations');
			mkdirSync(join(partial, 'meta'), { recursive: true });
			const journal = JSON.parse(readFileSync(join(full, 'meta', '_journal.json'), 'utf8'));
			journal.entries = journal.entries.slice(0, 2);
			for (const entry of journal.entries) copyFileSync(join(full, `${entry.tag}.sql`), join(partial, `${entry.tag}.sql`));
			writeFileSync(join(partial, 'meta', '_journal.json'), JSON.stringify(journal));

			const db = createDb(':memory:');
			migrate(db, partial);
			const insert = db.$client.prepare(
				'insert into llm_providers (name, base_url, model, wire_format, env_key_name, is_fallback) values (?, ?, ?, ?, ?, ?)'
			);
			insert.run('A', 'https://api.anthropic.com', 'c', 'anthropic', 'ANTHROPIC_API_KEY', 1);
			const active = insert.run('O', 'https://api.openai.com/v1', 'g', 'openai', 'OPENAI_API_KEY', 0).lastInsertRowid;
			db.$client.prepare('update settings set active_provider_id = ?').run(active);
			migrate(db, full);
			expect(db.select().from(settings).get()?.activeProviderId).toBe(Number(active));
			expect(db.select().from(llmProviders).all().map((p) => [p.name, p.structuredMode, p.isFallback])).toEqual([
				['A', 'json_schema', true],
				['O', 'json_schema', false]
			]);
			expect(db.$client.pragma('foreign_key_check')).toEqual([]);
			expect(tableNames(db).filter((t) => t.startsWith('__') && t !== '__drizzle_migrations')).toEqual([]);
			// env_key_name is now optional (a local Ollama), and still rejects key-shaped values.
			insert.run('Ollama', 'http://localhost:11434/v1', 'llama', 'openai', null, 0);
			expect(() => insert.run('Bad', 'https://x', 'm', 'openai', 'sk-abc', 0)).toThrow(/CHECK/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('opens file databases with WAL and the other pragmas', () => {
		const dir = mkdtempSync(join(tmpdir(), 'silentenglish-db-'));
		try {
			const db = createDb(join(dir, 'nested', 'app.db'));
			const pragma = (name: string) => db.$client.pragma(name, { simple: true });
			expect(pragma('journal_mode')).toBe('wal');
			expect(pragma('foreign_keys')).toBe(1);
			expect(pragma('busy_timeout')).toBe(5000);
			expect(pragma('synchronous')).toBe(1); // NORMAL
			db.$client.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('schema guards', () => {
	it('has no column that could hold a secret', () => {
		const db = createTestDb();
		// Allowed: env_key_name (a variable *name*), the llm_calls token *counts* and the cloze
		// gap position (INTEGER only, checked below).
		const allowed = new Set([
			'llm_providers.env_key_name',
			'llm_calls.input_tokens',
			'llm_calls.output_tokens',
			'cloze_items.token_index'
		]);
		const offending = tableNames(db).flatMap((table) =>
			columnNames(db, table)
				.filter((c) => /key|secret|token|password/i.test(c) && !allowed.has(`${table}.${c}`))
				.map((c) => `${table}.${c}`)
		);
		expect(offending).toEqual([]);
		expect(columnNames(db, 'llm_providers')).toContain('env_key_name');
		const types = Object.fromEntries(
			(db.$client.pragma('table_info(llm_calls)') as { name: string; type: string }[]).map((c) => [c.name, c.type.toLowerCase()])
		);
		expect([types.input_tokens, types.output_tokens]).toEqual(['integer', 'integer']);
		const clozeTypes = (db.$client.pragma('table_info(cloze_items)') as { name: string; type: string }[]).find(
			(c) => c.name === 'token_index'
		);
		expect(clozeTypes?.type.toLowerCase()).toBe('integer');
	});

	it('allows exactly one settings row and one profile row', () => {
		const db = createTestDb();
		expect(() => db.insert(settings).values({ id: 2 }).run()).toThrow(/CHECK constraint failed/);
		expect(() => db.insert(settings).values({ id: 1 }).run()).toThrow(/UNIQUE constraint failed/);
		expect(() => db.insert(userProfile).values({ id: 2 }).run()).toThrow(/CHECK constraint failed/);
	});

	it('rejects values outside an enumeration or range', () => {
		const db = createTestDb();
		const raw = (statement: string) => () => db.$client.prepare(statement).run();
		expect(raw("update settings set feedback_mode = 'loud'")).toThrow(/CHECK constraint failed: settings_feedback_mode/);
		expect(() => db.update(settings).set({ desiredRetention: 0.5 }).run()).toThrow(/CHECK/);
		expect(
			raw(`insert into cards (kind, due, stability, difficulty, elapsed_days, scheduled_days,
				learning_steps, reps, lapses, state) values ('cloze', 0, 0, 0, 0, 0, 0, 0, 0, 'Done')`)
		).toThrow(/CHECK constraint failed: cards_state/);
	});

	it('rejects an API key pasted into env_key_name', () => {
		const db = createTestDb();
		const provider = { name: 'x', baseUrl: 'https://api.example.com', model: 'm', wireFormat: 'openai' as const };
		expect(() =>
			db.insert(llmProviders).values({ ...provider, envKeyName: 'sk-proj-abc123' }).run()
		).toThrow(/CHECK constraint failed: llm_providers_env_key_name/);
		expect(db.insert(llmProviders).values({ ...provider, envKeyName: 'OPENAI_API_KEY' }).run().changes).toBe(1);
	});

	it('rejects a duplicate card for the same kind and item, including NULL references', () => {
		const db = createTestDb();
		const [lexeme] = db
			.insert(lexemes)
			.values({ headword: 'go', forms: ['go', 'went'], source: 'ngsl', licenseTag: 'CC-BY-SA-4.0' })
			.returning()
			.all();
		db.insert(cards).values(newCard({ lexemeId: lexeme.id })).run();
		expect(() => db.insert(cards).values(newCard({ lexemeId: lexeme.id })).run()).toThrow(
			/UNIQUE constraint failed/
		);
		// Same item, different kind: allowed.
		expect(db.insert(cards).values(newCard({ kind: 'translate', lexemeId: lexeme.id })).run().changes).toBe(1);
	});
});

describe('create, read and update every content table', () => {
	it('lexemes and collocations', () => {
		const db = createTestDb();
		const lexeme = db
			.insert(lexemes)
			.values({ headword: 'make', ngslRank: 48, freqBand: 1, forms: ['made', 'make', 'makes'], source: 'ngsl', licenseTag: 'CC-BY-SA-4.0' })
			.returning()
			.get();
		expect(lexeme).toMatchObject({ forms: ['made', 'make', 'makes'], supplementary: false, pos: null });
		db.update(lexemes).set({ viGloss: 'làm' }).where(eq(lexemes.id, lexeme.id)).run();
		expect(db.select().from(lexemes).get()?.viGloss).toBe('làm');
		expect(() =>
			db.insert(lexemes).values({ headword: 'make', forms: [], source: 'llm', licenseTag: 'x' }).run()
		).toThrow(/UNIQUE/);

		const colloc = db.insert(collocations).values({ lexemeId: lexeme.id, chunk: 'make a mistake' }).returning().get();
		db.update(collocations).set({ exampleEn: 'Everyone makes mistakes.' }).where(eq(collocations.id, colloc.id)).run();
		expect(db.select().from(collocations).get()).toMatchObject({ chunk: 'make a mistake', exampleEn: 'Everyone makes mistakes.' });
		// Collocations go with their lexeme.
		db.delete(lexemes).where(eq(lexemes.id, lexeme.id)).run();
		expect(db.select().from(collocations).all()).toEqual([]);
	});

	it('sentences', () => {
		const db = createTestDb();
		const row = db
			.insert(sentences)
			.values({ enText: 'I have to go to sleep.', viText: 'Tôi phải đi ngủ.', source: 'tatoeba', tatoebaIdEn: 1277, tatoebaIdVi: 5662, ngslBandMax: 1, offListCount: 0, licenseTag: 'CC-BY-2.0-FR' })
			.returning()
			.get();
		db.update(sentences).set({ levelBand: 1 }).where(eq(sentences.id, row.id)).run();
		expect(db.select().from(sentences).get()).toMatchObject({ tatoebaIdEn: 1277, levelBand: 1 });
		expect(() =>
			db.insert(sentences).values({ enText: 'x', viText: 'y', source: 'tatoeba', tatoebaIdEn: 1277, licenseTag: 'x' }).run()
		).toThrow(/UNIQUE/);
		// LLM sentences have no Tatoeba id; several may coexist.
		for (const enText of ['a', 'b']) {
			db.insert(sentences).values({ enText, viText: 'v', source: 'llm', licenseTag: 'generated' }).run();
		}
		expect(db.select().from(sentences).all()).toHaveLength(3);
	});

	it('placement_results', () => {
		const db = createTestDb();
		const row = db
			.insert(placementResults)
			.values({ takenAt: new Date(1_800_000_000_000), theta: 1200, cefr: 'A2', subscoresJson: { vocab: 1, grammar: 2, reading: 3, writing: null }, itemLogJson: [{ item: 'plurthy', correct: true }] })
			.returning()
			.get();
		db.update(placementResults).set({ writingStatus: 'queued' }).where(eq(placementResults.id, row.id)).run();
		expect(db.select().from(placementResults).get()).toEqual({ ...row, writingStatus: 'queued' });
	});

	it('cards and review logs store every ts-fsrs field losslessly', () => {
		const db = createTestDb();
		const fsrsCard = { ...createEmptyCard(new Date(1_800_000_000_123)), stability: 3.1234567, difficulty: 5.4321, reps: 3, lapses: 1, learning_steps: 1, scheduled_days: 4, elapsed_days: 2, last_review: new Date(1_799_999_999_456) };
		const card = db
			.insert(cards)
			.values({
				kind: 'cloze',
				due: fsrsCard.due,
				stability: fsrsCard.stability,
				difficulty: fsrsCard.difficulty,
				elapsedDays: fsrsCard.elapsed_days,
				scheduledDays: fsrsCard.scheduled_days,
				learningSteps: fsrsCard.learning_steps,
				reps: fsrsCard.reps,
				lapses: fsrsCard.lapses,
				state: 'Review',
				lastReview: fsrsCard.last_review
			})
			.returning()
			.get();
		const back = db.select().from(cards).where(eq(cards.id, card.id)).get();
		expect(back).toMatchObject({
			due: fsrsCard.due,
			stability: fsrsCard.stability,
			difficulty: fsrsCard.difficulty,
			elapsedDays: 2,
			scheduledDays: 4,
			learningSteps: 1,
			reps: 3,
			lapses: 1,
			lastReview: fsrsCard.last_review
		});
		db.update(cards).set({ promptMode: 'typing' }).where(eq(cards.id, card.id)).run();
		expect(db.select().from(cards).get()?.promptMode).toBe('typing');

		const log = db
			.insert(reviewLogs)
			.values({ cardId: card.id, rating: 'Good', state: 'Review', due: fsrsCard.due, stability: 3.1, difficulty: 5.4, elapsedDays: 2, lastElapsedDays: 1, scheduledDays: 4, learningSteps: 0, review: new Date(1_800_000_000_999), oldS: 3.1, newS: 8.2, oldD: 5.4, newD: 5.3 })
			.returning()
			.get();
		expect(db.select().from(reviewLogs).get()).toEqual(log);
	});

	it('a card with reviews cannot be deleted, so its history is kept', () => {
		const db = createTestDb();
		const card = db.insert(cards).values(newCard()).returning().get();
		db.insert(reviewLogs)
			.values({ cardId: card.id, rating: 'Again', state: 'New', due: new Date(0), stability: 0, difficulty: 0, elapsedDays: 0, lastElapsedDays: 0, scheduledDays: 0, learningSteps: 0, review: new Date(0), oldS: 0, newS: 1, oldD: 0, newD: 5 })
			.run();
		expect(() => db.delete(cards).where(eq(cards.id, card.id)).run()).toThrow(/FOREIGN KEY constraint failed/);
		expect(db.select().from(reviewLogs).all()).toHaveLength(1);
		// A card without reviews can be deleted.
		const unused = db.insert(cards).values(newCard({ kind: 'grammar' })).returning().get();
		expect(db.delete(cards).where(eq(cards.id, unused.id)).run().changes).toBe(1);
	});

	it('grammar_topics and sessions can be updated', () => {
		const db = createTestDb();
		db.update(grammarTopics).set({ nameVi: 'Mạo từ (a/an/the)' }).where(eq(grammarTopics.code, 'ART')).run();
		expect(db.select().from(grammarTopics).where(eq(grammarTopics.code, 'ART')).get()?.nameVi).toBe('Mạo từ (a/an/the)');
		const session = db
			.insert(sessions)
			.values({ clientSessionId: 'c-9', startedAt: new Date(0), budgetMin: 5, shape: 'quick' })
			.returning()
			.get();
		db.update(sessions).set({ endedAt: new Date(300_000), itemsDone: 15 }).where(eq(sessions.id, session.id)).run();
		expect(db.select().from(sessions).get()).toMatchObject({ endedAt: new Date(300_000), itemsDone: 15 });
	});

	it('a grammar topic used by a card cannot be deleted', () => {
		const db = createTestDb();
		const topic = db.select().from(grammarTopics).where(eq(grammarTopics.code, 'ART')).get()!;
		db.insert(cards).values(newCard({ kind: 'error', grammarTopicId: topic.id })).run();
		expect(() => db.delete(grammarTopics).where(eq(grammarTopics.id, topic.id)).run()).toThrow(/FOREIGN KEY/);
	});
});
