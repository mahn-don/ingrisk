import { expect, test } from '@playwright/test';

test('without APP_PASSWORD_HASH nothing is reachable', async ({ page, request }) => {
	for (const path of ['/', '/stats', '/settings', '/session']) {
		const response = await request.get(path, { maxRedirects: 0 });
		expect(response.status(), path).toBe(303);
		expect(response.headers().location).toBe('/login');
	}
	expect((await request.get('/api/anything')).status()).toBe(503);
	// The health check stays reachable: the server and its database are fine.
	expect(await (await request.get('/healthz')).json()).toMatchObject({ ok: true, db: 'ok' });
	await page.goto('/');
	await expect(page).toHaveURL('/login');
	await expect(page.getByRole('alert')).toContainText('Ứng dụng chưa được thiết lập');
	await expect(page.getByLabel('Mật khẩu')).toHaveCount(0);
	// Plain HTTP to a non-local origin: a small, non-blocking notice.
	await expect(page.getByTestId('insecure-notice')).toContainText('Kết nối không mã hóa');
	const post = await request.post('/login', { form: { password: 'anything' }, headers: { origin: page.url().replace(/\/login$/, '') } });
	expect(post.status()).toBe(503);
});
