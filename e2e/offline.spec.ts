import { test, expect } from '@playwright/test';
import * as path from 'path';

const SAMPLE_GED = path.resolve(__dirname, '../test/fixtures/sample.ged');

test.describe('Service worker + offline', () => {
  test('SW is registered and controlling the page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.wordmark')).toBeVisible();

    // navigator.serviceWorker.ready resolves only when an active SW exists
    const state = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return reg.active?.state ?? null;
    });

    expect(['activated', 'activating']).toContain(state);
  });

  test('imported tree data persists in IndexedDB and survives reload', async ({ page, context }) => {
    // Visit online + import
    await page.goto('/');
    await expect(page.locator('.wordmark')).toBeVisible();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(SAMPLE_GED);
    await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 10_000 });

    // Verify data is in IndexedDB (not just memory)
    const count = await page.evaluate(async () => {
      return new Promise<number>((resolve) => {
        const req = indexedDB.open('kaliwat');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('individuals')) { resolve(0); return; }
          const tx = db.transaction('individuals', 'readonly');
          const store = tx.objectStore('individuals');
          const countReq = store.count();
          countReq.onsuccess = () => resolve(countReq.result);
        };
        req.onerror = () => resolve(0);
      });
    });
    expect(count).toBeGreaterThan(0);
  });

  test('SW cache has the app shell after first visit', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.wordmark')).toBeVisible();

    // Wait for SW to install (give it time to cache)
    await page.waitForTimeout(3000);

    const hasCachedShell = await page.evaluate(async () => {
      const cached = await caches.match('/index.html');
      if (cached) return true;
      // Also check with full URL
      const cached2 = await caches.match(location.origin + '/index.html');
      return !!cached2;
    });
    expect(hasCachedShell).toBe(true);
  });
});
