// Phase 10 end to end, on a seeded server with a study history and the canned LLM: the stats page,
// a topic focus session, the review book, settings applied to the next session, providers (the
// key's presence only, never its value) and the backup download.
import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import type { StartResponse } from '../lib/session/types.ts';
import {
	E2E_FAKE_PROVIDER_KEY,
	SERVERS,
	addDueCards,
	answerOf,
	deleteProviderRow,
	insertProvider,
	login,
	seedHistory,
	servedCards,
	setNewCardsPerDay,
	topicsOf
} from '../../test/e2e/support.ts';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

const DB = SERVERS.progress.db;
let lapsed: number[] = [];

test.beforeAll(() => {
	lapsed = seedHistory(DB, { days: 3, lapsed: 4 });
	addDueCards(DB, 6);
	setNewCardsPerDay(DB, 3);
});

async function startSessionAt(page: Page, url: string): Promise<StartResponse> {
	const [response] = await Promise.all([page.waitForResponse('**/api/session/start'), page.goto(url)]);
	return (await response.json()) as StartResponse;
}

test('stats render the seeded history', async ({ page }) => {
	await login(page, '/stats');
	await expect(page.getByRole('heading', { name: 'Tiến độ', level: 1 })).toBeVisible();
	await expect(page.getByTestId('stats-streak')).toContainText('3');
	await expect(page.getByTestId('stats-streak')).toContainText('ngày liên tiếp');
	await expect(page.getByTestId('stats-week')).toContainText('Tuần này');
	await expect(page.getByTestId('heatmap')).toBeVisible();
	await expect(page.getByRole('table', { name: 'Số phút học mỗi ngày' })).toBeAttached();
	await expect(page.getByTestId('forecast')).toBeVisible();
	await expect(page.getByTestId('stats-totals')).toContainText('Buổi học');
	await expect(page.getByTestId('weakness-PRE')).toContainText('4 lỗi trong 30 ngày');
	await expect(page.getByTestId('weakness-PRE')).toContainText('đúng 0% câu điền');
});

test('"Luyện chủ đề này" starts a session of that topic only', async ({ page }) => {
	await login(page, '/stats');
	await page.waitForLoadState('networkidle');
	const button = page.getByTestId('weakness-PRE').getByRole('link', { name: /^Luyện chủ đề này/ });
	await expect(button).toHaveAttribute('href', '/session?focus=topic:PRE');
	const [response] = await Promise.all([page.waitForResponse('**/api/session/start'), button.click()]);
	const started = (await response.json()) as StartResponse;
	expect(started.shape).toBe('quick');
	expect(started.items.length).toBeGreaterThan(0);
	expect(new Set(topicsOf(DB, started.items.map((i) => i.cardId)))).toEqual(new Set(['PRE']));
	expect(started.items.every((i) => !i.isNew)).toBe(true);
	expect(started.drills.every((d) => d.topicCode === 'PRE')).toBe(true);
	await expect(page.getByTestId('session-item')).toBeVisible();
});

test('a malformed focus is rejected by the server', async ({ page }) => {
	await login(page, '/');
	const status = await page.evaluate(async () => {
		const response = await fetch('/api/session/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ focus: { kind: 'topic', code: 'XYZ' } }) });
		return response.status;
	});
	expect(status).toBe(400);
});

test('review book: search, detail, Tạm ẩn, then the card is gone from the next session', async ({ page }) => {
	const cardId = lapsed[0];
	const answer = answerOf(DB, cardId);
	await login(page, '/review');
	await expect(page.getByRole('heading', { name: 'Sổ ôn tập', level: 1 })).toBeVisible();
	await expect(page.locator(`[data-testid="review-row"][data-card-id="${cardId}"]`)).toBeVisible();
	await page.getByTestId('tab-learned').click();
	await page.getByLabel('Tìm thẻ').fill(answer);
	await page.getByRole('button', { name: 'Tìm', exact: true }).click();
	await page.waitForURL(/q=/);
	const row = page.locator(`[data-testid="review-row"][data-card-id="${cardId}"]`);
	await expect(row).toBeVisible();
	await row.click();
	const sheet = page.getByRole('dialog', { name: 'Chi tiết thẻ' });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByTestId('detail-sentence')).toContainText(answer);
	await expect(sheet.getByTestId('detail-history')).toContainText('Quên');
	await page.waitForLoadState('networkidle');
	await sheet.getByRole('button', { name: 'Tạm ẩn' }).click();
	await expect(sheet.getByTestId('detail-done')).toHaveText('Đã tạm ẩn thẻ.');
	await expect(sheet.getByRole('button', { name: 'Bỏ ẩn' })).toBeVisible();
	await expect(row.getByTestId('review-next')).toHaveText('Đang tạm ẩn');

	// Even "Ôn các thẻ hay sai" (regardless of due) leaves it out.
	const hard = await startSessionAt(page, '/session?focus=hard');
	expect(hard.items.length).toBeGreaterThan(0);
	expect(hard.items.map((i) => i.cardId)).not.toContain(cardId);
	expect(servedCards(DB).map((c) => c.cardId)).not.toContain(cardId);
	const quick = await startSessionAt(page, '/session?budget=10&shape=quick');
	expect(quick.items.map((i) => i.cardId)).not.toContain(cardId);
});

