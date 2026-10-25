/** Pure geometry for the photo cropper: a square view over an image that can be panned and zoomed. */

export const CROP_VIEW = 280;   // px: side of the on-screen crop square
export const CROP_OUT = 400;    // px: side of the saved photo
export const CROP_MAX_ZOOM = 4; // × the "fills the square" size

/** Scale at which the image just covers the view (zoom 1). */
export function coverScale(iw: number, ih: number, view = CROP_VIEW): number {
  return view / Math.min(iw, ih);
}

/** Keep the image covering the view: an offset can't pull an edge inside the square. */
export function clampOffset(offset: number, imageSize: number, view = CROP_VIEW): number {
  return Math.min(0, Math.max(view - imageSize, offset));
}

/**
 * Zoom to `scale` keeping the image point under (fx, fy) fixed on screen. Returns the
 * new offsets, clamped so the image still covers the view.
 */
export function zoomAt(
  iw: number, ih: number, scale: number, tx: number, ty: number,
  newScale: number, fx: number, fy: number, view = CROP_VIEW,
): { tx: number; ty: number } {
  const ix = (fx - tx) / scale;
  const iy = (fy - ty) / scale;
  return {
    tx: clampOffset(fx - ix * newScale, iw * newScale, view),
    ty: clampOffset(fy - iy * newScale, ih * newScale, view),
  };
}

/** The part of the original image shown in the view: a square (sx, sy, side) in image pixels. */
export function cropSource(
  scale: number, tx: number, ty: number, view = CROP_VIEW,
): { sx: number; sy: number; side: number } {
  return { sx: Math.max(0, -tx / scale), sy: Math.max(0, -ty / scale), side: view / scale };
}
