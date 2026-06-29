import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { importGedzip, exportGedzip, MAX_GDZ_BYTES, MAX_MEDIA_BYTES, MAX_MEDIA_ENTRIES } from './gedzip';

const SAMPLE_GED = `0 HEAD
1 GEDC
2 VERS 5.5.1
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Test /Person/
1 OBJE
2 FILE media/photo1.jpg
0 TRLR
`;

// Minimal 1×1 white JPEG (valid binary, 631 bytes)
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=';

function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function makeGdz(includeMedia = true): Promise<Blob> {
  const zip = new JSZip();
  zip.file('gedcom.ged', SAMPLE_GED);
  if (includeMedia) {
    zip.file('media/photo1.jpg', b64ToUint8(TINY_JPEG_B64));
  }
  return zip.generateAsync({ type: 'blob' });
}

describe('importGedzip', () => {
  it('extracts the GEDCOM bytes from a .gdz', async () => {
    const blob = await makeGdz(false);
    const result = await importGedzip(blob);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    const text = new TextDecoder().decode(result.gedcomBytes);
    expect(text).toContain('0 HEAD');
    expect(text).toContain('@I1@ INDI');
  });

  it('extracts image blobs from archive entries', async () => {
    const blob = await makeGdz(true);
    const result = await importGedzip(blob);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.media).toHaveLength(1);
    expect(result.media[0].path).toBe('media/photo1.jpg');
    expect(result.media[0].blob.size).toBeGreaterThan(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('returns error when archive exceeds size cap', async () => {
    // Create a fake File with oversized size (without actually allocating memory)
    const fakeFile = { size: MAX_GDZ_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;
    const result = await importGedzip(fakeFile);
    expect('error' in result).toBe(true);
    expect((result as { error: string }).error).toMatch(/too large/i);
  });

  it('returns error when no .ged file found in archive', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'no ged here');
    const blob = await zip.generateAsync({ type: 'blob' });
    const result = await importGedzip(blob);
    expect('error' in result).toBe(true);
    expect((result as { error: string }).error).toMatch(/no .ged/i);
  });

  it('skips individual media entries exceeding per-file cap', async () => {
    const zip = new JSZip();
    zip.file('gedcom.ged', SAMPLE_GED);
    // Create a fake large entry by padding the array
    const bigBuf = new Uint8Array(MAX_MEDIA_BYTES + 1);
    bigBuf[0] = 0xff; bigBuf[1] = 0xd8; // jpeg magic
    zip.file('media/huge.jpg', bigBuf);
    const blob = await zip.generateAsync({ type: 'blob' });
    const result = await importGedzip(blob);
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.media).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/too large/i);
  });
});

describe('exportGedzip', () => {
  it('produces a ZIP containing gedcom.ged', async () => {
    const blob = await exportGedzip(SAMPLE_GED, []);
    const zip = await JSZip.loadAsync(blob);
    expect(zip.files['gedcom.ged']).toBeDefined();
    const text = await zip.files['gedcom.ged'].async('text');
    expect(text).toContain('0 HEAD');
  });

  it('round-trips media entries', async () => {
    const photoBytes = b64ToUint8(TINY_JPEG_B64);
    const photoBlob = new Blob([photoBytes.buffer as ArrayBuffer], { type: 'image/jpeg' });
    const exported = await exportGedzip(SAMPLE_GED, [{ path: 'media/photo1.jpg', blob: photoBlob }]);

    const zip = await JSZip.loadAsync(exported);
    expect(zip.files['media/photo1.jpg']).toBeDefined();
    const buf = await zip.files['media/photo1.jpg'].async('arraybuffer');
    expect(buf.byteLength).toBe(photoBytes.length);
  });
});
