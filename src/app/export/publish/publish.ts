/**
 * Publish emitter: generates a single self-contained .html file.
 *
 * - Applies E1a redaction before emitting (living people → "Living")
 * - EXIF/GPS stripped from embedded photos via canvas recompression
 * - All assets inlined (no external requests when the file is opened)
 * - Marked clearly as one-way export (not re-importable)
 * - Size-guarded: warns when output exceeds threshold
 */
import { Individual, Union, MediaObject, UUID } from '../../core/model/types';
import { applyRedaction, RedactionOptions } from '../redaction/redaction';

export interface PublishOptions extends RedactionOptions {
  title?: string;
  /** Warn when HTML exceeds this many bytes. Default 10MB. */
  maxSizeBytes?: number;
  /** Whether to embed photos as base64. Default true. */
  embedPhotos?: boolean;
  /** JPEG quality for recompressed photos, 0-1. Default 0.75. */
  photoQuality?: number;
}

export interface PublishResult {
  html: string;
  sizeBytes: number;
  warnings: string[];
  livingCount: number;
}

/** Convert a Blob to a base64 data URI. Browser + Node.js compatible. */
export async function blobToDataUri(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  // jsdom / Node.js fallback — use btoa
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
  return `data:${blob.type};base64,${btoa(binary)}`;
}

/**
 * Strip EXIF/GPS from an image blob by redrawing it on a canvas.
 * Falls back to original blob if canvas is unavailable (SSR / test env).
 */
export async function stripExif(blob: Blob, quality = 0.85): Promise<Blob> {
  if (typeof document === 'undefined') return blob; // test/SSR fallback
  return new Promise<Blob>((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          stripped => resolve(stripped ?? blob),
          'image/jpeg',
          quality,
        );
      } catch { URL.revokeObjectURL(url); resolve(blob); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(blob); };
    img.src = url;
  });
}

// ── HTML assembly ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function displayName(indi: Individual): string {
  const full = indi.names[0]?.full ?? '';
  return full.replace(/\/([^/]*)\//, '$1').trim() || '(unknown)';
}

function getYear(indi: Individual, type: 'BIRT' | 'DEAT'): string {
  const ev = indi.events.find(e => e.type === type);
  if (!ev?.date) return '';
  const m = ev.date.match(/\b(\d{4})\b/);
  return m ? m[1] : '';
}

const EMBEDDED_STYLE = `
body{font-family:"Iowan Old Style",Palatino,Georgia,serif;background:#f4efe6;color:#2b2420;margin:0;padding:1rem 2rem}
h1{font-size:1.5rem;margin-bottom:.25rem}
.notice{font-size:.8rem;color:#6b5f54;margin-bottom:1.5rem}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid #d8cdba}
th{background:#ece4d6;font-size:.85rem}
.living{color:#9c5a3c;font-style:italic}
.photo{width:48px;height:48px;object-fit:cover;border-radius:3px}
`;

const EMBEDDED_SCRIPT = `
const T=window._TREE_DATA;
const tbody=document.getElementById('tbody');
T.individuals.forEach(p=>{
  const tr=document.createElement('tr');
  const photo=p.photo?'<img class="photo" src="'+p.photo+'" alt="">':'';
  tr.innerHTML='<td>'+photo+'</td><td class="'+(p.living?'living':'')+'">'+(p.living?'Living':p.name)+'</td><td>'+(p.birth||'')+'</td><td>'+(p.death||'')+'</td>';
  tbody.appendChild(tr);
});
`;

export async function generatePublishHtml(
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
  media: Map<UUID, MediaObject>,
  photoBlobs: Map<UUID, Blob>,
  options: PublishOptions,
): Promise<PublishResult> {
  const warnings: string[] = [];
  const opts: PublishOptions = {
    title: options.title ?? 'Family Tree',
    maxSizeBytes: options.maxSizeBytes ?? 10 * 1024 * 1024,
    embedPhotos: options.embedPhotos ?? true,
    photoQuality: options.photoQuality ?? 0.75,
    referenceYear: options.referenceYear,
    thresholdYears: options.thresholdYears,
  };

  const { individuals: redacted, livingIds } = applyRedaction(individuals, opts);

  // Build per-person photo map (base64 data URIs, EXIF-stripped)
  const photoUris = new Map<UUID, string>();
  if (opts.embedPhotos && typeof document !== 'undefined') {
    for (const [id, r] of redacted) {
      if (r.isRedacted) continue;
      const indi = individuals.get(id);
      if (!indi?.mediaIds.length) continue;
      const mediaId = indi.mediaIds[0];
      const blob = photoBlobs.get(mediaId);
      if (!blob) continue;
      const stripped = await stripExif(blob, opts.photoQuality);
      photoUris.set(id, await blobToDataUri(stripped));
    }
  }

  // Serialized JSON for the embedded renderer
  const jsonRows = [...redacted.values()].map(r => {
    if (r.isRedacted) return { living: true, name: '', birth: '', death: '', photo: null };
    const indi = individuals.get(r.id)!;
    return {
      living: false,
      name: esc(r.displayName ?? displayName(indi)),
      birth: r.birthYear?.toString() ?? esc(getYear(indi, 'BIRT')),
      death: r.deathYear?.toString() ?? esc(getYear(indi, 'DEAT')),
      photo: photoUris.get(r.id) ?? null,
    };
  });

  const json = JSON.stringify({ individuals: jsonRows });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(opts.title!)}</title>
<!-- ONE-WAY EXPORT: this file is a read-only snapshot and cannot be re-imported -->
<meta name="robots" content="noindex,nofollow">
<style>${EMBEDDED_STYLE}</style>
</head>
<body>
<h1>${esc(opts.title!)}</h1>
<p class="notice">One-way export — read only. Living people are not included.</p>
<table>
<thead><tr><th></th><th>Name</th><th>Born</th><th>Died</th></tr></thead>
<tbody id="tbody"></tbody>
</table>
<script>window._TREE_DATA=${json};${EMBEDDED_SCRIPT}</script>
</body>
</html>`;

  const sizeBytes = new TextEncoder().encode(html).length;
  if (sizeBytes > opts.maxSizeBytes!) {
    warnings.push(
      `Output is ${Math.round(sizeBytes / 1024 / 1024 * 10) / 10} MB, which may be large. ` +
      `Consider setting embedPhotos: false or lowering photoQuality.`,
    );
  }

  return { html, sizeBytes, warnings, livingCount: livingIds.size };
}
