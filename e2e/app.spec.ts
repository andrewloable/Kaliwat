import { test, expect } from '@playwright/test';

test('app loads and shows the top bar wordmark', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.wordmark')).toContainText('Kaliwat');
});

test('footer shows the app version without adding a page scrollbar', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-footer')).toHaveText(/^Kaliwat v\d+\.\d+\.\d+$/);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});
