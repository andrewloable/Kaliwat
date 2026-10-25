// Export the on-screen family tree chart (whatever mode is showing, the whole
// drawing rather than the visible window) as PDF, SVG or JPG.
//
// PDF:
// The trick for "connected across pages": we don't re-slice the tree into
// per-page chunks. We build ONE offscreen <svg> holding the whole drawing, then
// render each page from a different viewBox window over the SAME coordinate
// space. Tiles abut exactly in tree units, so an edge crossing a page boundary
// continues on the next page and lines up — no seams to stitch.

export type PageFormat = 'a4' | 'a3' | 'a2' | 'letter' | 'legal' | 'tabloid';

export interface TilePlan {
  cols: number;
  rows: number;
  winW: number; // tree units visible per page horizontally
  winH: number; // tree units visible per page vertically
}

/**
 * Decide the page grid. Fit the whole tree onto one page when that keeps it at
 * least `minScale` (pt per tree-unit) readable; otherwise hold the scale at
 * `minScale` and tile across as many pages as needed. `contentW/H` is the
 * printable area (page minus margins), in the same pt units.
 */
export function planTiles(
  treeW: number,
  treeH: number,
  contentW: number,
  contentH: number,
  minScale = 0.35,
): TilePlan {
  const fitScale = Math.min(contentW / treeW, contentH / treeH);
  const scale = Math.max(fitScale, minScale);
  const winW = contentW / scale;
  const winH = contentH / scale;
  // tiny epsilon so a tree that exactly fills a page doesn't spill to a 2nd one
  const cols = Math.max(1, Math.ceil(treeW / winW - 1e-6));
  const rows = Math.max(1, Math.ceil(treeH / winH - 1e-6));
  return { cols, rows, winW, winH };
}

const MARGIN = 24; // pt

/** Replace every `var(--x)` in `value` using `lookup`; falls back to black. */
export function substituteVars(value: string, lookup: (name: string) => string): string {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name) => lookup(name).trim() || '#000');
}

/**
 * svg2pdf can't parse `var(--x)` in fill/stroke attributes (it reads the raw
 * attribute, not the computed style), so it paints nothing and the page comes
 * out blank. Resolve every var() against :root to a literal colour first.
 */
function inlineCssVars(root: SVGGElement): void {
  const cs = getComputedStyle(document.documentElement);
  const lookup = (name: string) => cs.getPropertyValue(name);
  for (const el of Array.from(root.querySelectorAll<SVGElement>('*'))) {
    for (const attr of ['fill', 'stroke'] as const) {
      const v = el.getAttribute(attr);
      if (v && v.includes('var(')) el.setAttribute(attr, substituteVars(v, lookup));
    }
  }
}

const svgNS = 'http://www.w3.org/2000/svg';

/** A print-ready copy of the chart layer: no zoom/pan, no ✎ pencils, literal colours. */
function printableClone(layer: SVGGElement): SVGGElement {
  const clone = layer.cloneNode(true) as SVGGElement;
  clone.removeAttribute('transform'); // drop the live zoom/pan
  clone.querySelectorAll('.card-edit').forEach((el) => el.remove()); // no ✎ pencils in print
  for (const el of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const a of Array.from(el.attributes)) if (a.name.startsWith('_ng')) el.removeAttribute(a.name); // Angular scoping noise
  }
  inlineCssVars(clone);
  return clone;
}

/** Export a rendered chart layer (the <g> holding cards + edges) to a PDF download. */
export async function exportTreePdf(layer: SVGGElement, pageSize: PageFormat): Promise<void> {
  const clone = printableClone(layer);

  // Host svg must be in the document so CSS custom properties (var(--card)…)
  // resolve and getBBox() works.
  const host = document.createElementNS(svgNS, 'svg');
  host.style.position = 'fixed';
  host.style.left = '-99999px';
  host.style.top = '0';
  host.appendChild(clone);
  document.body.appendChild(host);

  try {
    const bbox = clone.getBBox();
    if (!bbox.width || !bbox.height) return;
    const pad = 16;
    const treeX = bbox.x - pad;
    const treeY = bbox.y - pad;
    const treeW = bbox.width + pad * 2;
    const treeH = bbox.height + pad * 2;

    const { jsPDF } = await import('jspdf');
    const { svg2pdf } = await import('svg2pdf.js');

    const orientation = treeW >= treeH ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ unit: 'pt', format: pageSize, orientation });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const cw = pw - MARGIN * 2;
    const ch = ph - MARGIN * 2;

    const { cols, rows, winW, winH } = planTiles(treeW, treeH, cw, ch);
    // centre the page grid over the tree (extra space splits evenly)
    const offX = treeX - (cols * winW - treeW) / 2;
    const offY = treeY - (rows * winH - treeH) / 2;

    host.setAttribute('width', `${cw}`);
    host.setAttribute('height', `${ch}`);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r || c) pdf.addPage(pageSize, orientation);
        const vx = offX + c * winW;
        const vy = offY + r * winH;
        host.setAttribute('viewBox', `${vx} ${vy} ${winW} ${winH}`);
        await svg2pdf(host, pdf, { x: MARGIN, y: MARGIN, width: cw, height: ch });
      }
    }
    pdf.save('family-tree.pdf');
  } finally {
    host.remove();
  }
}

