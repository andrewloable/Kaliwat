import { describe, it, expect } from 'vitest';
import { planTiles, substituteVars, rasterScale, RASTER_LIMITS } from './chart-export';

// A4 printable area in pt, roughly (595x842 minus 24pt margins each side).
const A4_W = 547;
const A4_H = 794;

describe('planTiles', () => {
  it('puts a small tree on a single page', () => {
    const p = planTiles(400, 300, A4_W, A4_H);
    expect(p.cols).toBe(1);
    expect(p.rows).toBe(1);
  });

  it('keeps a tree that exactly fills the page to one page (no float spill)', () => {
    const p = planTiles(A4_W, A4_H, A4_W, A4_H);
    expect(p.cols).toBe(1);
    expect(p.rows).toBe(1);
  });

  it('tiles a very wide tree horizontally, staying one row tall', () => {
    const p = planTiles(5000, 700, A4_W, A4_H, 0.35);
    expect(p.cols).toBeGreaterThan(1);
    expect(p.rows).toBe(1);
    // tiles cover the whole width (connected, no gap)
    expect(p.cols * p.winW).toBeGreaterThanOrEqual(5000);
  });

  it('tiles in both directions for a large tree', () => {
    const p = planTiles(4000, 4000, A4_W, A4_H, 0.35);
    expect(p.cols).toBeGreaterThan(1);
    expect(p.rows).toBeGreaterThan(1);
  });
});

// Guards the blank-PDF bug: svg2pdf can't read `var(--x)`, so fills/strokes
// must be resolved to literal colours before rendering.
describe('substituteVars', () => {
  const palette: Record<string, string> = { '--card': ' #faf6ee ', '--line': '#e7ddc9' };
  const lookup = (name: string) => palette[name] ?? '';

  it('resolves a var() to its (trimmed) colour', () => {
    expect(substituteVars('var(--card)', lookup)).toBe('#faf6ee');
  });

  it('leaves a literal colour untouched', () => {
    expect(substituteVars('#123456', lookup)).toBe('#123456');
    expect(substituteVars('none', lookup)).toBe('none');
  });

  it('falls back to black for an unknown var (never emits an unparseable value)', () => {
    expect(substituteVars('var(--missing)', lookup)).toBe('#000');
  });
});

describe('rasterScale', () => {
  it('renders a chart that fits at 3x', () => {
    expect(rasterScale(1500, 2500)).toBe(3);
  });

  it('shrinks a big chart only as far as the canvas area allows', () => {
    const s = rasterScale(3502, 28632); // the 484-card full tree from a real file
    expect(s).toBeCloseTo(Math.sqrt(268_435_456 / (3502 * 28632)), 6); // ≈1.64x
    expect(3502 * s * 28632 * s).toBeLessThanOrEqual(268_435_456 + 1);
  });

  it('respects a side cap (Firefox fallback)', () => {
    const s = rasterScale(3502, 28632, RASTER_LIMITS[1]);
    expect(28632 * s).toBeLessThanOrEqual(32767);
  });

  it('fits the iOS-safe canvas on the last fallback', () => {
    const lim = RASTER_LIMITS[RASTER_LIMITS.length - 1];
    const s = rasterScale(2566, 5312, lim);
    expect(2566 * s * 5312 * s).toBeLessThanOrEqual(lim.area + 1);
    expect(5312 * s).toBeLessThanOrEqual(lim.side);
  });
});
