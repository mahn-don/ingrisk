// Capture the main screens at 390×844 in light and dark: starts a dev server (so /dev/components
// exists) with a throwaway password and a seeded database under tmp/screens/ (canned LLM), logs
// in, walks through the placement test, saves PNGs there.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { type Algorithm, hash } from '@node-rs/argon2';
import { type Page, chromium } from '@playwright/test';
import { parseCli, positiveInt } from './lib/cli.ts';
import { createDb } from '../src/lib/server/db/client.ts';
import { appLlmDeps } from '../src/lib/server/generation/app-llm.ts';
import { gradeQueuedWritings } from '../src/lib/server/grading/queued.ts';
import type { Anchor, SessionItem, StartResponse } from '../src/lib/session/types.ts';
import { addDueCards, seedTestDatabase } from './lib/test-content.ts';
import { seedHistory } from '../test/e2e/support.ts';

const args = parseCli({
	command: 'npm run screenshots --',
	summary: 'Screenshot Login, Home, Stats, the review book, Settings (each section, providers, credits), /dev/components, the placement test and Nhanh/Đọc/Viết sessions (390×844, light and dark) into tmp/screens/.',
	usage: ['--port N           Port for the temporary dev server (default 5199); CHROMIUM_PATH picks a Chromium binary'],
	example: '--port 5199',
	options: { port: { type: 'string', default: '5199' } }
});

const OUT = 'tmp/screens';
const PASSWORD = 'screenshots-only-password';
const port = positiveInt('port', args.port);
const origin = `http://localhost:${port}`;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
await seedTestDatabase(`${OUT}/app.db`, { clozePerBand: 30, anchors: true });
// A few weeks of history for the stats page, and preposition cards with lapses for the review book.
seedHistory(`${OUT}/app.db`, { days: 9, lapsed: 5 });

const server = spawn('npx', ['vite', 'dev', '--port', String(port), '--strictPort'], {
	detached: true,
	stdio: 'ignore',
	env: {
		...process.env,
		APP_PASSWORD_HASH: await hash(PASSWORD, { algorithm: 2 as Algorithm.Argon2id }),
		ORIGIN: origin,
		COOKIE_SECURE: 'false',
		DATABASE_PATH: `${OUT}/app.db`,
		LLM_CANNED: '1'
	}
});
const stop = () => {
	try {
		process.kill(-server.pid!, 'SIGTERM');
	} catch {
		// already gone
	}
};
process.on('exit', stop);