test('a settings change is reflected in the next session', async ({ page }) => {
	await login(page, '/settings');
	await page.waitForLoadState('networkidle');
	const form = page.getByTestId('settings-learning');
	await form.getByLabel('Thẻ mới mỗi ngày (0–50)').fill('0');
	await form.getByRole('button', { name: 'Lưu', exact: true }).click();
	await expect(page.getByTestId('learning-status')).toHaveText('Đã lưu. Thay đổi áp dụng từ buổi học tới.');
	const none = await startSessionAt(page, '/session?budget=10&shape=quick');
	expect(none.items.filter((i) => i.isNew && !i.isMined)).toEqual([]);

	await page.goto('/settings');
	await page.waitForLoadState('networkidle');
	await form.getByLabel('Thẻ mới mỗi ngày (0–50)').fill('50');
	await form.getByRole('button', { name: 'Lưu', exact: true }).click();
	await expect(page.getByTestId('learning-status')).toBeVisible();
	const some = await startSessionAt(page, '/session?budget=10&shape=quick');
	expect(some.items.filter((i) => i.isNew).length).toBeGreaterThan(0);
});

test('add a provider and test the connection (canned); the key is never shown', async ({ page }) => {
	await login(page, '/settings/providers');
	await expect(page.getByTestId('key-note')).toContainText('.env');
	await page.getByRole('link', { name: 'Thêm nhà cung cấp' }).click();
	await page.waitForURL(/\?add/);
	await page.waitForLoadState('networkidle');
	const form = page.getByTestId('provider-form');
	await form.getByLabel('Tên', { exact: true }).fill('E2E provider');
	await form.getByLabel(/Địa chỉ API/).fill('https://api.example.com/v1');
	await form.getByLabel('Mô hình', { exact: true }).fill('example-model');
	// A pasted value that is not a variable NAME is refused.
	await form.getByLabel(/Tên biến môi trường/).fill('sk-not-a-name');
	await form.getByRole('button', { name: 'Lưu', exact: true }).click();
	await expect(form.getByText(/Tên biến chỉ gồm chữ IN HOA/)).toBeVisible();
	await form.getByLabel(/Tên biến môi trường/).fill('E2E_FAKE_PROVIDER_KEY');
	await form.getByRole('button', { name: 'Lưu', exact: true }).click();
	await page.waitForURL(/saved/);

	const provider = page.locator('[data-testid="provider"][data-name="E2E provider"]');
	await expect(provider.getByTestId('provider-key')).toContainText('E2E_FAKE_PROVIDER_KEY');
	await expect(provider.getByTestId('provider-key')).toContainText('đã đặt trên máy chủ');
	await page.waitForLoadState('networkidle');
	await provider.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
	await expect(provider.getByTestId('provider-test')).toContainText('Kết nối tốt');
	expect(await page.content()).not.toContain(E2E_FAKE_PROVIDER_KEY);

	await provider.getByRole('button', { name: 'Đặt làm dự phòng' }).click();
	await expect(provider.getByText('Dự phòng', { exact: true })).toBeVisible();
});

