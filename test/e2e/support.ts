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
	session: { port: 4177, db: `${E2E_DIR}/session.db` }
} as const;

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
