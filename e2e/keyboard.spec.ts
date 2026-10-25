/**
 * E2E: keyboard paths through small overlays: Escape closes the Export menu from anywhere, and the
 * tree's jump-to-person results are reachable with the arrow keys.
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).click();
  await expect(page.locator('.list-row').first()).toBeVisible();
});

test('Escape closes the Export menu and returns focus to the Export button', async ({ page }) => {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const menu = page.getByRole('group', { name: 'Export options' });
  await expect(menu).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[aria-label="Export options"]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeFocused();
});

test('arrow keys move from the search field into the tree results, Enter picks one', async ({ page }) => {
  await page.getByRole('tab', { name: 'Tree' }).click();
  await expect(page.locator('.card-node').first()).toBeVisible();
  const field = page.getByRole('searchbox', { name: 'Search people' });
  await field.fill('Reyes');
  await expect(page.locator('.tsr-item')).toHaveCount(3);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tsr-item').nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.tsr-item').nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp'); // wraps to the last
  await expect(page.locator('.tsr-item').nth(2)).toBeFocused();
  const name = (await page.locator('.tsr-item').nth(2).locator('.tsr-name').textContent())!.trim();
  await page.keyboard.press('Enter');
  await expect(page.locator('.card-node.focus-node')).toHaveAttribute('aria-label', name);
});

test('Escape in the results clears the search and returns to the field', async ({ page }) => {
  await page.getByRole('tab', { name: 'Tree' }).click();
  const field = page.getByRole('searchbox', { name: 'Search people' });
  await field.fill('Reyes');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tsr-item')).toHaveCount(0);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('');
});