test('a provider deleted behind the UI: "set active" shows an error toast and the list reloads', async ({ page }) => {
	const id = insertProvider(DB, 'Stale provider');
	await login(page, '/settings/providers');
	await page.waitForLoadState('networkidle');
	const stale = page.locator('[data-testid="provider"][data-name="Stale provider"]');
	await expect(stale).toBeVisible();
	deleteProviderRow(DB, id);
	await stale.getByRole('button', { name: 'Dùng nhà cung cấp này' }).click();
	await expect(page.getByTestId('toast')).toContainText('Nhà cung cấp này không còn nữa');
	await expect(stale).toHaveCount(0);
	// The other actions on a stale card behave the same.
	const again = insertProvider(DB, 'Stale again');
	await page.reload();
	await page.waitForLoadState('networkidle');
	const card = page.locator('[data-testid="provider"][data-name="Stale again"]');
	deleteProviderRow(DB, again);
	await card.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
	await expect(page.getByTestId('toast')).toContainText('Nhà cung cấp này không còn nữa');
	await expect(card).toHaveCount(0);
});

test('the backup downloads a SQLite file with the cards; it needs a login', async ({ page, browser }) => {
	await login(page, '/settings');
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup-link').click()]);
	expect(download.suggestedFilename()).toMatch(/^silentenglish-\d{4}-\d{2}-\d{2}\.db$/);
	const path = await download.path();
	expect(readFileSync(path).subarray(0, 15).toString('latin1')).toBe('SQLite format 3');
	const copy = new Database(path, { readonly: true });
	expect((copy.prepare('select count(*) as n from cards').get() as { n: number }).n).toBeGreaterThan(0);
	copy.close();

	const anonymous = await browser.newContext({ baseURL: `http://localhost:${SERVERS.progress.port}` });
	expect((await anonymous.request.get('/api/backup')).status()).toBe(401);
	await anonymous.close();
});

test("Home's today card", async ({ page }) => {
	await login(page, '/');
	await expect(page.getByTestId('today-card')).toBeVisible();
	await expect(page.getByTestId('today-streak')).toHaveText(/\d+/);
	await expect(page.getByTestId('today-week')).toContainText('Tuần này');
	await expect(page.getByTestId('today-next')).toContainText('Lần ôn tới');
});

