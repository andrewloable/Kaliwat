import JSZip from 'jszip';

export const MAX_GDZ_BYTES = 200 * 1024 * 1024;  // 200 MB total archive
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50 MB per entry
export const MAX_MEDIA_ENTRIES = 2000;
export const THUMB_PX = 300;                      // max thumbnail dimension

export interface MediaEntry {
  path: string;
  blob: Blob;
  thumb: Blob | null;
}

export interface GedzipImportResult {
  gedcomBytes: Uint8Array<ArrayBuffer>;
  media: MediaEntry[];
  skipped: { path: string; reason: string }[];
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|tiff?|bmp)$/i;
const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp',
};

function mimeFor(path: string): string {
  return MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

/** Generates a thumbnail Blob (best-effort, returns null if browser API unavailable). */
export async function makeThumbnail(blob: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return canvas.convertToBlob({ type: 'image/webp', quality: 0.75 });
  } catch {
    return null;
  }
}

/** Parses a .gdz archive and returns the embedded GEDCOM bytes + extracted media. */
export async function importGedzip(file: File | Blob): Promise<GedzipImportResult | { error: string }> {
  if (file.size > MAX_GDZ_BYTES) {
    return { error: `Archive too large (${Math.round(file.size / 1e6)} MB, max ${MAX_GDZ_BYTES / 1e6} MB)` };
  }

  const zip = await JSZip.loadAsync(file);

  // Find the GEDCOM file (prefer gedcom.ged, fall back to any *.ged)
  const entries = Object.keys(zip.files);
  const gedEntry = entries.find(n => n === 'gedcom.ged') ?? entries.find(n => n.endsWith('.ged'));
  if (!gedEntry) return { error: 'No .ged file found in archive' };

  const raw = await zip.files[gedEntry].async('uint8array');
  const gedcomBytes = new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)) as Uint8Array<ArrayBuffer>;

  const media: MediaEntry[] = [];
  const skipped: { path: string; reason: string }[] = [];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || path === gedEntry) continue;
    if (!IMAGE_EXT.test(path)) continue;
    if (media.length >= MAX_MEDIA_ENTRIES) { skipped.push({ path, reason: 'Entry limit reached' }); continue; }

    const buf = await entry.async('arraybuffer');
    if (buf.byteLength > MAX_MEDIA_BYTES) {
      skipped.push({ path, reason: `File too large (${Math.round(buf.byteLength / 1e6)} MB)` });
      continue;
    }

    const blob = new Blob([buf], { type: mimeFor(path) });
    const thumb = await makeThumbnail(blob);
    media.push({ path, blob, thumb });
  }

  return { gedcomBytes, media, skipped };
}

/** Packs a GEDCOM text + media blobs into a .gdz archive. */
export async function exportGedzip(
  gedcomText: string,
  mediaEntries: { path: string; blob: Blob }[],
): Promise<Blob> {
  const zip = new JSZip();
  zip.file('gedcom.ged', gedcomText);
  for (const { path, blob } of mediaEntries) {
    zip.file(path, blob);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
