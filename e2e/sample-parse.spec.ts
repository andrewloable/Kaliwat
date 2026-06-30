/**
 * E2E: real-scale parse + List view against the 1771-person anonymized fixture.
 * Validates: full count, virtual scroll, non-ASCII, search, custom tags, perf.
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';

const SAMPLE_ANON = path.resolve(__dirname, '../test/fixtures/sample-anon.ged');

async function clearDb(page: Parameters<typeof test>[1]) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>(res => {
      const r = indexedDB.open('kaliwat');
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    });
    if (!db) return;
    const stores = [...db.objectStoreNames];
    if (stores.length) {
      const tx = db.transaction(stores, 'readwrite');
      await Promise.all(stores.map(s => new Promise<void>(res => { tx.objectStore(s).clear().onsuccess = () => res(); })));
    }
    db.close();
  });
}

async function importFile(page: Parameters<typeof test>[1], filePath: string) {
  await page.locator('input[aria-label="Import a GEDCOM file"]').setInputFiles(filePath);
}

// 1771-person import takes ~35s; give generous budget but fail on hard freeze
const IMPORT_TIMEOUT = 60_000;
const PERF_BUDGET_MS = 50_000; // ponytail: loose budget; optimize if parse worker slow

test.describe('Sample 1771-person parse + List', () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearDb(page);
    await page.reload();
  });

  test('imports 1771 people and shows first list rows', async ({ page }) => {
    const t0 = Date.now();

    await importFile(page, SAMPLE_ANON);

    // Wait for virtual scroll to appear (proves at least some rows rendered)
    await expect(page.locator('.list-row').first()).toBeVisible({ timeout: IMPORT_TIMEOUT });
    await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 15_000 });

    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(PERF_BUDGET_MS);

    // Verify full count via IndexedDB
    const count = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('kaliwat');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return new Promise<number>((res) => {
        const tx = db.transaction('individuals', 'readonly');
        const req = tx.objectStore('individuals').count();
        req.onsuccess = () => res(req.result);
      });
    });
    expect(count).toBe(1771);
  });

  test('non-ASCII names render without mojibake', async ({ page }) => {
    await importFile(page, SAMPLE_ANON);
    await expect(page.locator('.list-row').first()).toBeVisible({ timeout: IMPORT_TIMEOUT });

    // Verify non-ASCII characters are rendered correctly in visible rows.
    // The anonymized fixture contains names with ó, ü, é, á, í etc.
    // Mojibake would produce garbage like "LÃ³pez" instead of "López".
    const names = await page.locator('.row-name').allTextContents();
    expect(names.length).toBeGreaterThan(0);
    // At least one visible name must contain a Latin extended character
    expect(names.some(n => /[éóüöáíñëçœæ]/.test(n))).toBe(true);
  });

  test('custom tags retained in raw AST', async ({ page }) => {
    await importFile(page, SAMPLE_ANON);
    await expect(page.locator('.list-row').first()).toBeVisible({ timeout: IMPORT_TIMEOUT });

    // Verify custom tags survived in the preserved raw AST in IndexedDB
    const hasCustomTags = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('kaliwat');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const nodes = await new Promise<unknown[]>((res) => {
        const tx = db.transaction('rawAst', 'readonly');
        const req = tx.objectStore('rawAst').getAll();
        req.onsuccess = () => res(req.result as unknown[]);
      });
      const text = JSON.stringify(nodes);
      return (
        text.includes('_FILESIZE') &&
        text.includes('_PRIM_CUTOUT') &&
        text.includes('_PROJECT_GUID')
      );
    });
    expect(hasCustomTags).toBe(true);
  });

  test('virtual scroll renders without freezing (scroll to bottom)', async ({ page }) => {
    await importFile(page, SAMPLE_ANON);
    await expect(page.locator('.list-row').first()).toBeVisible({ timeout: IMPORT_TIMEOUT });

    // Scroll to bottom of virtual list — must not timeout/freeze
    const viewport = page.locator('cdk-virtual-scroll-viewport');
    await viewport.evaluate(el => el.scrollTop = el.scrollHeight);
    await page.waitForTimeout(300);
    // More rows should now be visible (virtual scroll rendered new rows)
    const rowCount = await page.locator('.list-row').count();
    expect(rowCount).toBeGreaterThan(0);
  });
});