test.describe('learner profiles (Phase 12)', () => {
	const homeNumbers = async (page: Page) => ({
		due: await page.getByTestId('count-due').textContent(),
		fresh: await page.getByTestId('count-new').textContent(),
		learning: await page.getByTestId('count-learning').textContent(),
		streak: await page.getByTestId('today-streak').textContent()
	});

	test('a second profile does a session; profile 1 keeps its due counts and streak', async ({ page }) => {
		await login(page, '/');
		await expect(page.getByTestId('profile-current')).toHaveText('Hồ sơ: Hồ sơ 1');
		const before = await homeNumbers(page);
		expect(Number(before.streak)).toBeGreaterThan(0);
		await page.goto('/stats');
		const statsStreak = await page.getByTestId('stats-streak').textContent();

		// "Đổi hồ sơ" → "+ Thêm hồ sơ": a new profile starts like a fresh install.
		await page.getByRole('link', { name: 'Đổi hồ sơ' }).click();
		await expect(page).toHaveURL('/profiles');
		await page.getByTestId('profile-add').click();
		const create = page.getByTestId('profile-create');
		await create.getByLabel('Tên (1–30 ký tự)').fill('Bé Na');
		await create.getByLabel('Biểu tượng (không bắt buộc), ví dụ 🐱').fill('🐱');
		await create.getByRole('button', { name: 'Tạo hồ sơ' }).click();
		await expect(page).toHaveURL('/');
		await expect(page.getByTestId('profile-current')).toHaveText('Hồ sơ: 🐱 Bé Na');
		await expect(page.getByTestId('placement-onboarding')).toBeVisible();
		await expect(page.getByTestId('count-due')).toHaveText('0');
		await expect(page.getByTestId('today-streak')).toHaveText('0');
		await page.getByRole('button', { name: 'Bỏ qua, bắt đầu từ cơ bản' }).click();
		await expect(page.getByTestId('placement-onboarding')).toHaveCount(0);

		// A quick session of new cards, every answer right.
		const started = await startSessionAt(page, '/session?budget=5&shape=quick');
		expect(started.items.length).toBeGreaterThanOrEqual(5);
		for (const [k, item] of started.items.entries()) {
			const card = page.getByTestId('session-item');
			await expect(card).toHaveAttribute('data-card-id', String(item.cardId));
			await card.getByRole('button', { name: item.answer === '—' ? '(không cần từ nào)' : item.answer, exact: true }).click();
			await page.getByRole('button', { name: k === started.items.length - 1 ? 'Xem kết quả' : 'Tiếp', exact: true }).click();
		}
		await expect(page.getByTestId('session-done')).toBeVisible();
		await page.getByRole('link', { name: 'Về trang Hôm nay' }).click();
		await expect(page.getByTestId('today-streak')).toHaveText('1');

		// Back to profile 1: nothing changed.
		await page.getByRole('link', { name: 'Đổi hồ sơ' }).click();
		await expect(page.getByTestId('profiles-grid')).toContainText('Chuỗi: 1 ngày');
		await page.getByRole('button', { name: 'Học với hồ sơ Hồ sơ 1', exact: true }).click();
		await expect(page).toHaveURL('/');
		await expect(page.getByTestId('profile-current')).toHaveText('Hồ sơ: Hồ sơ 1');
		expect(await homeNumbers(page)).toEqual(before);
		await page.goto('/stats');
		await expect(page.getByTestId('stats-streak')).toHaveText(statsStreak!);

		// The second profile's cards are its own.
		const db = new Database(DB, { readonly: true });
		try {
			const owners = db.prepare('select distinct profile_id from cards where id in (' + started.items.map(() => '?').join(',') + ')').pluck().all(...started.items.map((i) => i.cardId));
			expect(owners).toHaveLength(1);
			expect(owners[0]).not.toBe(1);
		} finally {
			db.close();
		}
	});

	test('rename and archive (with a confirm dialog); the data stays', async ({ page }) => {
		await login(page, '/profiles', null);
		await expect(page).toHaveURL('/profiles');
		const grid = page.getByTestId('profiles-grid');
		await grid.locator('li', { hasText: 'Bé Na' }).getByRole('button', { name: 'Sửa' }).click();
		const edit = page.getByTestId('profile-edit');
		await edit.getByLabel('Tên (1–30 ký tự)').fill('Na');
		await edit.getByRole('button', { name: 'Lưu' }).click();
		await expect(page.getByTestId('profiles-status')).toHaveText('Đã lưu hồ sơ.');
		await expect(grid).toContainText('Na');
		await grid.locator('li', { hasText: 'Na' }).getByRole('button', { name: 'Sửa' }).click();
		await page.getByTestId('profile-archive').click();
		const dialog = page.getByTestId('archive-dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText('Dữ liệu học vẫn được giữ nguyên');
		await dialog.getByRole('button', { name: 'Ẩn hồ sơ' }).click();
		await expect(page.getByTestId('profiles-status')).toHaveText('Đã ẩn hồ sơ. Dữ liệu vẫn được giữ.');
		await expect(grid.getByRole('button', { name: 'Học với hồ sơ Na', exact: true })).toHaveCount(0);
		const db = new Database(DB, { readonly: true });
		try {
			const row = db.prepare("select id, archived_at from profiles where name = 'Na'").get() as { id: number; archived_at: number | null };
			expect(row.archived_at).not.toBeNull();
			expect(db.prepare('select count(*) from cards where profile_id = ?').pluck().get(row.id)).toBeGreaterThan(0);
		} finally {
			db.close();
		}
	});

	test('logged in without a profile, pages go to the picker and /api answers 409', async ({ page }) => {
		await login(page, '/stats', null);
		await expect(page).toHaveURL('/profiles?next=%2Fstats');
		const status = await page.evaluate(async () => (await fetch('/api/session/start', { method: 'POST', body: '{}' })).status);
		expect(status).toBe(409);
		await page.getByRole('button', { name: 'Học với hồ sơ Hồ sơ 1', exact: true }).click();
		await expect(page).toHaveURL('/stats');
	});
});
