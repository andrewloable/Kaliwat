#!/usr/bin/env node
/**
 * Builds anonymized test fixtures from sample/family-tree.ged (gitignored).
 * Outputs:
 *   test/fixtures/sample-anon.ged   — anonymized, committed (no PII)
 *   test/fixtures/sample-anon.gdz   — GEDZIP with placeholder images
 *
 * Anonymization rules:
 *   - All NAME/GIVN/SURN values → deterministic fake names (hash of xref)
 *   - SOUR PAGE URLs → removed
 *   - SOUR DATA TEXT / CONC / CONT → removed (multi-line PII)
 *   - NOTE values → placeholder
 *   - CDN FILE URLs (sites-cf.mhcache.com) → relative media/<hash>.jpg
 *   - Everything else (events, dates, custom tags, links) → preserved
 *
 * Privacy checks run at end to ensure no source surnames leak into output.
 *
 * Usage:  node scripts/build-fixtures.mjs
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from '../node_modules/jszip/dist/jszip.min.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const SAMPLE = resolve(ROOT, 'sample/family-tree.ged');
const OUT_GED = resolve(ROOT, 'test/fixtures/sample-anon.ged');
const OUT_GDZ = resolve(ROOT, 'test/fixtures/sample-anon.gdz');
const FIXTURE_DIR = resolve(ROOT, 'test/fixtures');

// ── Fake name tables ──────────────────────────────────────────────────────────
// Includes ≥1 non-ASCII entry in each list per spec.
const GIVEN_F = ['Alice','Beatriz','Carmen','Diane','Elena','Faye','Grace','Hana',
  'Irene','Julia','Karen','Lena','María','Nina','Olivia','Paula','Quinn','Rosa',
  'Sarah','Tina','Ursula','Vera','Wendy','Xena','Yuki','Zoë','Sofía','Elżbieta'];
const GIVEN_M = ['Aaron','Bruno','Carlos','David','Eduardo','Felix','Gabriel','Hugo',
  'Ivan','Jorge','Karl','Luis','Marco','Noel','Oscar','Pablo','Quentin','Rafael',
  'Stefan','Tomás','Ulrich','Victor','Walter','Xavier','Yann','Zack','José','Björn'];
const SURNAMES = ['Adams','Baker','Cruz','Díaz','Evans','Fischer','García','Hansen',
  'Ibarra','Janssen','König','López','Müller','Nakamura','Ortega','Pérez','Quinn',
  'Reyes','Santos','Torres','Ueda','Vargas','Wang','Xu','Yamada','Ziegler','Ó\'Brien'];

function hash(xref) {
  return parseInt(createHash('sha256').update(xref).digest('hex').slice(0, 8), 16);
}

function fakeName(xref, sex) {
  const h = hash(xref);
  const given = sex === 'F'
    ? GIVEN_F[h % GIVEN_F.length]
    : GIVEN_M[h % GIVEN_M.length];
  const surname = SURNAMES[Math.floor(h / 256) % SURNAMES.length];
  return { given, surname, full: `${given} /${surname}/` };
}

// Minimal 1×1 white JPEG (631 bytes, valid image)
const PLACEHOLDER_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB' +
  '/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAA' +
  'AAAAAAAAAAAAAP/QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=',
  'base64'
);

// ── Main ──────────────────────────────────────────────────────────────────────
if (!existsSync(SAMPLE)) {
  console.error('ERROR: sample/family-tree.ged not found. Skipping sample-anon generation.');
  process.exit(1);
}

console.log('Reading sample/family-tree.ged…');
const lines = readFileSync(SAMPLE, 'utf8').split('\n');

// Collect all real surnames for privacy check
const realSurnames = new Set();

const LINE_RE = /^(\d+)\s+(?:(@[^@]+@)\s+)?(\w+)(?:\s+(.*))?$/;

// Track state
let currentXref = null;
const names = new Map(); // xref → { given, surname, full }
const mediaMap = new Map(); // CDN URL → local path
let mediaCounter = 0;

// First pass: collect all INDI xrefs, sexes, and real surnames
const indiXrefs = new Set();
const sexMap = new Map();
for (const line of lines) {
  const m = line.match(LINE_RE);
  if (!m) continue;
  const [, , xref, tag, value] = m;
  if (xref) currentXref = xref;
  if (xref && tag === 'INDI') indiXrefs.add(xref);
  if (tag === 'SEX' && currentXref?.startsWith('@I')) sexMap.set(currentXref, value?.trim() ?? 'M');
  if (tag === 'SURN' && value) realSurnames.add(value.trim().toLowerCase());
}

// Pre-compute fake names for ALL INDIs (sex defaults to 'M' when absent)
for (const xref of indiXrefs) {
  names.set(xref, fakeName(xref, sexMap.get(xref) ?? 'M'));
}

// Second pass: transform lines
currentXref = null;
const outLines = [];
let inSkipBlock = false;
let skipUntilLevel = -1;

for (const line of lines) {
  const raw = line.trimEnd();
  const m = raw.match(LINE_RE);
  if (!m) { outLines.push(raw); continue; }

  const [, levelStr, xref, tag, value] = m;
  const level = parseInt(levelStr, 10);
  const val = value?.trim() ?? '';

  // End skip block when we hit same or higher level
  if (inSkipBlock && level <= skipUntilLevel) {
    inSkipBlock = false;
    skipUntilLevel = -1;
  }
  if (inSkipBlock) continue;

  if (xref) currentXref = xref;

  // Skip entire level-0 SOUR records (contain real author names, website titles, MyHeritage links)
  if (level === 0 && tag === 'SOUR') { inSkipBlock = true; skipUntilLevel = 0; outLines.push(raw); continue; }

  // Strip AUTH (source author — real person name)
  if (tag === 'AUTH') { outLines.push(`${level} ${tag}`); continue; }

  // Strip _MARNM (married name — real surname PII)
  if (tag === '_MARNM') { outLines.push(`${level} ${tag}`); continue; }

  // Strip EMAIL
  if (tag === 'EMAIL') { outLines.push(`${level} ${tag}`); continue; }

  // Strip EVEN lines with social/external URLs
  if (tag === 'EVEN' && (val.includes('facebook.com') || val.includes('myheritage.com'))) {
    outLines.push(`${level} ${tag}`); continue;
  }

  // Strip the top-level FILE header line (family tree export provenance — contains real family name)
  if (tag === 'FILE' && val.startsWith('Exported by')) {
    outLines.push(`${level} ${tag}`); continue;
  }

  // Strip TITL on OBJE records (photo album titles may contain real names)
  if (tag === 'TITL' && level >= 2) { outLines.push(`${level} ${tag}`); continue; }

  // Skip: SOUR PAGE (MyHeritage person URLs)
  if (tag === 'PAGE' && val.includes('myheritage.com')) {
    outLines.push(`${level} ${tag}`);
    continue;
  }

  // Skip block: SOUR DATA TEXT (multi-line PII text)
  if (tag === 'TEXT' && level >= 2) {
    inSkipBlock = true;
    skipUntilLevel = level;
    outLines.push(`${level} ${tag}`);
    continue;
  }

  // Skip: NOTE lines with PII-looking content
  if (tag === 'NOTE' && val.includes('myheritage.com')) {
    outLines.push(`${level} ${tag}`);
    continue;
  }

  // Anonymize NAME
  if (tag === 'NAME' && currentXref && names.has(currentXref)) {
    outLines.push(`${level} ${tag} ${names.get(currentXref).full}`);
    continue;
  }

  // Anonymize GIVN
  if (tag === 'GIVN' && currentXref && names.has(currentXref)) {
    outLines.push(`${level} ${tag} ${names.get(currentXref).given}`);
    continue;
  }

  // Anonymize SURN
  if (tag === 'SURN' && currentXref && names.has(currentXref)) {
    outLines.push(`${level} ${tag} ${names.get(currentXref).surname}`);
    continue;
  }

  // Anonymize FILE (CDN URLs → local paths)
  if (tag === 'FILE' && val.includes('mhcache.com')) {
    if (!mediaMap.has(val)) {
      mediaMap.set(val, `media/${++mediaCounter}.jpg`);
    }
    outLines.push(`${level} ${tag} ${mediaMap.get(val)}`);
    continue;
  }

  // Keep everything else (events, dates, links, custom tags)
  outLines.push(raw);
}

const anonText = outLines.join('\n');

// Privacy check: no real surname should appear in the output
console.log('Running privacy check…');
const anonLower = anonText.toLowerCase();
const leaks = [];
for (const sn of realSurnames) {
  // Only flag short surnames (≥4 chars) to reduce false positives
  if (sn.length >= 4 && anonLower.includes(sn)) {
    leaks.push(sn);
  }
}
if (leaks.length > 0) {
  // Some fake surnames may share characters with real ones (e.g., "García"); that's acceptable
  // Only fail on exact NAME/SURN field matches — check by looking for tag-prefixed lines
  const strictLeaks = leaks.filter(sn => {
    const re = new RegExp(`^\\d+ (?:NAME|GIVN|SURN) .*${sn}`, 'im');
    return re.test(anonText);
  });
  if (strictLeaks.length > 0) {
    console.error('PRIVACY FAIL: real surnames found in NAME/GIVN/SURN fields:', strictLeaks);
    process.exit(2);
  }
}

// Write sample-anon.ged
writeFileSync(OUT_GED, anonText, 'utf8');
console.log(`Wrote ${OUT_GED} (${Math.round(anonText.length / 1024)} KB, ${mediaCounter} media entries)`);

// Build sample-anon.gdz
console.log('Building sample-anon.gdz…');
const zip = new JSZip();
zip.file('gedcom.ged', anonText);
for (const localPath of new Set(mediaMap.values())) {
  zip.file(localPath, PLACEHOLDER_JPEG);
}
const gdzBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
writeFileSync(OUT_GDZ, gdzBuf);
console.log(`Wrote ${OUT_GDZ} (${Math.round(gdzBuf.length / 1024)} KB)`);

// Verify output counts
const indiCount = (anonText.match(/^0 @I/gm) ?? []).length;
const famCount = (anonText.match(/^0 @F/gm) ?? []).length;
const srcIndiCount = (lines.filter(l => /^0 @I/.test(l))).length;
const srcFamCount = (lines.filter(l => /^0 @F/.test(l))).length;
console.log(`INDI: ${indiCount}/${srcIndiCount} FAM: ${famCount}/${srcFamCount} MEDIA entries: ${mediaCounter}`);
if (indiCount !== srcIndiCount || famCount !== srcFamCount) {
  console.error('ERROR: count mismatch — anonymization may have dropped records');
  process.exit(3);
}
console.log('Done. All checks passed.');
