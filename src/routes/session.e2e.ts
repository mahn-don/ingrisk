// The daily session end to end, on a server with seeded content (cloze pool, passages, drills)
// and the canned LLM. Phase 9a: the quick loop; Phase 9b (below): Đọc, Viết, drills, mining.
import { type Page, type Request, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import type { Anchor, SessionItem, StartResponse } from '../lib/session/types.ts';
import { E2E_CRON_SECRET, SERVERS, addDueCards, introducedToday, login, setNewCardsPerDay } from '../../test/e2e/support.ts';

test.describe.configure({ mode: 'serial', timeout: 180_000 });

const DB = SERVERS.session.db;
const NEW_PER_DAY = 4;

test.beforeAll(() => {
	setNewCardsPerDay(DB, NEW_PER_DAY);
	addDueCards(DB, 12, { typing: 1 });
});

/** From Home: pick the budget chip, start, and return the session the server composed. */
async function startFromHome(page: Page, minutes: number): Promise<SessionItem[]> {
	await login(page, '/');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: `${minutes} phút`, exact: true }).click();
	const [response] = await Promise.all([page.waitForResponse('**/api/session/start'), page.getByRole('link', { name: 'Bắt đầu học' }).click()]);
	const body = (await response.json()) as StartResponse;
	await expect(page.getByTestId('session-item')).toBeVisible();
	return body.items;
}

const current = async (page: Page, items: SessionItem[]) => {
	const id = Number(await page.getByTestId('session-item').getAttribute('data-card-id'));
	return items.find((i) => i.cardId === id)!;
};
const optionLabel = (option: string) => (option === '—' ? '(không cần từ nào)' : option);
/** One wrong character in the middle of the word. */
const withTypo = (word: string) => word.slice(0, 2) + (word[2] === 'x' ? 'z' : 'x') + word.slice(3);

/** Answer the item on screen: right or wrong (typing items always with one typo). Returns "correct". */
async function answer(page: Page, item: SessionItem, right: boolean): Promise<boolean> {
	const card = page.getByTestId('session-item');
	if (item.mode === 'typing') {
		await card.getByLabel('Câu trả lời của bạn').fill(withTypo(item.answer));
		await card.getByRole('button', { name: 'Kiểm tra' }).click();
		await expect(page.getByTestId('typo')).toContainText(item.answer);
		return true;
	}
	const option = right ? item.answer : item.options!.find((o) => o !== item.answer)!;
	await card.getByRole('button', { name: optionLabel(option), exact: true }).click();
	return right;
}

async function next(page: Page, last: boolean) {
	const id = await page.getByTestId('session-item').getAttribute('data-card-id');
	await page.getByRole('button', { name: last ? 'Xem kết quả' : 'Tiếp', exact: true }).click();
	if (!last) await page.waitForFunction((old) => document.querySelector('[data-testid="session-item"]')?.getAttribute('data-card-id') !== old, id);
}

test('a full session from Home: one start, one finish, and the right counts', async ({ page }) => {
	const calls: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/api/session/')) calls.push(new URL(r.url()).pathname);
	});
	const items = await startFromHome(page, 5);
	expect(items).toHaveLength(15);
	expect(items.filter((i) => i.isNew)).toHaveLength(3);
	expect(items.filter((i) => i.mode === 'typing')).toHaveLength(1);

	let correct = 0;
	for (let k = 0; k < items.length; k++) {
		const item = await current(page, items);
		if (await answer(page, item, k % 3 !== 2)) correct++;
		await expect(page.getByTestId('feedback')).toBeVisible();
		await expect(page.getByTestId('next-review')).toContainText('Ôn lại sau');
		await next(page, k === items.length - 1);
	}
	await expect(page.getByTestId('session-done')).toBeVisible();
	await expect(page.getByTestId('done-answered')).toHaveText(`Bạn đã làm 15 câu, đúng ${correct} câu (${Math.round((correct / 15) * 100)}%).`);
	await expect(page.getByTestId('done-new')).toHaveText('3');
	expect(calls).toEqual(['/api/session/start', '/api/session/finish']);
	await page.getByRole('link', { name: 'Về trang Hôm nay' }).click();
	await expect(page).toHaveURL('/');
});

test('ending early saves only the answered items', async ({ page }) => {
	addDueCards(DB, 6);
	const items = await startFromHome(page, 5);
	for (let k = 0; k < 2; k++) {
		await answer(page, await current(page, items), true);
		await next(page, false);
	}
	await page.getByTestId('session-exit').click();
	await expect(page.getByRole('alertdialog')).toContainText('Dừng buổi học?');
	await page.getByRole('button', { name: 'Kết thúc sớm và lưu' }).click();
	await expect(page.getByTestId('done-answered')).toHaveText('Bạn đã làm 2 câu, đúng 2 câu (100%).');
});

