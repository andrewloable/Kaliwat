import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Prefer the real MyHeritage sample (~1771 people with CDN photos) — importing
// it caches avatar blobs, and PDF export embeds them, which is the path that
// surfaced the blob: CSP error. It's gitignored, so fall back to the committed
// 4-person sample on CI / fresh clones (the export + CSP assertions still hold).
const BIG = path.resolve(__dirname, '../sample/family-tree.ged');
const SAMPLE_GED = fs.existsSync(BIG) ? BIG : path.resolve(__dirname, '../public/sample.ged');

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

  // Export and capture the download.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /PDF/ }).click(),
  ]);

  expect(download.suggestedFilename()).toBe('family-tree.pdf');

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const pdf = Buffer.concat(chunks);

  // A real, non-trivial PDF.
  expect(pdf.length).toBeGreaterThan(1000);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

  // The CSP / blob regression must not reappear.
  const csp = errors.filter((e) => /Content Security Policy|violates|blob:/i.test(e));
  expect(csp, `unexpected console errors:\n${csp.join('\n')}`).toHaveLength(0);
});
