/**
 * E2E: on phones the top-bar search is a 44px button that opens a full-width search over the bar.
 */
import { test, expect } from '@playwright/test';

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the search button opens a full-width field, Escape closes it and keeps the query', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'try a sample tree' }).tap();
    await expect(page.locator('.list-row')).toHaveCount(4);
    const toggle = page.locator('.search-toggle');
    const field = page.getByRole('searchbox', { name: 'Search people' });
    await expect(toggle).toBeVisible();
    const tb = (await toggle.boundingBox())!;
    expect(tb.width).toBeGreaterThanOrEqual(44);
    expect(tb.height).toBeGreaterThanOrEqual(44);
    await expect(field).toBeHidden();

    await toggle.tap();
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    expect((await field.boundingBox())!.width).toBeGreaterThanOrEqual(280);
    await field.fill('Maria');
    await expect(page.locator('.list-row')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(field).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(page.locator('.list-row')).toHaveCount(1); // the query is kept
  });

  test('picking a tree result closes the search over the bar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'try a sample tree' }).tap();
    await page.getByRole('tab', { name: 'Tree' }).tap();
    await expect(page.locator('.card-node').first()).toBeVisible();
    await page.locator('.search-toggle').tap();
    await page.getByRole('searchbox', { name: 'Search people' }).fill('Mar');
    await page.locator('.tsr-item').first().tap();
    await expect(page.locator('.search-slot.open')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'List' })).toBeVisible();
  });

  test('the header stays 56px and the page does not scroll sideways', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'try a sample tree' }).tap();
    await page.locator('.search-toggle').tap();
    const h = await page.locator('header').evaluate((e) => e.getBoundingClientRect().height);
    expect(Math.round(h)).toBe(56);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test('desktop keeps the full search field and no search button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('searchbox', { name: 'Search people' })).toBeVisible();
  await expect(page.locator('.search-toggle')).toBeHidden();
});
