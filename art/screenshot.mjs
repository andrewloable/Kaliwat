// Capture README showcase screenshots of the live sample tree.
// Run: node art/screenshot.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = 'https://kaliwat.loable.tech';
mkdirSync('docs/screenshots', { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 600 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /try a sample tree/i }).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: 'docs/screenshots/list.png' });
console.log('wrote docs/screenshots/list.png');

// Same context → IndexedDB persists, so the reloaded /tree route shows the sample.
await page.goto(base + '/tree', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'docs/screenshots/tree.png' });
console.log('wrote docs/screenshots/tree.png');

await browser.close();
