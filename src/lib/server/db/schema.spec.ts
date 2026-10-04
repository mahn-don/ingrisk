import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmptyCard } from 'ts-fsrs';
import { afterEach, describe, expect, it } from 'vitest';
import { createDb, migrate, type Db } from './client.ts';
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
			'cards',
			'collocations',
			'generated_cache',
			'grammar_topics',
			'lexemes',
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
		const offending = tableNames(db).flatMap((table) =>
			columnNames(db, table)
				.filter((c) => /key|secret|token|password/i.test(c) && c !== 'env_key_name')
				.map((c) => `${table}.${c}`)
		);
		expect(offending).toEqual([]);
		expect(columnNames(db, 'llm_providers')).toContain('env_key_name');
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
