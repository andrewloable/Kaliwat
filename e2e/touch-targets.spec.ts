/**
 * E2E: touch targets are at least 44px on a phone (DESIGN.md accessibility baseline).
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('the "try a sample tree" link is at least 44px tall', async ({ page }) => {
  await page.goto('/');
  const box = await page.getByRole('button', { name: 'try a sample tree' }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test('every button in the person editor is at least 44px tall', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).tap();
  await page.locator('.list-row').first().tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('[role=dialog] details').evaluateAll((ds) => ds.forEach((d) => ((d as HTMLDetailsElement).open = true)));
  const small = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')]
    .map((b) => ({ name: b.textContent!.trim().slice(0, 24), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width }))
    .filter((b) => b.w > 0 && b.h < 44));
  expect(small).toEqual([]);
});

test('the tree card edit button has a 44px target', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).tap();
  await page.getByRole('tab', { name: 'Tree' }).tap();
  const box = await page.locator('.card-edit').first().boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test('every button in the quick-add form is at least 44px tall', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).tap();
  await page.locator('.list-row').first().tap();
  await page.getByRole('button', { name: '+ Parent' }).tap();
  await expect(page.getByRole('heading', { name: /^Add parent of / })).toBeVisible();
  const small = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button, [role=dialog] label.rel-btn')]
    .map((b) => ({ name: b.textContent!.trim().slice(0, 24), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width }))
    .filter((b) => b.w > 0 && b.h < 44));
  expect(small).toEqual([]);
});

test('the buttons in the import and orphan notices are at least 44px tall', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.locator('input[aria-label="Import a GEDCOM file"]').setInputFiles(path.resolve(__dirname, '../test/fixtures/sample-anon.gdz'));
  await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.import-report')).toBeVisible();
  const small = await page.evaluate(() => [...document.querySelectorAll('.import-report button, app-orphans button')]
    .map((b) => ({ name: b.textContent!.trim(), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width }))
    .filter((b) => b.w > 0 && b.h < 44));
  expect(small).toEqual([]);
});
