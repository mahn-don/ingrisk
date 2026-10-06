// The daily session end to end, on a server with seeded content (no LLM involved).
import { type Page, expect, test } from '@playwright/test';
import type { SessionItem, StartResponse } from '../lib/session/types.ts';
import { SERVERS, addDueCards, introducedToday, login, setNewCardsPerDay } from '../../test/e2e/support.ts';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

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
