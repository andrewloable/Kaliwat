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

test('with a fully connected tree the footer still offers the check', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).click();
  const check = page.locator('footer').getByRole('button', { name: 'All connected' });
  await expect(check).toBeVisible();
  await check.click();
  const review = page.getByRole('dialog', { name: 'Everyone is connected' });
  await expect(review).toContainText('Every person is linked to the main tree.');
  await expect(review).not.toContainText('Not connected');
  await expect(review).toContainText('Checked 4 people at');
  await review.getByRole('button', { name: 'Scan again' }).click();
  await expect(review).toContainText('Checked 4 people at'); // still open, freshly checked
});
