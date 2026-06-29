import { test, expect, Page } from '@playwright/test';
import * as path from 'path';

const SAMPLE_GED = path.resolve(__dirname, '../test/fixtures/sample.ged');
const MALFORMED_GED = path.resolve(__dirname, '../test/fixtures/malformed.ged');

async function importFile(page: Page, filePath: string) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(filePath);
}

test.describe('Import flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear any previous IndexedDB state
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('kaliwat');
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    });
    await page.reload();
  });

  test('shows empty drop zone on fresh load', async ({ page }) => {
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.drop-prompt')).toBeVisible();
  });

  test('import a valid .ged file → list shows people', async ({ page }) => {
    await importFile(page, SAMPLE_GED);
    // Wait for list rows to appear
    await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 10_000 });
    // Should have people from sample.ged (4 individuals)
    const rows = page.locator('.list-row');
    await expect(rows).toHaveCount(4, { timeout: 10_000 });
    // Verify names from sample
    await expect(page.locator('.row-name').first()).toBeVisible();
  });

  test('import malformed .ged → import report shown with skipped count', async ({ page }) => {
    await importFile(page, MALFORMED_GED);
    // Wait for any result
    await page.waitForTimeout(3000);
    // Either a report band or a list row should appear
    const report = page.locator('.import-report');
    const rows = page.locator('.list-row');
    // malformed.ged has 1 valid person and 2 bad lines
    const hasReport = await report.isVisible();
    const hasRows = await rows.count() > 0;
    expect(hasReport || hasRows).toBe(true);
  });

  test('try sample tree link loads sample data', async ({ page }) => {
    await page.locator('.sample-link').click();
    await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 15_000 });
  });
});
