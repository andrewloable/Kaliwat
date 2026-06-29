// Rasterize the codex-generated SVGs (art/*.svg) into the PNGs the app ships.
// Uses Playwright (already a devDependency) since macOS `sips` can't read SVG.
// Run: node art/rasterize.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'public/icons'), { recursive: true });

const jobs = [
  { svg: 'art/icon.svg', w: 512, h: 512, out: 'public/icons/icon-512.png' },
  { svg: 'art/icon.svg', w: 192, h: 192, out: 'public/icons/icon-192.png' },
  { svg: 'art/icon.svg', w: 180, h: 180, out: 'public/icons/apple-touch-icon.png' },
  { svg: 'art/icon.svg', w: 48, h: 48, out: 'public/favicon-48.png' },
  { svg: 'art/og.svg', w: 1200, h: 630, out: 'public/og-image.png' },
];

const browser = await chromium.launch();
for (const j of jobs) {
  const svg = readFileSync(resolve(root, j.svg), 'utf8');
  const page = await browser.newPage({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: 1 });
  const html = `<!doctype html><meta charset=utf8>
    <style>*{margin:0;padding:0}html,body{width:${j.w}px;height:${j.h}px}svg{display:block;width:${j.w}px;height:${j.h}px}</style>${svg}`;
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.screenshot({ path: resolve(root, j.out), clip: { x: 0, y: 0, width: j.w, height: j.h } });
  await page.close();
  console.log('wrote', j.out);
}
await browser.close();
