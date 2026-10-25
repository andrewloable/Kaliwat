/**
 * E2E: the person editor and the Compare dialog behave as modal dialogs from the keyboard:
 * focus moves in, Tab stays inside, Escape closes, and focus returns to what opened them.
 */
import { test, expect, Page } from '@playwright/test';
import * as path from 'path';

const inDialog = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));

test.describe('Modal dialogs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'try a sample tree' }).click();
    await expect(page.locator('.list-row').first()).toBeVisible();
  });

  test('the person editor takes focus, keeps Tab inside, closes on Escape and returns focus', async ({ page }) => {
    // The list draws again once the sample has loaded; wait until a row keeps focus, then open it from the keyboard.
    const row = page.locator('.list-row').first();
    await expect(async () => {
      await row.focus();
      await expect(row).toBeFocused({ timeout: 500 });
    }).toPass();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect.poll(() => inDialog(page)).toBe(true);

    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      expect(await inDialog(page)).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await inDialog(page)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('list-row'))).toBe(true);
  });

  test('Compare closes on Escape and returns focus to its button', async ({ page }) => {
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect.poll(() => inDialog(page)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Compare');
  });

  test('the photo crop takes focus and Escape closes only the crop', async ({ page }) => {
    await page.locator('.list-row').first().click();
    await expect(page.getByRole('dialog', { name: 'Edit person' })).toBeVisible();
    await page.locator('[role=dialog] input[type=file]').first().setInputFiles(path.resolve(__dirname, '../public/og-image.png'));
    const crop = page.locator('.crop-dialog');
    await expect(crop).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.crop-dialog'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(crop).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Edit person' })).toBeVisible();
  });
});
