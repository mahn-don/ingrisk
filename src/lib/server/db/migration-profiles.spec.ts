// Migration 0010 (Phase 12, learner profiles) on a copy of a pre-phase-12 database with data in
// every per-learner table: no row is lost, every row belongs to "Hồ sơ 1", the learning settings
// move to profile_settings, shared content stays shared, and foreign_key_check is clean.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, migrate, migrationsFolder } from './client.ts';

const full = migrationsFolder();
const journal = JSON.parse(readFileSync(join(full, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
const root = mkdtempSync(join(tmpdir(), 'se-mig-profiles-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const BEFORE = journal.entries.findIndex((e) => e.tag === '0010_profiles');

/** A migrations folder stopping just before 0010. */
function beforeProfiles(): string {
	const dir = join(root, 'pre-0010');
	mkdirSync(join(dir, 'meta'), { recursive: true });
	writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: journal.entries.slice(0, BEFORE) }));
	for (const entry of journal.entries.slice(0, BEFORE)) copyFileSync(join(full, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
	return dir;
}

const LEARNER_TABLES = ['user_profile', 'placement_results', 'placement_attempts', 'cards', 'review_logs', 'sessions', 'writing_submissions', 'drill_results'];
const ALL_TABLES = [...LEARNER_TABLES, 'sentences', 'cloze_items', 'llm_calls', 'auth_sessions', 'generated_cache', 'llm_providers'];

/** One learner's history at schema 0009, written with raw SQL (the app's code is already at 0010). */
function seed(path: string): void {
	const db = createDb(path);
	migrate(db, beforeProfiles());
	const run = (sql: string, ...params: unknown[]) => Number(db.$client.prepare(sql).run(...params).lastInsertRowid);
	const provider = run("insert into llm_providers (name, base_url, model, wire_format, env_key_name) values ('p', 'https://x', 'm', 'openai', 'OPENAI_API_KEY')");
	run('update settings set desired_retention = 0.85, weekly_goal_days = 4, default_session_budget = 10, feedback_mode = ?, new_cards_per_day = 15, active_provider_id = ?', 'indirect', provider);
	run("update user_profile set cefr_estimate = 'B1', known_band_ceiling = 3");
	const tatoeba = run("insert into sentences (en_text, vi_text, source, license_tag, level_band) values ('I like tea.', 'Tôi thích trà.', 'tatoeba', 'CC-BY 2.0 FR', 1)");
	const mined = run("insert into sentences (en_text, vi_text, source, license_tag, level_band) values ('She goes home.', '', 'user_error', 'user', 1)");
	const item = (sentence: number, gap: string, hash: string) =>
		run("insert into cloze_items (sentence_id, gap_type, token_index, answer, options, level_band, rule_ok, validated, prompt_version, content_hash, created_at) values (?, ?, 1, 'x', '[]', 1, 1, 1, 'v', ?, 0)", sentence, gap, hash);
	const shared = item(tatoeba, 'lexical', 'h-shared');
	const minedItem = item(mined, 'user_error', 'h-mined');
	const card = (clozeItem: number, sentence: number) =>
		run(
			"insert into cards (kind, sentence_id, cloze_item_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state) values ('cloze', ?, ?, 0, 1, 5, 0, 1, 0, 1, 0, 'Review')",
			sentence,
			clozeItem
		);
	const c1 = card(shared, tatoeba);
	card(minedItem, mined);
	run("insert into review_logs (card_id, rating, state, due, stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days, learning_steps, review, old_s, new_s, old_d, new_d) values (?, 'Good', 'New', 0, 1, 5, 0, 0, 1, 0, 0, 0, 1, 0, 5)", c1);
	const session = run("insert into sessions (client_session_id, started_at, budget_min, shape, status, finished_at, items_done) values ('c-1', 0, 8, 'quick', 'finished', 1000, 5)");
	run("insert into sessions (client_session_id, started_at, budget_min, shape) values ('pending:x', 2000, 8, 'quick')");
	const submission = run("insert into writing_submissions (session_id, prompt, user_text, submitted_at) values (?, 'Viết', 'I goes.', 0)", session);
	const cache = run("insert into generated_cache (kind, params_hash, content_hash, level_band, payload_json, model) values ('error', 'p', 'c', 1, '{}', 'm')");
	run("insert into drill_results (session_id, cache_id, topic_code, correct, answered_at) values (?, ?, 'SVA', 1, 0)", session, cache);
	const result = run("insert into placement_results (taken_at, theta, cefr, subscores_json, item_log_json, writing_submission_id) values (0, 3, 'B1', '{}', '[]', ?)", submission);
	run("insert into placement_attempts (started_at, state_json, status, result_id) values (0, '{}', 'completed', ?)", result);
	run("insert into placement_attempts (started_at, state_json) values (1, '{}')");
	run("insert into llm_calls (created_at, provider_id, model, purpose, mode, attempt, ok, latency_ms) values (0, ?, 'm', 'cloze', 'json_schema', 1, 1, 10)", provider);
	run("insert into auth_sessions (id, created_at, expires_at, last_seen_at) values ('h', 0, 9999999999999, 0)");
	db.$client.close();
}

const counts = (db: ReturnType<typeof createDb>) => Object.fromEntries(ALL_TABLES.map((t) => [t, db.$client.prepare(`select count(*) from ${t}`).pluck().get()]));

describe('migration 0010 (profiles) on a pre-phase-12 database', () => {
	const original = join(root, 'app.db');
	const copy = join(root, 'app-copy.db');
	seed(original);
	copyFileSync(original, copy);
	const before = createDb(original);
	const db = createDb(copy);
	migrate(db);

	it('keeps every row', () => {
		expect(counts(db)).toEqual(counts(before));
		expect(counts(db).cards).toBe(2);
	});

	it('assigns every per-learner row to profile 1, "Hồ sơ 1"', () => {
		expect(db.$client.prepare('select id, name, emoji, archived_at from profiles').all()).toEqual([{ id: 1, name: 'Hồ sơ 1', emoji: null, archived_at: null }]);
		for (const table of LEARNER_TABLES) {
			expect(db.$client.prepare(`select distinct profile_id from ${table}`).pluck().all(), table).toEqual([1]);
		}
		expect(db.$client.prepare('select cefr_estimate, known_band_ceiling from user_profile').get()).toEqual({ cefr_estimate: 'B1', known_band_ceiling: 3 });
	});

	it('moves the learning settings to profile 1 and keeps the provider global', () => {
		expect(db.$client.prepare('select * from profile_settings').all()).toEqual([
			{ profile_id: 1, desired_retention: 0.85, weekly_goal_days: 4, default_session_budget: 10, feedback_mode: 'indirect', new_cards_per_day: 15 }
		]);
		expect(db.$client.prepare('select * from settings').all()).toEqual([{ id: 1, active_provider_id: 1 }]);
	});

	it('gives mined sentences and items to profile 1, leaves shared content and the call log unowned', () => {
		expect(db.$client.prepare('select source, profile_id from sentences order by id').all()).toEqual([
			{ source: 'tatoeba', profile_id: null },
			{ source: 'user_error', profile_id: 1 }
		]);
		expect(db.$client.prepare('select gap_type, profile_id from cloze_items order by id').all()).toEqual([
			{ gap_type: 'lexical', profile_id: null },
			{ gap_type: 'user_error', profile_id: 1 }
		]);
		expect(db.$client.prepare('select distinct profile_id from llm_calls').pluck().all()).toEqual([null]);
		// A login session from before picks its profile on /profiles.
		expect(db.$client.prepare('select profile_id from auth_sessions').pluck().all()).toEqual([null]);
	});

	it('passes foreign_key_check and integrity_check', () => {
		expect(db.$client.pragma('foreign_key_check')).toEqual([]);
		expect(db.$client.pragma('integrity_check', { simple: true })).toBe('ok');
	});

	it('leaves the original untouched (the copy was migrated)', () => {
		expect(before.$client.prepare("select count(*) from sqlite_master where name = 'profiles'").pluck().get()).toBe(0);
	});
});
