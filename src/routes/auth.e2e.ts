import { expect, test } from '@playwright/test';
import { E2E_CRON_SECRET, E2E_PASSWORD, SERVERS, expireSession, login } from '../../test/e2e/support.ts';

test.describe('the hooks chokepoint', () => {
	for (const path of ['/', '/stats', '/settings', '/session']) {
		test(`unauthenticated ${path} redirects to /login?next=…`, async ({ request }) => {
			const response = await request.get(path, { maxRedirects: 0 });
			expect(response.status()).toBe(303);
			expect(response.headers().location).toBe(`/login?next=${encodeURIComponent(path)}`);
		});
	}

	test('unauthenticated /api/* answers 401 JSON', async ({ request }) => {
		const response = await request.get('/api/anything', { maxRedirects: 0 });
		expect(response.status()).toBe(401);
		expect(await response.json()).toEqual({ error: 'unauthorized' });
	});

	test('/healthz is public and says only ok/db/migrations; nothing else opened up', async ({ request }) => {
		const response = await request.get('/healthz', { maxRedirects: 0 });
		expect(response.status()).toBe(200);
		expect(response.headers()['set-cookie']).toBeUndefined();
		const body = await response.json();
		expect(Object.keys(body).sort()).toEqual(['db', 'migrations', 'ok']);
		expect(body).toMatchObject({ ok: true, db: 'ok' });
		expect(body.migrations).toBeGreaterThan(0);
		for (const path of ['/healthz/x', '/review', '/settings/providers']) {
			expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(303);
		}
		for (const path of ['/api/backup', '/api/healthz', '/api/session/start']) {
			expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(401);
		}
	});

	test('/api/cron/prefetch is governed by its own secret, not by a session', async ({ request }) => {
		const headers = { 'content-type': 'application/json' };
		const wrong = await request.post('/api/cron/prefetch', { headers: { ...headers, authorization: 'Bearer nope' }, data: {} });
		expect(wrong.status()).toBe(401);
		const right = await request.post('/api/cron/prefetch', { headers: { ...headers, authorization: `Bearer ${E2E_CRON_SECRET}` }, data: { maxCalls: 1 } });
		expect(right.status()).toBe(200);
		expect(await right.json()).toHaveProperty('shortfall');
	});
});

test.describe('login and logout', () => {
	test('a wrong password shows an error', async ({ page }) => {
		await page.goto('/login');
		await expect(page.getByTestId('insecure-notice')).toHaveCount(0); // localhost: no notice
		await page.getByLabel('Mật khẩu').fill('not-the-password');
		await page.getByRole('button', { name: 'Đăng nhập' }).click();
		await expect(page.getByRole('alert')).toContainText('Mật khẩu chưa đúng');
		await expect(page).toHaveURL(/\/login/);
	});

	test('the right password lands on next, and Home shows real counts', async ({ page }) => {
		await page.goto('/stats');
		await expect(page).toHaveURL('/login?next=%2Fstats');
		await login(page, '/stats');
		await expect(page).toHaveURL('/stats');
		await expect(page.getByRole('heading', { name: 'Tiến độ', level: 1 })).toBeVisible();
		await page.getByRole('link', { name: 'Hôm nay' }).click();
		await expect(page.getByTestId('count-due')).toHaveText('0');
		// No provider on this server: Home says why Viết and grading are unavailable.
		await expect(page.getByTestId('no-provider')).toContainText('Chưa có nhà cung cấp AI');
		await expect(page.getByTestId('count-new')).toHaveText('0');
		await expect(page.getByRole('link', { name: 'Bắt đầu học' })).toHaveAttribute('href', '/session?budget=8&shape=quick');
	});

	test('a hostile next falls back to /', async ({ page }) => {
		await page.goto('/login?next=//evil.com');
		await page.getByLabel('Mật khẩu').fill(E2E_PASSWORD);
		await page.getByRole('button', { name: 'Đăng nhập' }).click();
		await expect(page).toHaveURL('/');
	});

	test('logout ends the session', async ({ page, request }) => {
		await login(page, '/settings');
		await page.getByRole('button', { name: 'Đăng xuất' }).click();
		await expect(page).toHaveURL('/login');
		await page.goto('/');
		await expect(page).toHaveURL('/login?next=%2F');
		expect((await request.get('/api/anything')).status()).toBe(401);
	});

	test('an expired session redirects to login', async ({ page, context }) => {
		await login(page);
		const cookie = (await context.cookies()).find((c) => c.name === 'se_session');
		expect(cookie?.httpOnly).toBe(true);
		expect(cookie?.sameSite).toBe('Lax');
		expect(expireSession(SERVERS.main.db, cookie!.value)).toBe(1);
		await page.goto('/settings');
		await expect(page).toHaveURL('/login?next=%2Fsettings');
	});
});

test.describe('shell', () => {
	test('session is full screen, with an exit and no tab bar; without content it says so', async ({ page }) => {
		await login(page, '/session');
		await expect(page.getByRole('navigation')).toHaveCount(0);
		await expect(page.getByTestId('session-empty')).toContainText('Chưa có nội dung để học');
		await page.getByRole('link', { name: 'Thoát buổi học' }).click();
		await expect(page).toHaveURL('/');
		await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible();
	});

	test('the theme choice is stored and rendered on the first paint', async ({ page }) => {
		await login(page, '/settings');
		await page.getByRole('button', { name: 'Tối' }).click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		const response = await page.request.get('/settings');
		expect(await response.text()).toContain('<html lang="vi" data-theme="dark">');
		await page.getByRole('button', { name: 'Theo máy' }).click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
	});

	test('/dev/components does not exist in production builds', async ({ page }) => {
		await login(page);
		const response = await page.goto('/dev/components');
		expect(response?.status()).toBe(404);
	});
});