async function waitForServer(): Promise<void> {
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${origin}/login`)).ok) return;
		} catch {
			// not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`the dev server did not start on ${origin}`);
}

// Part A answers: pseudo-words "Không biết"; real words "Biết" up to NGSL band 4.
const bandOf = new Map(
	(JSON.parse(readFileSync('src/lib/server/content/ngsl.json', 'utf8')) as { items: { headword: string; band: number }[] }).items.map((i) => [i.headword, i.band])
);

/** Answer the item on screen and wait for the next one (or the end of the part). */
async function answer(page: Page, testid: string, click: () => Promise<void>) {
	const ref = await page.getByTestId(testid).getAttribute('data-ref');
	await click();
	await page.waitForFunction(([id, old]) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-ref') !== old, [testid, ref] as const);
}

async function placement(page: Page, shot: (name: string, fullPage?: boolean) => Promise<void>, restart: boolean) {
	await page.goto(`${origin}/placement${restart ? '?restart' : ''}`);
	await page.waitForLoadState('networkidle'); // hydrated: the buttons work
	await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
	await page.getByTestId('placement-intro').waitFor();
	await shot('placement-intro');
	await page.getByRole('button', { name: 'Bắt đầu phần này' }).click();
	for (let i = 0; i < 2; i++) {
		const word = (await page.getByTestId('part-a-word').textContent())!.trim();
		await answer(page, 'part-a', () => page.getByRole('button', { name: (bandOf.get(word) ?? 9) <= 4 ? 'Biết' : 'Không biết', exact: true }).click());
	}
	await shot('placement-a');
	while (await page.getByTestId('part-a').isVisible()) {
		const word = (await page.getByTestId('part-a-word').textContent())!.trim();
		await answer(page, 'part-a', () => page.getByRole('button', { name: (bandOf.get(word) ?? 9) <= 4 ? 'Biết' : 'Không biết', exact: true }).click());
	}
	await page.getByRole('button', { name: 'Bắt đầu phần này' }).click();
	let n = 0;
	while (await page.getByTestId('part-b').isVisible()) {
		if (n === 1) await shot('placement-b');
		await answer(page, 'part-b', () => page.getByTestId('part-b').getByRole('button').nth(n++ % 3).click());
	}
	await page.getByRole('button', { name: 'Bắt đầu phần này' }).click();
	await page.getByLabel('Bài viết của bạn (bằng tiếng Anh)').fill('Last weekend I visited my grandmother in the countryside. We cooked lunch together and talked about my school.');
	await shot('placement-c');
	await page.getByRole('button', { name: 'Nộp bài' }).click();
	await page.waitForURL(/\/placement\/result\/\d+$/);
	await shot('placement-result', true);
}

/** A session: a choice item, a typing item, both feedback panels, the exit sheet and the end screen. */
async function session(page: Page, shot: (name: string, fullPage?: boolean) => Promise<void>) {
	addDueCards(`${OUT}/app.db`, 8);
	const started = page.waitForResponse('**/api/session/start');
	await page.goto(`${origin}/session?budget=5`);
	const { items } = (await (await started).json()) as StartResponse & { items: SessionItem[] };
	// The placement writing's feedback comes first: dismiss it (feedbackAtStart photographs one).
	await page.locator('[data-testid="session-item"], [data-testid="session-feedback"]').first().waitFor();
	while (await page.getByTestId('session-feedback').isVisible()) await page.getByRole('button', { name: 'Đã xem' }).click();
	await page.getByTestId('session-item').waitFor();
	const taken = new Set<string>();
	const once = async (name: string) => {
		if (taken.has(name)) return;
		taken.add(name);
		await shot(`session-${name}`);
	};
	for (let k = 0; k < items.length && taken.size < 4; k++) {
		const id = Number(await page.getByTestId('session-item').getAttribute('data-card-id'));
		const item = items.find((i) => i.cardId === id)!;
		const card = page.getByTestId('session-item');
		if (item.mode === 'typing') {
			await card.getByLabel('Câu trả lời của bạn').fill(item.answer.slice(0, 3));
			await once('typing');
			await card.getByLabel('Câu trả lời của bạn').fill(item.answer);
			await card.getByRole('button', { name: 'Kiểm tra' }).click();
		} else {
			await once('choice');
			const right = !taken.has('correct');
			const option = right ? item.answer : item.options!.find((o) => o !== item.answer)!;
			await card.getByRole('button', { name: option === '—' ? '(không cần từ nào)' : option, exact: true }).click();
			await page.getByTestId('feedback').waitFor();
			await page.waitForTimeout(300); // the panel's slide
			await once(right ? 'correct' : 'incorrect');
		}
		await page.getByTestId('feedback').waitFor();
		await page.getByRole('button', { name: 'Tiếp', exact: true }).click();
		await page.waitForFunction((old) => document.querySelector('[data-testid="session-item"]')?.getAttribute('data-card-id') !== String(old), id);
	}
	await page.getByTestId('session-exit').click();
	await page.getByRole('alertdialog').waitFor();
	await page.waitForTimeout(300);
	await shot('session-exit');
	await page.getByRole('button', { name: 'Kết thúc sớm và lưu' }).click();
	await page.getByTestId('session-done').waitFor();
	await shot('session-done');
}

type Shot = (name: string, fullPage?: boolean) => Promise<void>;
type Started = Extract<StartResponse, { sessionId: number }>;
const label = (option: string) => (option === '—' ? '(không cần từ nào)' : option);

/** Open a session; returns what the server composed. */
async function openSession(page: Page, query: string): Promise<StartResponse> {
	const started = page.waitForResponse('**/api/session/start');
	await page.goto(`${origin}/session?${query}`);
	const body = (await (await started).json()) as StartResponse;
	await page.waitForLoadState('networkidle');
	return body;
}

/** Answer the cards on screen correctly, then the drills (the first one photographed). */
async function playCardsAndDrills(page: Page, session: Started, shot: Shot | null) {
	while (await page.getByTestId('session-item').isVisible()) {
		const id = Number(await page.getByTestId('session-item').getAttribute('data-card-id'));
		const item = session.items.find((i) => i.cardId === id)!;
		if (item.mode === 'typing') {
			await page.getByLabel('Câu trả lời của bạn').fill(item.answer);
			await page.getByRole('button', { name: 'Kiểm tra' }).click();
		} else await page.getByTestId('session-item').getByRole('button', { name: label(item.answer), exact: true }).click();
		await page.getByTestId('feedback').getByRole('button').last().click();
		await page.waitForFunction((old) => document.querySelector('[data-testid="session-item"]')?.getAttribute('data-card-id') !== String(old), id);
	}
	for (const [k, drill] of session.drills.entries()) {
		await page.getByTestId('drill').waitFor();
		if (k === 0 && shot) await shot('session-drill');
		await page.getByLabel('Câu đã sửa').fill(drill.corrected);
		await page.getByTestId('drill').getByRole('button', { name: 'Kiểm tra' }).click();
		await page.getByTestId('drill-feedback').getByRole('button').click();
		await page.waitForFunction((old) => document.querySelector('[data-testid="drill"]')?.getAttribute('data-cache-id') !== String(old), drill.cacheId);
	}
}

/** Đọc: the passage with a glossary popover, a question with its feedback, the end screen. */
async function readSession(page: Page, shot: Shot) {
	const session = (await openSession(page, 'budget=4&shape=read')) as Started;
	await playCardsAndDrills(page, session, shot);
	const anchor = session.anchor as Extract<Anchor, { type: 'reading' }>;
	if (anchor.glossary.length > 0) await page.getByTestId('passage').getByRole('button', { name: anchor.glossary[0].word }).click();
	await shot('session-reading', true);
	await page.getByRole('button', { name: 'Trả lời câu hỏi' }).click();
	for (const [k, q] of anchor.questions.entries()) {
		await page.getByTestId('reading').getByRole('button', { name: q.options[k === 0 ? q.answerIndex : (q.answerIndex + 1) % 4], exact: true }).click();
		await page.getByTestId('reading-feedback').waitFor();
		if (k === 0) await shot('session-reading-question');
		await page.getByTestId('reading-feedback').getByRole('button').click();
	}
	await page.getByTestId('session-done').waitFor();
	await shot('session-done-read');
}

/** Viết sessions until both a writing and a translation feedback are photographed. */
async function writeSessions(page: Page, shot: Shot) {
	const taken = new Set<string>();
	while (taken.size < 2) {
		const session = (await openSession(page, 'budget=4&shape=write')) as Started;
		await playCardsAndDrills(page, session, null);
		const anchor = session.anchor!;
		const text =
			anchor.type === 'writing'
				? 'Last Sunday I went to the market with my mother. We buyed some fish and vegetables, and then we cooked dinner together.'
				: `In other words: ${(anchor as Extract<Anchor, { type: 'translation' }>).referenceEn}`;
		await page.getByLabel(anchor.type === 'writing' ? 'Bài viết của bạn (bằng tiếng Anh)' : 'Bản dịch của bạn (bằng tiếng Anh)').fill(text);
		await page.getByRole('button', { name: 'Nộp bài' }).click();
		await page.getByTestId('feedback-card').waitFor();
		if (!taken.has(anchor.type)) await shot(`session-${anchor.type}-feedback`, true);
		taken.add(anchor.type);
		await page.getByTestId('writing').getByRole('button').last().click();
		await page.getByTestId('session-done').waitFor();
	}
}

/** Feedback at session start: a writing graded after its session (the canned grader fails it first). */
async function feedbackAtStart(page: Page, shot: Shot, theme: string) {
	for (;;) {
		const session = (await openSession(page, 'budget=4&shape=write')) as Started;
		await playCardsAndDrills(page, session, null);
		if (session.anchor?.type === 'writing') {
			await page.getByLabel('Bài viết của bạn (bằng tiếng Anh)').fill(`GRADELATER (${theme}) My childs like to play football after school every day.`);
			await page.getByRole('button', { name: 'Nộp bài' }).click();
			await page.getByTestId('anchor-queued').waitFor();
		}
		await page.getByTestId('writing').getByRole('button').last().click();
		await page.getByTestId('session-done').waitFor();
		if (session.anchor?.type === 'writing') break;
	}
	const db = createDb(`${OUT}/app.db`);
	// This process's canned grader also fails the marked text once: grade until nothing is queued.
	for (let i = 0; i < 3; i++) {
		const run = await gradeQueuedWritings({ maxCalls: 5 }, { llm: appLlmDeps(db, { LLM_CANNED: '1' }), dailyCap: 100_000 });
		if (run.remaining === 0) break;
	}
	db.$client.close();
	await openSession(page, 'budget=5&shape=quick');
	await page.getByTestId('session-feedback').waitFor();
	await shot('session-feedback-start', true);
	await page.getByRole('button', { name: 'Đã xem' }).click();
}

/** Phase 10: stats, the review book (both tabs, the detail sheet), each settings section, providers. */
async function progressScreens(page: Page, shot: Shot) {
	await page.goto(`${origin}/stats`);
	await page.waitForLoadState('networkidle');
	await shot('stats-full', true);
	await page.goto(`${origin}/review`);
	await shot('review-hard', true);
	await page.goto(`${origin}/review?tab=learned`);
	await shot('review-learned');
	const first = await page.getByTestId('review-row').first().getAttribute('data-card-id');
	await page.goto(`${origin}/review?tab=learned&card=${first}`);
	await page.getByTestId('card-detail').waitFor();
	await shot('review-detail');
	await page.goto(`${origin}/settings`);
	await page.waitForLoadState('networkidle');
	// The fixed tab bar would cover the bottom of a section's element screenshot.
	await page.addStyleTag({ content: 'nav[aria-label="Điều hướng chính"] { display: none }' });
	const sections = { learning: 'Học tập', theme: 'Giao diện', content: 'Nội dung', providers: 'Nhà cung cấp AI', usage: 'Sử dụng AI (7 ngày)', data: 'Dữ liệu', account: 'Tài khoản' };
	for (const [slug, title] of Object.entries(sections)) {
		const section = page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true, level: 2 }) });
		await section.scrollIntoViewIfNeeded();
		const file = `${OUT}/settings-${slug}-${theme(page)}.png`;
		await section.screenshot({ path: file });
		files.push(file);
	}
	await page.goto(`${origin}/settings/providers`);
	await shot('providers', true);
	await page.goto(`${origin}/settings/providers?add`);
	await shot('provider-form', true);
	await page.goto(`${origin}/settings/credits`);
	await shot('credits', true);
	await page.goto(`${origin}/`);
	await page.waitForLoadState('networkidle');
	await shot('home-today');
}
const themes = new WeakMap<Page, string>();
const theme = (page: Page) => themes.get(page) ?? 'light';

await waitForServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const files: string[] = [];
const contexts = [];
for (const theme of ['light', 'dark'] as const) {
	const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
	await context.addCookies([{ name: 'theme', value: theme, url: origin }]);
	const page = await context.newPage();
	themes.set(page, theme);
	const shot = async (name: string, fullPage = false) => {
		await page.evaluate(() => document.fonts.ready);
		const file = `${OUT}/${name}-${theme}.png`;
		await page.screenshot({ path: file, fullPage });
		files.push(file);
	};
	await page.goto(`${origin}/login`);
	await shot('login');
	await page.getByLabel('Mật khẩu').fill(PASSWORD);
	await page.getByRole('button', { name: 'Đăng nhập' }).click();
	await page.waitForURL(`${origin}/`);
	await shot('home');
	for (const path of ['stats', 'settings']) {
		await page.goto(`${origin}/${path}`);
		await shot(path);
	}
	await page.goto(`${origin}/dev/components`);
	await shot('components', true);
	contexts.push({ page, shot, theme });
}
// Then the placement test in each theme; the second run's result shows the comparison.
for (const [i, { page, shot }] of contexts.entries()) await placement(page, shot, i > 0);
for (const { page, shot } of contexts) await session(page, shot);
for (const { page, shot, theme } of contexts) {
	await readSession(page, shot);
	await writeSessions(page, shot);
	await feedbackAtStart(page, shot, theme);
	await page.goto(`${origin}/`);
	await page.waitForLoadState('networkidle');
	await shot('home-shape');
	await progressScreens(page, shot);
}
await browser.close();
stop();
for (const file of files) console.log(file);