test('a second session the same day stays within the new-card limit', async ({ page }) => {
	addDueCards(DB, 6);
	const introduced = introducedToday(DB);
	const items = await startFromHome(page, 10);
	expect(items.filter((i) => i.isNew).length).toBe(Math.max(0, NEW_PER_DAY - introduced));
	// Leave without saving: nothing is reviewed.
	await page.getByTestId('session-exit').click();
	await page.getByRole('link', { name: 'Bỏ phiên này' }).click();
	await expect(page).toHaveURL('/');
	expect(introducedToday(DB)).toBe(introduced);
});

// --- Phase 9b ----------------------------------------------------------------------------------


/** Open /session with a budget and shape; returns the session the server composed. */
async function openSession(page: Page, budget: number, shape: 'quick' | 'read' | 'write') {
	const started = page.waitForResponse('**/api/session/start');
	await page.goto(`/session?budget=${budget}&shape=${shape}`);
	return (await (await started).json()) as Extract<StartResponse, { sessionId: number }>;
}

async function waitForStep(page: Page, previous: string | null) {
	await page.waitForFunction((old) => {
		const el = document.querySelector('[data-testid="session-item"], [data-testid="drill"], [data-testid="reading"], [data-testid="writing"], [data-testid="session-done"]');
		const id = el ? `${el.getAttribute('data-testid')}:${el.getAttribute('data-card-id') ?? el.getAttribute('data-cache-id') ?? ''}` : null;
		return id !== null && id !== old;
	}, previous);
}
const stepId = async (page: Page) =>
	page.evaluate(() => {
		const el = document.querySelector('[data-testid="session-item"], [data-testid="drill"], [data-testid="reading"], [data-testid="writing"]');
		return el ? `${el.getAttribute('data-testid')}:${el.getAttribute('data-card-id') ?? el.getAttribute('data-cache-id') ?? ''}` : null;
	});

/** Answer every card on screen correctly (typing by typing the answer). */
async function answerCards(page: Page, items: SessionItem[]) {
	while (await page.getByTestId('session-item').isVisible()) {
		const id = Number(await page.getByTestId('session-item').getAttribute('data-card-id'));
		const item = items.find((i) => i.cardId === id)!;
		const card = page.getByTestId('session-item');
		if (item.mode === 'typing') {
			await card.getByLabel('Câu trả lời của bạn').fill(item.answer);
			await card.getByRole('button', { name: 'Kiểm tra' }).click();
		} else await card.getByRole('button', { name: optionLabel(item.answer), exact: true }).click();
		const before = await stepId(page);
		await page.getByTestId('feedback').getByRole('button').last().click();
		await waitForStep(page, before);
	}
}

async function answerDrills(page: Page, right: boolean[]) {
	for (const ok of right) {
		const drill = page.getByTestId('drill');
		await expect(drill).toBeVisible();
		const box = drill.getByLabel('Câu đã sửa');
		await box.fill(ok ? await correctedOf(page) : 'Something else entirely.');
		await drill.getByRole('button', { name: 'Kiểm tra' }).click();
		await expect(page.getByTestId('drill-feedback')).toHaveAttribute('data-correct', String(ok));
		const before = await stepId(page);
		await page.getByTestId('drill-feedback').getByRole('button').click();
		await waitForStep(page, before);
	}
}
let drillAnswers = new Map<number, string>();
const correctedOf = async (page: Page) => drillAnswers.get(Number(await page.getByTestId('drill').getAttribute('data-cache-id')))!;

function remember(session: Extract<StartResponse, { sessionId: number }>) {
	drillAnswers = new Map(session.drills.map((d) => [d.cacheId, d.corrected]));
}

const finishBody = (request: Request) => JSON.parse(request.postData() ?? '{}');

