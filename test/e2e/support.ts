// Shared e2e settings: the test password (its hash is computed when the config loads, never
// committed), the per-server databases, and the cron secret of the test server.
// playwright.config.ts repeats these values: keep them in sync.
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import type { Page } from '@playwright/test';

export const E2E_PASSWORD = 'e2e-only-password-not-real';
export const E2E_CRON_SECRET = 'e2e-only-cron-value';
export const E2E_DIR = 'tmp/e2e';
export const SERVERS = {
	main: { port: 4173, db: `${E2E_DIR}/main.db` },
	unconfigured: { port: 4174, db: `${E2E_DIR}/unconfigured.db` },
	rateLimit: { port: 4175, db: `${E2E_DIR}/rate-limit.db` },
	placement: { port: 4176, db: `${E2E_DIR}/placement.db` },
	session: { port: 4177, db: `${E2E_DIR}/session.db` },
	progress: { port: 4178, db: `${E2E_DIR}/progress.db` }
} as const;
export const E2E_FAKE_PROVIDER_KEY = 'e2e-fake-provider-value-not-a-key';

export async function login(page: Page, next = '/'): Promise<void> {
	await page.goto(`/login?next=${encodeURIComponent(next)}`);
	await page.getByLabel('Mật khẩu').fill(E2E_PASSWORD);
	await page.getByRole('button', { name: 'Đăng nhập' }).click();
	await page.waitForURL((url) => url.pathname !== '/login');
}

/** Move one session's expiry into the past, directly in the server's database. */
export function expireSession(dbPath: string, cookieValue: string): number {
	const db = new Database(dbPath);
	try {
		const id = createHash('sha256').update(cookieValue).digest('hex');
		return db.prepare('update auth_sessions set expires_at = ? where id = ?').run(Date.now() - 1000, id).changes;
	} finally {
		db.close();
	}
}

const DAY_MS = 86_400_000;

/** Run `fn` on the server's database file (WAL: the running server sees the change). */
function withDb<T>(dbPath: string, fn: (db: Database.Database) => T): T {
	const db = new Database(dbPath);
	try {
		return fn(db);
	} finally {
		db.close();
	}
}

/**
 * Make `count` already-introduced cloze cards due now (Review state, a day overdue), from validated
 * items without a card and without stock names. The first `typing` of them are strong lexical cards
 * (stability 30, answers of 6+ letters), which sessions serve in typing mode.
 */
export function addDueCards(dbPath: string, count: number, options: { typing?: number } = {}): number[] {
	return withDb(dbPath, (db) => {
		const typing = options.typing ?? 0;
		const pick = (where: string, limit: number) =>
			db
				.prepare(
					`select ci.id, ci.lexeme_id, ci.sentence_id, ci.grammar_topic_id from cloze_items ci
					 join sentences s on s.id = ci.sentence_id left join cards c on c.cloze_item_id = ci.id
					 where ci.validated = 1 and c.id is null and s.has_stock_names = 0 and ${where}
					 order by ci.level_band, ci.id limit ?`
				)
				.all(limit) as { id: number; lexeme_id: number | null; sentence_id: number; grammar_topic_id: number | null }[];
		const strong = pick(`ci.gap_type = 'lexical' and length(ci.answer) >= 6 and ci.answer = lower(ci.answer)`, typing);
		const weak = pick(`ci.gap_type in ('lexical', 'preposition', 'verb_form')`, count + typing).filter((w) => !strong.some((s) => s.id === w.id));
		const insert = db.prepare(
			`insert or ignore into cards (kind, lexeme_id, sentence_id, grammar_topic_id, cloze_item_id, prompt_mode, due, stability,
			 difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
			 values ('cloze', ?, ?, ?, ?, 'choice', ?, ?, 5, 3, 3, 0, 3, 0, 'Review', ?)`
		);
		const now = Date.now();
		const ids: number[] = [];
		[...strong.map((r) => ({ r, stability: 30 })), ...weak.map((r) => ({ r, stability: 3 }))].slice(0, count).forEach(({ r, stability }, i) => {
			// Typing cards are the least overdue: they open the session (highest retrievability).
			const due = now - DAY_MS - (stability === 30 ? 0 : (i + 1) * 60_000);
			const result = insert.run(r.lexeme_id, r.sentence_id, r.grammar_topic_id, r.id, due, stability, due - 3 * DAY_MS);
			if (result.changes > 0) ids.push(Number(result.lastInsertRowid));
		});
		return ids;
	});
}

export function setNewCardsPerDay(dbPath: string, n: number): void {
	withDb(dbPath, (db) => db.prepare('update settings set new_cards_per_day = ? where id = 1').run(n));
}