// ── SVG / JPG ────────────────────────────────────────────────────────────────

export interface RasterLimits { side: number; area: number } // canvas px
// Largest canvas tried first, then smaller ones when the browser refuses it.
// Measured SVG→canvas→JPEG (2026-10): Chromium 149 and WebKit 26.5 manage
// 268M px (e.g. 4096×65535); Firefox 151 manages 537M px but fails to encode a
// 65535px-tall JPEG (38000 works); iOS Safari caps the area at 16.7M px.
export const RASTER_LIMITS: RasterLimits[] = [
  { side: 65535, area: 268_435_456 },
  { side: 32767, area: 268_435_456 },
  { side: 16384, area: 64e6 },
  { side: 4096, area: 16_777_216 },
];

/**
 * JPG resolution in px per tree unit: 3× for crisp text when zoomed, reduced
 * only as far as needed for the whole chart to fit one canvas within `lim`.
 */
export function rasterScale(w: number, h: number, lim: RasterLimits = RASTER_LIMITS[0]): number {
  return Math.min(3, lim.side / w, lim.side / h, Math.sqrt(lim.area / (w * h)));
}

function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function paperColour(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#ffffff';
}

/** Photos are blob: URLs that die outside this page; embed them as data: URIs. */
async function embedPhotos(root: SVGElement): Promise<void> {
  await Promise.all(Array.from(root.querySelectorAll('image')).map(async (img) => {
    const href = img.getAttribute('href');
    if (!href?.startsWith('blob:')) return;
    const blob = await (await fetch(href)).blob();
    const dataUrl = await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(blob);
    });
    img.setAttribute('href', dataUrl);
  }));
}

/** A self-contained <svg> of the whole chart on a paper background, plus its extent. */
async function standaloneSvg(layer: SVGGElement): Promise<{ svg: SVGSVGElement; x: number; y: number; w: number; h: number }> {
  const clone = printableClone(layer);
  await embedPhotos(clone);
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('xmlns', svgNS);
  svg.appendChild(clone);
  svg.style.position = 'fixed';
  svg.style.left = '-99999px';
  document.body.appendChild(svg); // getBBox needs layout
  const b = clone.getBBox();
  svg.remove();
  svg.removeAttribute('style');
  const pad = 16;
  const [x, y, w, h] = [b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2];
  const bg = document.createElementNS(svgNS, 'rect');
  for (const [k, v] of Object.entries({ x, y, width: w, height: h, fill: paperColour() })) bg.setAttribute(k, `${v}`);
  svg.insertBefore(bg, clone);
  return { svg, x, y, w, h };
}

function serialize(svg: SVGSVGElement, x: number, y: number, w: number, h: number, pxW: number, pxH: number): string {
  svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  svg.setAttribute('width', `${pxW}`);
  svg.setAttribute('height', `${pxH}`);
  return new XMLSerializer().serializeToString(svg);
}

/** Export the whole chart as one vector .svg (sharp at any zoom, photos embedded). */
export async function exportTreeSvg(layer: SVGGElement): Promise<void> {
  const { svg, x, y, w, h } = await standaloneSvg(layer);
  if (!w || !h) return;
  save(new Blob([serialize(svg, x, y, w, h, Math.ceil(w), Math.ceil(h))], { type: 'image/svg+xml' }), 'family-tree.svg');
}

/** Draw the chart to a JPEG at `scale` px per tree unit; throws if the browser refuses the canvas. */
async function rasterize(svg: SVGSVGElement, x: number, y: number, w: number, h: number, scale: number): Promise<Blob> {
  const pxW = Math.floor(w * scale);
  const pxH = Math.floor(h * scale);
  const url = URL.createObjectURL(new Blob([serialize(svg, x, y, w, h, pxW, pxH)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = pxW;
    canvas.height = pxH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.fillStyle = paperColour();
    ctx.fillRect(0, 0, pxW, pxH);
    // an over-limit canvas can fail silently (stays transparent) instead of throwing
    if (ctx.getImageData(0, 0, 1, 1).data[3] !== 255) throw new Error('canvas too large');
    ctx.drawImage(img, 0, 0, pxW, pxH);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('canvas too large');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Export the whole chart as one high-resolution family-tree.jpg (see
 * rasterScale), stepping down to a smaller canvas if the browser refuses one.
 */
export async function exportTreeJpg(layer: SVGGElement): Promise<void> {
  const { svg, x, y, w, h } = await standaloneSvg(layer);
  if (!w || !h) return;
  let lastError: unknown;
  for (const lim of RASTER_LIMITS) {
    try {
      return save(await rasterize(svg, x, y, w, h, rasterScale(w, h, lim)), 'family-tree.jpg');
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}