test('typing items always show the meaning; "Xem nghĩa câu" counts as a hint', async ({ page }) => {
	addDueCards(DB, 4, { typing: 1 });
	await login(page, '/');
	const session = await openSession(page, 5, 'quick');
	expect(session.shape).toBe('quick');
	const finish = page.waitForRequest('**/api/session/finish');
	let hinted: number | null = null;
	while (await page.getByTestId('session-item').isVisible()) {
		const id = Number(await page.getByTestId('session-item').getAttribute('data-card-id'));
		const item = session.items.find((i) => i.cardId === id)!;
		const card = page.getByTestId('session-item');
		if (item.mode === 'typing') {
			await expect(page.getByTestId('meaning-cue')).toContainText(item.viTranslation);
			await card.getByLabel('Câu trả lời của bạn').fill(item.answer);
			await card.getByRole('button', { name: 'Kiểm tra' }).click();
		} else {
			await expect(page.getByTestId('meaning-cue')).toHaveCount(0);
			if (hinted === null && item.viTranslation !== '') {
				await page.getByTestId('show-meaning').click();
				await expect(page.getByTestId('meaning-cue')).toContainText(item.viTranslation);
				hinted = id;
			}
			await card.getByRole('button', { name: optionLabel(item.answer), exact: true }).click();
		}
		const before = await stepId(page);
		await page.getByTestId('feedback').getByRole('button').last().click();
		await waitForStep(page, before);
	}
	expect(session.items.some((i) => i.mode === 'typing')).toBe(true);
	expect(hinted).not.toBeNull();
	await expect(page.getByTestId('session-done')).toBeVisible();
	const body = finishBody(await finish);
	expect(body.results.find((r: { cardId: number }) => r.cardId === hinted).hintUsed).toBe(true);
});

test('Home shows today\'s shape, which follows the budget', async ({ page }) => {
	await login(page, '/');
	await page.waitForLoadState('networkidle');
	await expect(page.getByTestId('shape-today')).toHaveText(/Hôm nay: (Đọc|Viết)/);
	await page.getByRole('button', { name: '5 phút', exact: true }).click();
	await expect(page.getByTestId('shape-today')).toHaveText('Hôm nay: Nhanh');
	await page.getByRole('button', { name: '8 phút', exact: true }).click();
	await page.getByRole('button', { name: 'Viết', exact: true }).click();
	await expect(page.getByTestId('shape-today')).toHaveText('Hôm nay: Viết');
	await expect(page.getByRole('link', { name: 'Bắt đầu học' })).toHaveAttribute('href', '/session?budget=8&shape=write');
});

test('a Đọc session end to end: cards, drills, the passage, the summary', async ({ page }) => {
	addDueCards(DB, 3);
	await login(page, '/');
	const session = await openSession(page, 4, 'read');
	remember(session);
	expect(session.shape).toBe('read');
	expect(session.drills).toHaveLength(2);
	const anchor = session.anchor as Extract<Anchor, { type: 'reading' }>;
	expect(anchor.type).toBe('reading');
	await answerCards(page, session.items);
	await answerDrills(page, [true, false]);
	// The passage: a glossary word shows its meaning.
	await expect(page.getByTestId('passage')).toContainText(anchor.passage.slice(0, 20));
	const word = anchor.glossary[0];
	await page.getByTestId('passage').getByRole('button', { name: word.word }).click();
	await expect(page.getByTestId('glossary-popover')).toContainText(word.vi);
	if (word.addable) {
		await page.getByRole('button', { name: 'Thêm vào ôn tập' }).click();
		await expect(page.getByTestId('glossary-popover')).toContainText('Đã thêm vào ôn tập');
	}
	await page.getByRole('button', { name: 'Trả lời câu hỏi' }).click();
	for (const [k, q] of anchor.questions.entries()) {
		await expect(page.getByTestId('reading-question')).toHaveText(q.question);
		await page.getByTestId('reading').getByRole('button', { name: q.options[k === 0 ? q.answerIndex : (q.answerIndex + 1) % 4], exact: true }).click();
		await expect(page.getByTestId('reading-feedback')).toContainText(q.explanationVi);
		await page.getByTestId('reading-feedback').getByRole('button').click();
	}
	await expect(page.getByTestId('session-done')).toBeVisible();
	await expect(page.getByTestId('done-anchor')).toHaveText('Bài đọc: đúng 1/2 câu hỏi.');
	await expect(page.getByTestId('done-drills')).toHaveText('Bài sửa lỗi: đúng 1/2.');
});

test('a Viết writing session: feedback inline, the error mined', async ({ page }) => {
	await login(page, '/');
	const session = await openSession(page, 4, 'write');
	remember(session);
	expect(session.anchor?.type).toBe('writing');
	await answerCards(page, session.items);
	await answerDrills(page, session.drills.map(() => true));
	await page.getByLabel('Bài viết của bạn (bằng tiếng Anh)').fill('On Sunday I went to the market with my family. We buyed some fish and rice.');
	await page.getByRole('button', { name: 'Nộp bài' }).click();
	const card = page.getByTestId('feedback-card');
	await expect(card).toContainText('bought');
	await expect(page.getByTestId('corrected').locator('mark')).toHaveText('bought');
	await expect(page.getByTestId('mined-count')).toHaveText('Đã thêm 1 lỗi vào ôn tập.');
	await page.getByTestId('writing').getByRole('button', { name: 'Xem kết quả' }).click();
	await expect(page.getByTestId('done-anchor')).toHaveText('Bài viết đã được chấm.');
	await expect(page.getByTestId('done-mined')).toHaveText('Lỗi mới được thêm vào ôn tập: 1');
});

