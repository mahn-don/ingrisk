import { expect, test } from '@playwright/test';
import { t } from '../lib/messages/vi';

test('home page shows the Vietnamese greeting', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: t.home.greeting })).toBeVisible();
});
