import { Injectable, OnDestroy, signal, Signal, WritableSignal } from '@angular/core';
import { db } from '../core/db/kaliwat-db';
import { makeThumbnail } from '../gedcom/gedzip/gedzip';

const MIN_ID = '';
const MAX_ID = '￿';
const WEB = /^https?:\/\//i;
const PARALLEL = 4;

/** Progress of downloading a tree's linked photos into this browser. */
export interface LinkDownload {
  total: number; // links to download
  done: number;
  failed: number;
  running: boolean;
}

/**
 * Manages photo Blobs and their Object URLs.
 * URLs are created lazily on request and revoked in bulk when the service
 * is destroyed (i.e., on navigation away), not per-item. This prevents
 * broken images during d3 pan/zoom or CDK virtual-scroll recycling.
 */
@Injectable({ providedIn: 'root' })
export class MediaService implements OnDestroy {
  private readonly urls = new Map<string, string>(); // mediaId → objectURL
  private readonly avatarSignals = new Map<string, WritableSignal<string | null>>();
  private readonly nullAvatar = signal<string | null>(null);
  private readonly inFlight = new Map<string, Promise<Blob | null>>(); // URL → its download
  private readonly deadLinks = new Set<string>(); // links that failed this session
  private running: Promise<LinkDownload> | null = null;
  private again = false;

  /** The latest download of linked photos (null until one ran). */
  readonly linkDownload = signal<LinkDownload | null>(null);

  /**
   * A person's primary photo as a signal of a local object URL (null until
   * resolved / when none). Resolution order: cached blob in IndexedDB → fetch
   * the remote OBJE URL once (CORS-permitting), thumbnail it, store the blob,
   * then serve from that local blob. The view only ever renders a blob: URL —
   * never a remote <img> — so display stays offline and within img-src.
   */
  avatar(treeId: string | null | undefined, mediaId: string | undefined): Signal<string | null> {
    if (!treeId || !mediaId) return this.nullAvatar;
    const key = `${treeId}|${mediaId}`;
    let sig = this.avatarSignals.get(key);
    if (!sig) {
      sig = signal<string | null>(null);
      this.avatarSignals.set(key, sig);
      this.resolveAvatar(treeId, mediaId)
        .then((url) => sig!.set(url))
        .catch(() => sig!.set(null));
    }
    return sig;
  }

  private async resolveAvatar(treeId: string, mediaId: string): Promise<string | null> {
    const cachedRec = await db.mediaBlobs.get([treeId, mediaId]);
    const cached = cachedRec?.thumb ?? cachedRec?.blob;
    if (cached) return this.cacheUrl(`thumb:${mediaId}`, cached);

    const meta = await db.mediaMeta.get([treeId, mediaId]);
    const url = meta?.data?.file;
    if (!url || !WEB.test(url)) return null;
    const shown = await this.store(treeId, [mediaId], url);
    return shown ? this.cacheUrl(`thumb:${mediaId}`, shown) : null;
  }

  /**
   * Downloads one photo link and stores the image (and its thumbnail) under every given media id. One request per
   * URL at a time, however many people or calls want it. Returns the image to show (the thumbnail when there is
   * one), or null when the link does not give an image.
   */
  private async store(treeId: string, mediaIds: string[], url: string): Promise<Blob | null> {
    if (this.deadLinks.has(url)) return null;
    let download = this.inFlight.get(url);
    if (!download) {
      download = fetch(url, { signal: AbortSignal.timeout(15_000) })
        .then(async (resp) => {
          const blob = resp.ok ? await resp.blob() : null;
          return blob && blob.type.startsWith('image/') ? blob : null;
        })
        .catch(() => null)
        .finally(() => this.inFlight.delete(url));
      this.inFlight.set(url, download);
    }
    const blob = await download;
    if (!blob) {
      this.deadLinks.add(url);
      return null;
    }
    const thumb = await makeThumbnail(blob).catch(() => null);
    await db.mediaBlobs.bulkPut(mediaIds.map((id) => ({ treeId, id, blob, ...(thumb ? { thumb } : {}) })));
    // People already on screen with this photo get it now (their first try may have found no image yet).
    for (const id of mediaIds) {
      const sig = this.avatarSignals.get(`${treeId}|${id}`);
      if (sig && !sig()) sig.set(this.cacheUrl(`thumb:${id}`, thumb ?? blob));
    }
    return thumb ?? blob;
  }

  /**
   * Downloads every photo of the tree that is only a web link (MyHeritage links expire about a week after export)
   * and stores the images in this browser, so the tree and its .gdz export no longer need the links.
   * A call while a download runs makes it look again for new links when it ends.
   */
  downloadLinked(treeId: string): Promise<LinkDownload> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      let result: LinkDownload = { total: 0, done: 0, failed: 0, running: false };
      do {
        this.again = false;
        result = await this.downloadOnce(treeId);
      } while (this.again);
      return result;
    })().finally(() => (this.running = null));
    return this.running;
  }

  private async downloadOnce(treeId: string): Promise<LinkDownload> {
    const [metas, keys] = await Promise.all([
      db.mediaMeta.where('[treeId+id]').between([treeId, MIN_ID], [treeId, MAX_ID]).toArray(),
      db.mediaBlobs.where('[treeId+id]').between([treeId, MIN_ID], [treeId, MAX_ID]).primaryKeys(),
    ]);
    const stored = new Set(keys.map((k) => k[1]));
    const byUrl = new Map<string, string[]>(); // one download per link, stored for every photo record with it
    for (const { data: m } of metas) {
      if (stored.has(m.id) || !m.file || !WEB.test(m.file) || this.deadLinks.has(m.file)) continue;
      byUrl.set(m.file, [...(byUrl.get(m.file) ?? []), m.id]);
    }
    const queue = [...byUrl];
    const progress: LinkDownload = { total: queue.length, done: 0, failed: 0, running: queue.length > 0 };
    if (!queue.length) return progress;
    this.linkDownload.set({ ...progress });
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const ok = await this.store(treeId, next[1], next[0]).catch(() => null);
        if (ok) progress.done++;
        else progress.failed++;
        this.linkDownload.set({ ...progress });
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    progress.running = false;
    this.linkDownload.set({ ...progress });
    return progress;
  }

  private cacheUrl(key: string, blob: Blob): string {
    const existing = this.urls.get(key);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    this.urls.set(key, url);
    return url;
  }

  /** Returns an object URL for the full-size photo blob, or null if not found. */
  async getPhotoUrl(treeId: string, mediaId: string): Promise<string | null> {
    if (this.urls.has(mediaId)) return this.urls.get(mediaId)!;
    const record = await db.mediaBlobs.get([treeId, mediaId]);
    if (!record?.blob) return null;
    const url = URL.createObjectURL(record.blob);
    this.urls.set(mediaId, url);
    return url;
  }

  /** Returns an object URL for the thumbnail blob, falling back to full photo. */
  async getThumbUrl(treeId: string, mediaId: string): Promise<string | null> {
    const thumbKey = `thumb:${mediaId}`;
    if (this.urls.has(thumbKey)) return this.urls.get(thumbKey)!;
    const record = await (db.mediaBlobs as any).get([treeId, mediaId]);
    const blob: Blob | undefined = record?.thumb ?? record?.blob;
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urls.set(thumbKey, url);
    return url;
  }

  /** Revokes all outstanding object URLs. Call when unloading a tree. */
  revokeAll(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  ngOnDestroy(): void { this.revokeAll(); }
}
