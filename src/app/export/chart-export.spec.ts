import { describe, it, expect } from 'vitest';
import { planTiles, substituteVars, planRaster, SAFE_LIMITS } from './chart-export';

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

describe('planRaster', () => {
  it('renders a chart that fits at 3x as one image', () => {
    expect(planRaster(1500, 2500)).toEqual({ scale: 3, cols: 1, rows: 1, tileW: 1500, tileH: 2500 });
  });

  it('drops to 2x (never lower) before splitting', () => {
    const p = planRaster(3000, 6000); // 3x would be 18000px tall
    expect(p).toEqual({ scale: 2, cols: 1, rows: 1, tileW: 3000, tileH: 6000 });
  });

  it('tiles a chart too big for one canvas, keeping 2x', () => {
    const p = planRaster(4000, 60000);
    expect(p.scale).toBe(2);
    expect(p.cols * p.tileW).toBeGreaterThanOrEqual(4000);
    expect(p.rows * p.tileH).toBeGreaterThanOrEqual(60000);
    expect(p.tileW * p.scale * p.tileH * p.scale).toBeLessThanOrEqual(100e6);
  });

  it('uses small tiles under the iOS-safe limits', () => {
    const p = planRaster(3000, 6000, SAFE_LIMITS);
    expect(p.scale).toBe(2);
    expect(p.tileW * p.scale).toBeLessThanOrEqual(SAFE_LIMITS.side);
    expect(p.rows).toBeGreaterThan(1);
  });
});
