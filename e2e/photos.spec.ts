import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import JSZip from 'jszip';

// A 1x1 PNG served for the "web link" photos; the routes below answer them inside the browser (no real network).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const WORKS = 'https://photos.kaliwat.test/works.png';
const EXPIRED = 'https://photos.kaliwat.test/expired.jpg';

const GED = [
  '0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
  '0 @I1@ INDI', '1 NAME Lina /Cruz/', '1 SEX F', '1 OBJE', '2 FORM png', `2 FILE ${WORKS}`,
  '0 @I2@ INDI', '1 NAME Tomas /Cruz/', '1 SEX M', '1 OBJE', '2 FORM jpg', `2 FILE ${EXPIRED}`,
  '0 TRLR',
].join('\n');

async function mediaBlobCount(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((res) => {
    const r = indexedDB.open('kaliwat');
    r.onsuccess = () => {
      const q = r.result.transaction('mediaBlobs').objectStore('mediaBlobs').count();
      q.onsuccess = () => { res(q.result); r.result.close(); };
    };
  }));
}

test('linked photos are downloaded after import, and the export carries the images instead of the links', async ({ page }) => {
  await page.route('https://photos.kaliwat.test/**', (route) => route.request().url() === WORKS
    ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: { 'access-control-allow-origin': '*' } })
    : route.fulfill({ status: 403, body: 'expired', headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/');
  // Every text the footer shows, to see the download progress.
  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as { footer: string[] }).footer = []);
    new MutationObserver(() => {
      const t = document.querySelector('.photo-status')?.textContent?.trim();
      if (t && seen[seen.length - 1] !== t) seen.push(t);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  const ged = test.info().outputPath('links.ged');
  fs.writeFileSync(ged, GED);
  await page.locator('input[aria-label="Import a GEDCOM file"]').setInputFiles(ged);
  await expect(page.locator('.list-row')).toHaveCount(2);

  await expect.poll(() => mediaBlobCount(page)).toBe(1);
  await expect(page.locator('.photo-status')).toHaveText('1 photo not downloaded');
  const footer = await page.evaluate(() => (window as unknown as { footer: string[] }).footer);
  expect(footer.some((t) => /^Saving photos \d\/2$/.test(t))).toBe(true);
  await expect(page.locator('.list-row', { hasText: 'Lina Cruz' }).locator('img.avatar')).toBeVisible();

  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Family tree file/ }).click()]);
  expect(download.suggestedFilename()).toBe('family-tree.gdz');
  const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
  const text = await zip.file('gedcom.ged')!.async('string');
  const images = Object.keys(zip.files).filter((p) => p.startsWith('media/') && !zip.files[p].dir);
  expect(images).toHaveLength(1);
  expect(text).toContain(`2 FILE ${images[0]}`);
  expect(text).not.toContain(WORKS);
  expect(text).toContain(EXPIRED); // a link that cannot be downloaded is all there is to keep
});
