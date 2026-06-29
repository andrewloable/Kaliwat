// Build a multi-size favicon.ico from art/icon.svg (replacing the old Angular one).
// ICO entries are PNG-compressed (supported by all current browsers).
// Run: node art/make-favicon.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(resolve(root, 'art/icon.svg'), 'utf8');
const sizes = [16, 32, 48];

const browser = await chromium.launch();
const pngs = [];
for (const s of sizes) {
  const page = await browser.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
  const html = `<!doctype html><meta charset=utf8>
    <style>*{margin:0;padding:0}html,body{width:${s}px;height:${s}px}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`;
  await page.setContent(html, { waitUntil: 'networkidle' });
  pngs.push(await page.screenshot({ clip: { x: 0, y: 0, width: s, height: s } }));
  await page.close();
}
await browser.close();

// Assemble ICO: 6-byte ICONDIR + 16-byte ICONDIRENTRY per image + concatenated PNGs.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);          // reserved
header.writeUInt16LE(1, 2);          // type: icon
header.writeUInt16LE(sizes.length, 4);

const entries = [];
let offset = 6 + 16 * sizes.length;
sizes.forEach((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s === 256 ? 0 : s, 0); // width
  e.writeUInt8(s === 256 ? 0 : s, 1); // height
  e.writeUInt8(0, 2);                 // palette
  e.writeUInt8(0, 3);                 // reserved
  e.writeUInt16LE(1, 4);              // color planes
  e.writeUInt16LE(32, 6);             // bits per pixel
  e.writeUInt32LE(pngs[i].length, 8); // size of PNG data
  e.writeUInt32LE(offset, 12);        // offset of PNG data
  offset += pngs[i].length;
  entries.push(e);
});

const ico = Buffer.concat([header, ...entries, ...pngs]);
writeFileSync(resolve(root, 'public/favicon.ico'), ico);
console.log(`wrote public/favicon.ico (${sizes.join('/')} px, ${ico.length} bytes)`);
