/**
 * E2E: Family view can run left→right (default) or top→bottom from the toolbar.
 */
import { test, expect } from '@playwright/test';

/** Card position from its SVG transform, e.g. translate(12,34). */
async function pos(card: import('@playwright/test').Locator) {
  const t = (await card.getAttribute('transform')) ?? '';
  const [x, y] = t.match(/-?[\d.]+/g)!.map(Number);
  return { x, y };
}

test('Family view switches between left→right and top→bottom', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[aria-label="Import a GEDCOM file"]', 'public/sample.ged');
  await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Tree' }).click();
  await page.getByRole('button', { name: 'Family' }).click();

  // Orientation buttons only appear in Family mode, and left→right is the default.
  const ltr = page.getByRole('button', { name: '→ Left to right' });
  const ttb = page.getByRole('button', { name: '↓ Top to bottom' });
  await expect(ltr).toHaveAttribute('aria-pressed', 'true');

  const focus = page.locator('.card-node.focus-node');
  const child = page.locator('.card-node').filter({ hasText: 'Ana' }).first();
  await expect(child).toBeVisible();
  const f = await pos(focus);
  const c = await pos(child);
  // In the default view the child sits to the right of the focus person.
  expect(c.x).toBeGreaterThan(f.x);

  await ttb.click();
  await expect(ttb).toHaveAttribute('aria-pressed', 'true');
  const f2 = await pos(focus);
  const c2 = await pos(child);
  // Top→bottom: the child sits below the focus person.
  expect(c2.y).toBeGreaterThan(f2.y);

  // Compact is the third option and keeps the left→right flow.
  const compactBtn = page.getByRole('button', { name: '▦ Compact' });
  await compactBtn.click();
  await expect(compactBtn).toHaveAttribute('aria-pressed', 'true');
  const c3 = await pos(child);
  expect(c3.x).toBeGreaterThan((await pos(focus)).x);
  await ttb.click();

  // The toggle applies to every tree view: Ancestors goes top→bottom too.
  await page.getByRole('button', { name: 'Ancestors' }).click();
  await expect(ttb).toHaveAttribute('aria-pressed', 'true');
  await expect(ltr).toBeVisible();
});
