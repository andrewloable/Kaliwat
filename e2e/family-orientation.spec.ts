/**
 * E2E: the Full tree can run left→right (default), top→bottom, or Compact from the toolbar.
 */
import { test, expect } from '@playwright/test';

/** Card position from its SVG transform, e.g. translate(12,34). */
async function pos(card: import('@playwright/test').Locator) {
  const t = (await card.getAttribute('transform')) ?? '';
  const [x, y] = t.match(/-?[\d.]+/g)!.map(Number);
  return { x, y };
}

test('Full tree switches between left→right, top→bottom and compact', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[aria-label="Import a GEDCOM file"]', 'public/sample.ged');
  await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Tree' }).click();

  // Focus on Maria so her child Ana is in view.
  await page.getByRole('searchbox', { name: 'Search people' }).fill('Maria Santos');
  await page.locator('.tsr-item').first().click();
  await page.getByRole('searchbox', { name: 'Search people' }).fill('');

  // Left→right is the default.
  const ltr = page.getByRole('button', { name: '→ Left to right' });
  const ttb = page.getByRole('button', { name: '↓ Top to bottom' });
  const compact = page.getByRole('button', { name: '▦ Compact' });
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

  // Compact runs top to bottom for the first generations, so the child is still below.
  await compact.click();
  await expect(compact).toHaveAttribute('aria-pressed', 'true');
  const c3 = await pos(child);
  expect(c3.y).toBeGreaterThan((await pos(focus)).y);
});
