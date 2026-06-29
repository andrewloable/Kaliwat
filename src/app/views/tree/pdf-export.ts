// Render the on-screen family tree (whatever mode is showing) to a PDF.
//
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

/** Export a rendered chart layer (the <g> holding cards + edges) to a PDF download. */
export async function exportTreePdf(layer: SVGGElement, pageSize: PageFormat): Promise<void> {
  const svgNS = 'http://www.w3.org/2000/svg';
  const clone = layer.cloneNode(true) as SVGGElement;
  clone.removeAttribute('transform'); // drop the live zoom/pan
  clone.querySelectorAll('.card-edit').forEach((el) => el.remove()); // no ✎ pencils in print
  inlineCssVars(clone);

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
