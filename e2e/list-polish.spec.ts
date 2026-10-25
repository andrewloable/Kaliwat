/**
 * E2E: list rows: no lone dash for people without years, the + button never covers the last row,
 * and rows behave as buttons (Space opens the editor).
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';

test('people without years show no dash; years read naturally to screen readers', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.locator('input[aria-label="Import a GEDCOM file"]').setInputFiles(path.resolve(__dirname, '../test/fixtures/sample-anon.gdz'));
  const first = page.locator('.list-row').first(); // Aaron Adams: no birth or death year in the sample
  await expect(first).toBeVisible({ timeout: 60_000 });
  await expect(first.locator('.row-years')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search people' }).fill('Xavier Baker');
  const baker = page.locator('.list-row').first();
  await expect(baker.locator('.row-years')).toHaveAttribute('aria-label', 'Born 1919, died 1984');
});

test('the + button does not cover the last row', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/');
  await page.locator('input[aria-label="Import a GEDCOM file"]').setInputFiles(path.resolve(__dirname, '../test/fixtures/sample-anon.gdz'));
  await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 60_000 });
  await page.locator('.scroll-viewport').evaluate((v) => (v.scrollTop = v.scrollHeight));
  await page.waitForTimeout(200);
  const last = (await page.locator('.list-row').last().boundingBox())!;
  const fab = (await page.locator('.add-person-btn').boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(fab.y);
});

test('rows are buttons and Space opens the editor', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).click();
  const row = page.locator('.list-row').first();
  await expect(row).toHaveAttribute('role', 'button');
  await expect(async () => { await row.focus(); await expect(row).toBeFocused({ timeout: 500 }); }).toPass();
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog')).toBeVisible();
});
