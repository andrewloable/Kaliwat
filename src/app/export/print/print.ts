/**
 * Print/PDF export: vector-quality pedigree PDF via jsPDF + svg2pdf.js.
 * Also exports raw SVG for use in vector editors.
 * Applies E1a redaction before rendering.
 */
import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import { Individual, Union, UUID } from '../../core/model/types';
import { applyRedaction, RedactionOptions } from '../redaction/redaction';

export interface PrintOptions extends RedactionOptions {
  /** A4 landscape = 297×210mm. Default: A4 landscape. */
  pageWidthMm?: number;
  pageHeightMm?: number;
  /** Max persons per page column before tiling starts. Default 30. */
  pageBreakThreshold?: number;
  title?: string;
}

export interface PrintResult {
  pdf: Uint8Array;
  /** The SVG string used to generate the PDF (also usable standalone). */
  svg: string;
  pageCount: number;
  livingCount: number;
}

// ── SVG generation ─────────────────────────────────────────────────────────────

const CARD_W = 180;
const CARD_H = 60;
const MARGIN = 20;
const COL_GAP = 40;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Row {
  id: UUID;
  name: string;
  birth: string;
  death: string;
  living: boolean;
}

function buildRows(
  individuals: Map<UUID, Individual>,
  redacted: ReturnType<typeof applyRedaction>['individuals'],
): Row[] {
  const rows: Row[] = [];
  for (const [id, r] of redacted) {
    if (r.isRedacted) continue;
    const indi = individuals.get(id)!;
    const birtYear = r.birthYear?.toString() ?? '';
    const deatYear = r.deathYear?.toString() ?? '';
    rows.push({ id, name: r.displayName ?? '', birth: birtYear, death: deatYear, living: false });
  }
  return rows;
}

function renderCard(row: Row, x: number, y: number): string {
  const nameLabel = row.living ? 'Living' : esc(row.name);
  const datesLabel = [row.birth, row.death].filter(Boolean).join(' – ');
  return `
<g transform="translate(${x},${y})">
  <rect width="${CARD_W}" height="${CARD_H}" rx="4" fill="#faf6ee" stroke="#d8cdba" stroke-width="1"/>
  <text x="8" y="20" font-family="Georgia,serif" font-size="11" fill="#2b2420">${nameLabel}</text>
  <text x="8" y="36" font-family="Georgia,serif" font-size="9" fill="#6b5f54">${esc(datesLabel)}</text>
</g>`;
}

/**
 * Generate a multi-column SVG listing all (non-living) individuals.
 * Returns the SVG and the number of pages it represents.
 */
export function generateSvg(
  individuals: Map<UUID, Individual>,
  redactedMap: ReturnType<typeof applyRedaction>['individuals'],
  opts: { pageWidthMm: number; pageHeightMm: number; pageBreakThreshold: number; title: string },
): { svg: string; pageCount: number } {
  const rows = buildRows(individuals, redactedMap);
  const perColumn = opts.pageBreakThreshold;
  const colCount = Math.max(1, Math.ceil(rows.length / perColumn));
  const pxPerMm = 3.7795; // 96dpi: 1mm = 3.7795px
  const pageW = opts.pageWidthMm * pxPerMm;
  const pageH = opts.pageHeightMm * pxPerMm;
  const totalW = colCount * (CARD_W + COL_GAP) + MARGIN * 2;
  const totalH = Math.min(perColumn, rows.length) * (CARD_H + MARGIN) + MARGIN * 2 + 40;
  const pageCount = colCount;

  let cards = '';
  for (let i = 0; i < rows.length; i++) {
    const col = Math.floor(i / perColumn);
    const row = i % perColumn;
    const x = MARGIN + col * (CARD_W + COL_GAP);
    const y = 60 + row * (CARD_H + MARGIN);
    cards += renderCard(rows[i], x, y);
  }

  const titleEl = `<text x="${MARGIN}" y="30" font-family="'Iowan Old Style',Georgia,serif" font-size="18" fill="#2b2420">${esc(opts.title)}</text>`;
  const noticeEl = `<text x="${MARGIN}" y="48" font-family="Georgia,serif" font-size="9" fill="#9c5a3c">One-way export — read only. Living people not included.</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">
<rect width="${totalW}" height="${totalH}" fill="#f4efe6"/>
${titleEl}
${noticeEl}
${cards}
</svg>`;

  return { svg, pageCount };
}

// ── PDF generation ─────────────────────────────────────────────────────────────

/**
 * Generate a print-quality PDF from the tree.
 * Applies E1a redaction; living people are not included.
 */
export async function generatePdf(
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
  options: PrintOptions,
): Promise<PrintResult> {
  const opts = {
    pageWidthMm: options.pageWidthMm ?? 297,
    pageHeightMm: options.pageHeightMm ?? 210,
    pageBreakThreshold: options.pageBreakThreshold ?? 30,
    title: options.title ?? 'Family Tree',
  };

  const { individuals: redacted, livingIds } = applyRedaction(individuals, options);
  const { svg, pageCount } = generateSvg(individuals, redacted, opts);

  // Parse SVG into DOM element for svg2pdf
  const svgDoc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const svgEl = svgDoc.documentElement as unknown as SVGSVGElement;

  // Create jsPDF in landscape A4 (or custom size)
  const doc = new jsPDF({
    orientation: opts.pageWidthMm > opts.pageHeightMm ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [opts.pageWidthMm, opts.pageHeightMm],
  });

  // Render SVG to first page
  await svg2pdf(svgEl, doc, {
    x: 0,
    y: 0,
    width: opts.pageWidthMm,
    height: opts.pageHeightMm,
  });

  // Additional pages for wide trees (tiling: shift viewport per column)
  const colWidthMm = (CARD_W + COL_GAP) * (opts.pageWidthMm / (CARD_W + COL_GAP));
  for (let p = 1; p < pageCount; p++) {
    doc.addPage([opts.pageWidthMm, opts.pageHeightMm],
      opts.pageWidthMm > opts.pageHeightMm ? 'landscape' : 'portrait');
    await svg2pdf(svgEl, doc, {
      x: -(p * colWidthMm),
      y: 0,
      width: opts.pageWidthMm,
      height: opts.pageHeightMm,
    });
  }

  const pdfBytes = doc.output('arraybuffer');
  return {
    pdf: new Uint8Array(pdfBytes),
    svg,
    pageCount,
    livingCount: livingIds.size,
  };
}
