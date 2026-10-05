// The placement test end to end, on a server with seeded content and the canned LLM (LLM_CANNED=1).
import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';
import { login } from '../../test/e2e/support.ts';

// The tests build on each other: first attempt, resume, result, retake.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

const PSEUDO = new Set(
	(JSON.parse(readFileSync('src/lib/server/content/pseudowords.json', 'utf8')) as { items: { form: string }[] }).items.map((i) => i.form)
);

const intro = (page: Page) => page.getByTestId('placement-intro');

/** Wait until the item on screen changes (or the part ends). */
async function waitForNext(page: Page, testid: string, ref: string | null) {
	await page.waitForFunction(([id, old]) => document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-ref') !== old, [testid, ref] as const);
}

/** Answer Part A honestly (real words "Biết", pseudo-words "Không biết") until Part B's intro. */
async function answerPartA(page: Page, max = 60): Promise<number> {
	let answered = 0;
	for (; answered < max; answered++) {
		const item = page.getByTestId('part-a');
		if (!(await item.isVisible())) break;
		const ref = await item.getAttribute('data-ref');
		const word = (await page.getByTestId('part-a-word').textContent())!.trim();
		await page.getByRole('button', { name: PSEUDO.has(word) ? 'Không biết' : 'Biết', exact: true }).click();
		await waitForNext(page, 'part-a', ref);
	}
	return answered;
}

async function answerPartB(page: Page): Promise<number> {
	let answered = 0;
	for (; answered < 20; answered++) {
		const item = page.getByTestId('part-b');
		if (!(await item.isVisible())) break;
		const ref = await item.getAttribute('data-ref');
		await item.getByRole('button').first().click();
		await waitForNext(page, 'part-b', ref);
	}
	return answered;
}

async function beginPart(page: Page, title: RegExp) {
	await expect(intro(page)).toBeVisible();
	await expect(intro(page).getByRole('heading')).toHaveText(title);
	await page.getByRole('button', { name: 'Bắt đầu phần này' }).click();
}

test('the API is behind the login', async ({ request }) => {
	const response = await request.post('/api/placement/start', { data: {} });
	expect(response.status()).toBe(401);
});

test('the onboarding card shows before the first result', async ({ page }) => {
	await login(page, '/');
	await expect(page.getByTestId('placement-onboarding')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Bỏ qua, bắt đầu từ cơ bản' })).toBeVisible();
	await expect(page.getByTestId('placement-resume')).toHaveCount(0);
});

test('leaving mid-Part A keeps the attempt; it resumes on the same word', async ({ page }) => {
	await login(page, '/');
	await page.getByRole('link', { name: 'Làm bài kiểm tra đầu vào (~10 phút)' }).click();
	await expect(page.getByTestId('placement-welcome')).toBeVisible();
	await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
	await expect(intro(page)).toContainText('từ bịa, không có thật');
	await page.getByRole('button', { name: 'Bắt đầu phần này' }).click();
	await answerPartA(page, 3);
	const word = (await page.getByTestId('part-a-word').textContent())!.trim();
	await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');

	// The exit asks in the page first; staying keeps the item.
	await page.getByTestId('placement-exit').click();
	await expect(page.getByRole('alertdialog')).toContainText('Thoát bài kiểm tra?');
	await page.getByRole('button', { name: 'Ở lại làm tiếp' }).click();
	await expect(page.getByTestId('part-a-word')).toHaveText(word);
	await page.getByTestId('placement-exit').click();
	await page.getByRole('link', { name: 'Thoát', exact: true }).click();
	await page.waitForURL((url) => url.pathname === '/');

	await expect(page.getByTestId('placement-onboarding')).toHaveCount(0);
	await page.getByRole('link', { name: 'Tiếp tục bài kiểm tra' }).click();
	await expect(page.getByTestId('part-a-word')).toHaveText(word);
	await expect(intro(page)).toHaveCount(0);
});

test('a full run A → B → C reaches the result page with a CEFR badge', async ({ page }) => {
	await login(page, '/placement');
	await page.waitForLoadState('networkidle'); // hydrated: the buttons work
	const a = await answerPartA(page);
	expect(a).toBeGreaterThan(0);
	await beginPart(page, /Phần 2/);
	expect(await answerPartB(page)).toBe(12);
	await beginPart(page, /Phần 3/);

	const textarea = page.getByLabel('Bài viết của bạn (bằng tiếng Anh)');
	await textarea.fill('On Saturday I went to the market with my sister. We bought fish and rice.');
	await expect(page.getByTestId('word-count')).toContainText('15 từ');
	await page.getByRole('button', { name: 'Nộp bài' }).click();

	await page.waitForURL(/\/placement\/result\/\d+$/);
	await expect(page.getByTestId('cefr-badge')).toHaveText(/^(A1|A2|B1|B2|C1)$/);
	await expect(page.getByTestId('writing-status')).toContainText('Bài viết: trình độ');
	await expect(page.getByText('VSTEP')).toBeVisible();
	await expect(page.getByTestId('caveat')).toContainText('không phải điểm thi hay chứng chỉ chính thức');
	await expect(page.getByText('Đây là lần kiểm tra đầu tiên của bạn.')).toBeVisible();
	await page.getByRole('link', { name: 'Về trang Hôm nay' }).click();
	await page.waitForURL((url) => url.pathname === '/');
});

test('after the first result the onboarding card is gone', async ({ page }) => {
	await login(page, '/');
	await expect(page.getByTestId('home-level')).toBeVisible();
	await expect(page.getByTestId('placement-onboarding')).toHaveCount(0);
	await expect(page.getByTestId('placement-resume')).toHaveCount(0);
});

test('a retake from Settings that skips the writing shows the comparison', async ({ page }) => {
	await login(page, '/settings');
	await expect(page.getByTestId('settings-placement')).toContainText('Kết quả gần nhất');
	await page.getByRole('link', { name: 'Làm lại bài kiểm tra' }).click();
	await page.getByRole('button', { name: 'Bắt đầu', exact: true }).click();
	await page.getByRole('button', { name: 'Bắt đầu phần này' }).click();
	await answerPartA(page);
	await beginPart(page, /Phần 2/);
	await answerPartB(page);
	await beginPart(page, /Phần 3/);
	await page.getByRole('button', { name: 'Bỏ qua phần viết' }).click();

	await page.waitForURL(/\/placement\/result\/\d+$/);
	await expect(page.getByTestId('writing-status')).toHaveText('Bạn đã bỏ qua phần viết.');
	await expect(page.getByTestId('previous-result')).toContainText('→');
	await expect(page.getByTestId('previous-result')).toContainText(/Tăng|Giảm|Không đổi/);
});