/** Cards introduced (first reviewed) in the current learning day (from 04:00 Asia/Ho_Chi_Minh). */
export function introducedToday(dbPath: string): number {
	const shift = 3 * 3_600_000; // UTC+7, day starting at 04:00
	const dayStart = Math.floor((Date.now() + shift) / DAY_MS) * DAY_MS - shift;
	return withDb(dbPath, (db) => (db.prepare("select count(distinct card_id) as n from review_logs where state = 'New' and review >= ?").get(dayStart) as { n: number }).n);
}

/** The start (ms) of the learning day `offset` days from today (04:00 Asia/Ho_Chi_Minh). */
export function learningDayStartMs(offset = 0): number {
	const shift = 3 * 3_600_000;
	return (Math.floor((Date.now() + shift) / DAY_MS) + offset) * DAY_MS - shift;
}

/**
 * A study history for the stats page: one finished session (8 items, 6 minutes) on each of the
 * `days` learning days before today, and `lapsed` preposition cards (introduced, one Again each in
 * the last days) so "Giới từ" shows in the weakness list. Returns the lapsed card ids.
 */
export function seedHistory(dbPath: string, options: { days: number; lapsed: number }): number[] {
	return withDb(dbPath, (db) => {
		const insertSession = db.prepare(
			`insert into sessions (client_session_id, started_at, ended_at, budget_min, shape, items_done, status, served_json, finished_at, summary_json)
			 values (?, ?, ?, 5, 'quick', 8, 'finished', '{"cards":[],"drills":[],"anchor":null}', ?, ?)`
		);
		for (let k = 1; k <= options.days; k++) {
			const at = learningDayStartMs(-k) + 6 * 3_600_000;
			const summary = { answered: 8, correct: 6, accuracy: 0.75, strengthened: 3, newIntroduced: 2, nextDueAt: null, studyMs: 6 * 60_000, todayMinutes: 6, shape: 'quick', anchor: null, drillsCorrect: 0, drillsTotal: 0, minedErrors: 0 };
			insertSession.run(`e2e-history-${k}-${at}`, at - 400_000, at, at, JSON.stringify(summary));
		}
		const items = db
			.prepare(
				`select ci.id, ci.lexeme_id, ci.sentence_id, ci.grammar_topic_id from cloze_items ci left join cards c on c.cloze_item_id = ci.id
				 where ci.validated = 1 and c.id is null and ci.gap_type = 'preposition' order by ci.level_band, ci.id limit ?`
			)
			.all(options.lapsed) as { id: number; lexeme_id: number | null; sentence_id: number; grammar_topic_id: number }[];
		const insertCard = db.prepare(
			`insert into cards (kind, lexeme_id, sentence_id, grammar_topic_id, cloze_item_id, prompt_mode, due, stability, difficulty,
			 elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
			 values ('cloze', ?, ?, ?, ?, 'choice', ?, 2, 6, 1, 1, 0, 3, 1, 'Review', ?)`
		);
		const insertLog = db.prepare(
			`insert into review_logs (card_id, rating, state, due, stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days,
			 learning_steps, review, old_s, new_s, old_d, new_d) values (?, 'Again', 'Review', ?, 3, 5, 3, 3, 3, 0, ?, 3, 2, 5, 6)`
		);
		const ids: number[] = [];
		items.forEach((item, i) => {
			const reviewed = learningDayStartMs(-1) + (i + 1) * 60_000;
			const due = Date.now() + (i + 2) * DAY_MS;
			const id = Number(insertCard.run(item.lexeme_id, item.sentence_id, item.grammar_topic_id, item.id, due, reviewed).lastInsertRowid);
			insertLog.run(id, reviewed - 3 * DAY_MS, reviewed);
			ids.push(id);
		});
		return ids;
	});
}

/** The cards a session served (its served_json). */
export function servedCards(dbPath: string, sessionId?: number): { cardId: number; isNew: boolean }[] {
	return withDb(dbPath, (db) => {
		const row = (sessionId === undefined
			? db.prepare('select served_json from sessions order by id desc limit 1').get()
			: db.prepare('select served_json from sessions where id = ?').get(sessionId)) as { served_json: string } | undefined;
		return row === undefined ? [] : (JSON.parse(row.served_json) as { cards: { cardId: number; isNew: boolean }[] }).cards;
	});
}

/** The grammar topic code of each card. */
export function topicsOf(dbPath: string, cardIds: readonly number[]): (string | null)[] {
	return withDb(dbPath, (db) =>
		cardIds.map((id) => (db.prepare('select g.code from cards c left join grammar_topics g on g.id = c.grammar_topic_id where c.id = ?').get(id) as { code: string | null }).code)
	);
}

/** One card's answer (its cloze item's). */
export function answerOf(dbPath: string, cardId: number): string {
	return withDb(dbPath, (db) => (db.prepare('select ci.answer from cards c join cloze_items ci on ci.id = c.cloze_item_id where c.id = ?').get(cardId) as { answer: string }).answer);
}