test('the mined error card comes in a later session, tagged "Lỗi của bạn"', async ({ page }) => {
	await login(page, '/');
	const session = await openSession(page, 5, 'quick');
	const mined = session.items.find((i) => i.isMined);
	expect(mined).toMatchObject({ answer: 'bought', gapType: 'user_error', isNew: true });
	while (Number(await page.getByTestId('session-item').getAttribute('data-card-id')) !== mined!.cardId) {
		const id = Number(await page.getByTestId('session-item').getAttribute('data-card-id'));
		const item = session.items.find((i) => i.cardId === id)!;
		if (item.mode === 'typing') {
			await page.getByLabel('Câu trả lời của bạn').fill(item.answer);
			await page.getByRole('button', { name: 'Kiểm tra' }).click();
		} else await page.getByTestId('session-item').getByRole('button', { name: optionLabel(item.answer), exact: true }).click();
		const before = await stepId(page);
		await page.getByTestId('feedback').getByRole('button').last().click();
		await waitForStep(page, before);
	}
	await expect(page.getByTestId('mined-tag')).toHaveText('Lỗi của bạn');
	await page.getByTestId('session-exit').click();
	await page.getByRole('link', { name: 'Bỏ phiên này' }).click();
});

test('a Viết translation session accepts a different correct translation', async ({ page }) => {
	await login(page, '/');
	const session = await openSession(page, 4, 'write');
	remember(session);
	const anchor = session.anchor as Extract<Anchor, { type: 'translation' }>;
	expect(anchor.type).toBe('translation');
	await answerCards(page, session.items);
	await answerDrills(page, session.drills.map(() => true));
	await expect(page.getByTestId('translation-source')).toHaveText(anchor.vi);
	await page.getByLabel('Bản dịch của bạn (bằng tiếng Anh)').fill(`In other words: ${anchor.referenceEn}`);
	await page.getByRole('button', { name: 'Nộp bài' }).click();
	await expect(page.getByTestId('meaning-ok')).toHaveText('Bản dịch truyền đạt đúng ý.');
	await expect(page.getByTestId('reference')).toContainText(anchor.referenceEn);
	await expect(page.getByTestId('feedback-card')).toContainText('Đây chỉ là một cách dịch; còn nhiều cách đúng khác.');
	await expect(page.getByTestId('feedback-card')).toContainText('Không có lỗi đáng kể. Tốt lắm!');
	await page.getByTestId('writing').getByRole('button', { name: 'Xem kết quả' }).click();
	await expect(page.getByTestId('done-anchor')).toHaveText('Bài viết đã được chấm.');
});

test('a writing graded later is shown at the next session start, then marked seen', async ({ page, request }) => {
	await login(page, '/');
	const session = await openSession(page, 4, 'write');
	remember(session);
	expect(session.anchor?.type).toBe('writing');
	await answerCards(page, session.items);
	await answerDrills(page, session.drills.map(() => true));
	await page.getByLabel('Bài viết của bạn (bằng tiếng Anh)').fill('GRADELATER Last week my childs played football in the park every day.');
	await page.getByRole('button', { name: 'Nộp bài' }).click();
	await expect(page.getByTestId('anchor-queued')).toBeVisible();
	await page.getByTestId('writing').getByRole('button', { name: 'Xem kết quả' }).click();
	await expect(page.getByTestId('done-anchor')).toHaveText('Bài viết sẽ được chấm sau; nhận xét sẽ hiện ở đầu buổi học tới.');

	// Prefetch grades queued writing first (the cron endpoint, as at 03:00).
	const cron = await request.post('/api/cron/prefetch', { headers: { authorization: `Bearer ${E2E_CRON_SECRET}`, 'content-type': 'application/json' }, data: { maxCalls: 2 } });
	expect(cron.status()).toBe(200);
	await expect
		.poll(() => {
			const db = new Database(DB, { readonly: true });
			try {
				return db.prepare("select status from writing_submissions where user_text like 'GRADELATER%'").pluck().get();
			} finally {
				db.close();
			}
		})
		.toBe('scored');

	const next = await openSession(page, 5, 'quick');
	expect(next.feedback.map((f) => f.userText)).toEqual(['GRADELATER Last week my childs played football in the park every day.']);
	await expect(page.getByTestId('session-feedback')).toContainText('children');
	await page.getByRole('button', { name: 'Đã xem' }).click();
	await expect(page.getByTestId('session-item')).toBeVisible();
	const again = await openSession(page, 5, 'quick');
	expect(again.feedback).toEqual([]);
});
