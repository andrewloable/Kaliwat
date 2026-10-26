/**
 * E2E: the Tree view draws everyone by default; picking a person only moves the highlight.
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';

const SAMPLE_GDZ = path.resolve(__dirname, '../test/fixtures/sample-anon.gdz');

test('everyone is drawn, whoever is selected', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[aria-label="Import a GEDCOM file"]', SAMPLE_GDZ);
  await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('tab', { name: 'Tree' }).click();

  const cards = page.locator('.tree-svg .card-node');
  await expect(page.getByRole('button', { name: 'Everyone' })).toHaveAttribute('aria-pressed', 'true');
  await expect(cards).toHaveCount(1771, { timeout: 30_000 });
  await expect(page.locator('.card-node.focus-node')).toHaveCount(1);
  const before = await page.locator('.card-node.focus-node').getAttribute('aria-label');

  // Choosing another card moves the highlight and keeps everyone on the page.
  const other = cards.nth(5);
  const name = await other.getAttribute('aria-label');
  expect(name).not.toBe(before);
  await other.dispatchEvent('click'); // it may sit outside the viewport; the click handler is what matters
  await expect(page.locator('.card-node.focus-node')).toHaveAttribute('aria-label', name!);
  await expect(cards).toHaveCount(1771);
  await expect(page.locator('.focus-name-bar strong')).toHaveText(name!);

  // One person's line draws only their ancestors and descendants; Everyone brings the rest back.
  await page.getByRole('button', { name: "One person's line" }).click();
  await expect.poll(() => cards.count()).toBeLessThan(1771);
  await page.getByRole('button', { name: 'Everyone' }).click();
  await expect(cards).toHaveCount(1771);
});
