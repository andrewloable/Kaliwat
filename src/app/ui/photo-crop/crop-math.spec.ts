import { describe, it, expect } from 'vitest';
import { coverScale, clampOffset, zoomAt, cropSource, CROP_VIEW } from './crop-math';

describe('crop-math', () => {
  it('coverScale makes the shorter side fill the view', () => {
    expect(coverScale(4000, 2000)).toBeCloseTo(CROP_VIEW / 2000);
    expect(coverScale(1000, 3000)).toBeCloseTo(CROP_VIEW / 1000);
  });

  it('clampOffset never lets an edge of the image come inside the view', () => {
    // image 560 wide in a 280 view: offset must stay within [-280, 0]
    expect(clampOffset(50, 560)).toBe(0);
    expect(clampOffset(-400, 560)).toBe(-280);
    expect(clampOffset(-100, 560)).toBe(-100);
  });

  it('cropSource with no pan shows the top-left square of the image', () => {
    const s = coverScale(4000, 2000);
    const c = cropSource(s, 0, 0);
    expect(c.sx).toBe(0);
    expect(c.sy).toBe(0);
    expect(c.side).toBeCloseTo(2000); // the full short side
  });

  it('cropSource follows the pan and zoom', () => {
    // scale 0.28 (4000×2000 cover), panned 70px left: the view starts 250 image-px in
    const c = cropSource(0.28, -70, 0);
    expect(c.sx).toBeCloseTo(250);
    // zoom 2x halves the visible side
    expect(cropSource(0.56, 0, 0).side).toBeCloseTo(500);
  });

  it('zoomAt keeps the point under the pointer fixed', () => {
    const iw = 4000, ih = 2000;
    const s0 = coverScale(iw, ih);
    const start = { tx: -70, ty: 0 };
    const fx = 140, fy = 140;
    const before = { x: (fx - start.tx) / s0, y: (fy - start.ty) / s0 };
    const z = zoomAt(iw, ih, s0, start.tx, start.ty, s0 * 2, fx, fy);
    const after = { x: (fx - z.tx) / (s0 * 2), y: (fy - z.ty) / (s0 * 2) };
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zoomAt clamps so the image still covers the view', () => {
    const z = zoomAt(4000, 2000, coverScale(4000, 2000), -70, 0, coverScale(4000, 2000), 0, 0);
    expect(z.tx).toBeLessThanOrEqual(0);
    expect(z.tx).toBeGreaterThanOrEqual(CROP_VIEW - 4000 * coverScale(4000, 2000));
  });
});
