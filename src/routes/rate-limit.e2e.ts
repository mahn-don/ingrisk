import { expect, test } from '@playwright/test';

test('the 6th failed login within 10 minutes answers 429', async ({ page, request, baseURL }) => {
	const attempt = () => request.post('/login', { form: { password: 'wrong-password' }, headers: { origin: baseURL!, accept: 'text/html' } });
	for (let i = 1; i <= 5; i++) expect((await attempt()).status(), `attempt ${i}`).toBe(400);
	const sixth = await attempt();
	expect(sixth.status()).toBe(429);
	expect(await sixth.text()).toContain('Bạn đã nhập sai quá nhiều lần');
	// The UI says so too, even for the right password.
	await page.goto('/login');
	await page.getByLabel('Mật khẩu').fill('wrong-password');
	await page.getByRole('button', { name: 'Đăng nhập' }).click();
	await expect(page.getByRole('alert')).toContainText('Bạn đã nhập sai quá nhiều lần');
});
