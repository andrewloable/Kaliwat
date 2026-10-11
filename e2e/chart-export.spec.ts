import { test, expect, Page, Download } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Prefer the real MyHeritage sample (~1771 people with CDN photos) — importing
// it caches avatar blobs, and PDF export embeds them, which is the path that
// surfaced the blob: CSP error. It's gitignored, so fall back to the committed
// 4-person sample on CI / fresh clones (the export + CSP assertions still hold).
const BIG = path.resolve(__dirname, '../sample/family-tree.ged');
const SAMPLE_GED = fs.existsSync(BIG) ? BIG : path.resolve(__dirname, '../public/sample.ged');
const SMALL_GED = path.resolve(__dirname, '../public/sample.ged');

async function exportChart(page: Page, item: RegExp): Promise<Download> {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('group', { name: 'Export options' }).getByRole('button', { name: item }).click(),
  ]);
  return download;
}

async function bytes(download: Download): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Pixel size from a JPEG's SOF marker. */
function jpegSize(buf: Buffer): { w: number; h: number } {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('no SOF marker');
}

test('import the sample tree and export it to PDF', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');

  // Import via the top-bar's hidden file picker.
  await page.setInputFiles('input[aria-label="Import a GEDCOM file"]', SAMPLE_GED);

  // Import is done once people show up in the list.
  await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 60_000 });

  // Switch to the tree and wait for it to render.
  await page.getByRole('tab', { name: 'Tree' }).click();
  await expect(page.locator('.tree-svg .card-node').first()).toBeVisible({ timeout: 30_000 });
  // Give lazy avatar blobs a moment to resolve so the export embeds them.
  await page.waitForTimeout(2000);

  // Export from the top bar's Export menu and capture the download.
  const download = await exportChart(page, /^PDF/);
  expect(download.suggestedFilename()).toBe('family-tree.pdf');
  const pdf = await bytes(download);

  // A real, non-trivial PDF.
  expect(pdf.length).toBeGreaterThan(1000);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

  // The CSP / blob regression must not reappear.
  const csp = errors.filter((e) => /Content Security Policy|violates|blob:/i.test(e));
  expect(csp, `unexpected console errors:\n${csp.join('\n')}`).toHaveLength(0);
});

test('chart exports as a self-contained SVG and a high-resolution JPG', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('input[aria-label="Import a GEDCOM file"]', SMALL_GED);
  await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 30_000 });

  // Off the tree view the chart formats are unavailable.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByText('Open the Tree view to export the chart.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^SVG/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 300);

  await page.getByRole('tab', { name: 'Tree' }).click();
  await page.getByRole('button', { name: 'Full tree' }).click(); // Maria ⚭ Jose → Ana, Carlos
  await expect(page.locator('.tree-svg .card-node')).toHaveCount(4);

  const svgDl = await exportChart(page, /^SVG/);
  expect(svgDl.suggestedFilename()).toBe('family-tree.svg');
  const svg = (await bytes(svgDl)).toString();
  expect(svg).toMatch(/^<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  expect(svg).toContain('Carlos');            // names are real text
  expect(svg).not.toContain('var(--');        // colours resolved
  expect(svg).not.toContain('blob:');         // photos embedded, not page-local URLs
  expect(svg).not.toContain('card-edit');     // no edit pencils
  expect(svg).not.toContain('_ngcontent');    // no Angular attributes
  const svgW = Number(svg.match(/^<svg[^>]* width="(\d+)"/)![1]);

  const jpgDl = await exportChart(page, /^JPG/);
  expect(jpgDl.suggestedFilename()).toBe('family-tree.jpg');
  const jpg = await bytes(jpgDl);
  expect([...jpg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  expect(jpegSize(jpg).w).toBeGreaterThanOrEqual(svgW * 3 - 3); // 3x: small labels stay legible
});
