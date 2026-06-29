import { test, expect } from '@playwright/test';

test('app loads and shows the top bar wordmark', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.wordmark')).toContainText('Kaliwat');
});
