import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';

const CURRENT = path.resolve(__dirname, '../test/fixtures/merge-current.ged');
const INCOMING = path.resolve(__dirname, '../test/fixtures/merge-incoming.ged');

async function clearDb(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('kaliwat');
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    });
    if (!db) return;
    const stores = [...db.objectStoreNames];
    if (stores.length) {
      const tx = db.transaction(stores, 'readwrite');
      await Promise.all(stores.map((s) => new Promise<void>((res) => { tx.objectStore(s).clear().onsuccess = () => res(); })));
    }
    db.close();
  });
  await page.reload();
}

async function openTree(page: Page) {
  await page.locator('input[aria-label="Import a GEDCOM file"]').setInputFiles(CURRENT);
  await expect(page.locator('.list-row')).toHaveCount(6, { timeout: 10_000 });
}

const mergeButton = (page: Page) => page.locator('.top-bar').getByRole('button', { name: 'Merge', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: /^Merge .* into this tree$/ });

/** Picks a file through the Merge button (as a person would), so focus starts on the button. */
async function startMerge(page: Page, file: string) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), mergeButton(page).click()]);
  await chooser.setFiles(file);
  await expect(dialog(page).locator('.summary, .hint').first()).toBeVisible({ timeout: 10_000 });
}

async function mediaBlobCount(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((res) => {
    const r = indexedDB.open('kaliwat');
    r.onsuccess = () => {
      const q = r.result.transaction('mediaBlobs').objectStore('mediaBlobs').count();
      q.onsuccess = () => { res(q.result); r.result.close(); };
    };
  }));
}

test.describe('Merge a file into the tree', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearDb(page);
  });

  test('Merge appears only with a tree', async ({ page }) => {
    await expect(mergeButton(page)).toHaveCount(0);
    await openTree(page);
    await expect(mergeButton(page)).toBeVisible();
  });

  test('the preview lists additions and differences', async ({ page }) => {
    await openTree(page);
    await startMerge(page, INCOMING);
    await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText('Merge merge-incoming.ged into this tree');
    const summary = dialog(page).locator('.summary');
    await expect(summary).toContainText('2 new people');
    await expect(summary).toContainText('1 new family');
    await expect(summary).toContainText('3 differences to choose');
  });

  test("Incoming for Juan's birth is applied and persists", async ({ page }) => {
    await openTree(page);
    await startMerge(page, INCOMING);
    await dialog(page).getByRole('group', { name: 'Birth' }).getByRole('radio').nth(1).check();
    await dialog(page).getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(dialog(page).locator('.status')).toHaveText(/^Added 2 people/);
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.list-row')).toHaveCount(8);
    await expect(page.locator('.list-row', { hasText: 'Rosa Santos' })).toBeVisible();
    await expect(page.locator('.list-row', { hasText: 'Ramon Uy' })).toBeVisible();

    await page.locator('.list-row', { hasText: 'Juan Santos' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit person' });
    await expect(editor).toBeVisible();
    await expect(editor.locator('input[name="birthDate"]')).toHaveValue('2 JAN 1950');

    await page.reload();
    await expect(page.locator('.list-row', { hasText: 'Rosa Santos' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.list-row')).toHaveCount(8);
  });

  test('Cancel changes nothing', async ({ page }) => {
    await openTree(page);
    await startMerge(page, INCOMING);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.list-row')).toHaveCount(6);
    await expect(page.locator('.list-row', { hasText: 'Rosa Santos' })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.list-row')).toHaveCount(6, { timeout: 10_000 });
  });

  test('Escape closes and gives focus back', async ({ page }) => {
    await openTree(page);
    await startMerge(page, INCOMING);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(mergeButton(page)).toBeFocused();
  });

  test('a .gdz adds its photo', async ({ page }) => {
    const zip = new JSZip();
    zip.file('gedcom.ged', fs.readFileSync(INCOMING, 'utf8'));
    zip.file('media/rosa.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    const gdz = test.info().outputPath('incoming.gdz');
    fs.writeFileSync(gdz, await zip.generateAsync({ type: 'nodebuffer' }));

    await openTree(page);
    const before = await mediaBlobCount(page);
    // Every text the status line shows while the archive is read: the photos have their own progress.
    await page.evaluate(() => {
      const seen: string[] = ((window as unknown as { statuses: string[] }).statuses = []);
      new MutationObserver(() => {
        const t = document.querySelector('[role=dialog] .status')?.textContent?.trim();
        if (t && seen[seen.length - 1] !== t) seen.push(t);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await startMerge(page, gdz);
    const statuses = await page.evaluate(() => (window as unknown as { statuses: string[] }).statuses);
    expect(statuses).toContain('Preparing photos: 1 of 1…');
    // Rosa's photo, and Maria's changed profile picture (added even when her current one is kept).
    await expect(dialog(page).locator('.summary')).toContainText('2 new photos');
    await dialog(page).getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(dialog(page).locator('.status')).toHaveText(/^Added 2 people, 1 family and 2 photos\./);
    expect(await mediaBlobCount(page)).toBe(before + 1);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('the bar and the dialog fit', async ({ page }) => {
      await openTree(page);
      const bar = await page.locator('header').evaluate((e) => e.getBoundingClientRect().height);
      expect(Math.round(bar)).toBe(56);
      const box = (await mergeButton(page).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      // The extra button must not push the bar off screen on small phones, landscape phones or small tablets.
      for (const width of [320, 360, 600, 840, 841, 1024, 390]) {
        await page.setViewportSize({ width, height: 844 });
        // Compared with the width itself: on a mobile viewport the layout viewport grows to fit overflowing content.
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `no sideways scroll at ${width}px`).toBeLessThanOrEqual(width);
      }

      await startMerge(page, INCOMING);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      const panel = (await dialog(page).boundingBox())!;
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(390);
    });
  });

  test.describe('on a 320px phone', () => {
    test.use({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });

    test('Compare and Merge move into the More menu', async ({ page }) => {
      await openTree(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      const bar = page.locator('.top-bar');
      await expect(bar.getByRole('button', { name: 'Compare', exact: true })).toBeHidden();
      await expect(mergeButton(page)).toBeHidden();

      const more = bar.getByRole('button', { name: 'More actions' });
      await more.tap();
      const menu = page.getByRole('menu', { name: 'More actions' });
      await expect(menu.getByRole('menuitem')).toHaveText(['Compare', 'Merge…']);
      await expect(menu.getByRole('menuitem', { name: 'Compare' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(more).toBeFocused();

      await more.tap();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menu.getByRole('menuitem', { name: 'Merge…' }).tap()]);
      await chooser.setFiles(INCOMING);
      await expect(dialog(page).locator('.summary')).toContainText('2 new people');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
      await page.keyboard.press('Escape');
      await expect(more).toBeFocused();
    });
  });
});
