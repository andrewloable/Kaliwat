/**
 * E2E: on phones the tree toolbar fits the screen: the layout choices sit in a "View options" popover and
 * Recenter is always visible. Wide screens keep every button in the toolbar row.
 */
import { test, expect, Page } from '@playwright/test';

async function openTree(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).click();
  await page.getByRole('tab', { name: 'Tree' }).click();
  await expect(page.locator('.card-node').first()).toBeVisible();
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the toolbar fits and Recenter is on screen', async ({ page }) => {
    await openTree(page);
    const fits = await page.locator('.tree-toolbar').evaluate((t) => t.scrollWidth <= t.clientWidth);
    expect(fits).toBe(true);
    const r = (await page.getByRole('button', { name: 'Recenter' }).boundingBox())!;
    expect(r.x + r.width).toBeLessThanOrEqual(390);
    expect(r.height).toBeGreaterThanOrEqual(44);
  });

  test('View options opens the layout choices and closes after one is picked', async ({ page }) => {
    await openTree(page);
    await expect(page.getByRole('button', { name: '↓ Top to bottom' })).toBeHidden();
    await page.locator('.view-options > summary').tap();
    const ttb = page.getByRole('button', { name: '↓ Top to bottom' });
    await expect(ttb).toBeVisible();
    await ttb.tap();
    await expect(page.locator('.view-options')).not.toHaveAttribute('open', '');
    // The popover is closed now, so read the (hidden) button through CSS rather than its role.
    await expect(page.locator('.orient-btn', { hasText: 'Top to bottom' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('Escape and an outside tap close the popover', async ({ page }) => {
    await openTree(page);
    const details = page.locator('.view-options');
    await page.locator('.view-options > summary').tap();
    await expect(details).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(details).not.toHaveAttribute('open', '');
    await page.locator('.view-options > summary').tap();
    await page.mouse.click(200, 600); // the canvas
    await expect(details).not.toHaveAttribute('open', '');
  });
});

test('wide screens show the layout buttons in the toolbar row', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openTree(page);
  for (const name of ['→ Left to right', '↓ Top to bottom', '▦ Compact']) await expect(page.getByRole('button', { name })).toBeVisible();
  await expect(page.locator('.view-options > summary')).toBeHidden();
});
