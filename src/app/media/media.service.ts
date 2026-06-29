import { Injectable, OnDestroy, signal, Signal, WritableSignal } from '@angular/core';
import { db } from '../core/db/kaliwat-db';
import { makeThumbnail } from '../gedcom/gedzip/gedzip';

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

  /**
   * A person's primary photo as a signal of a local object URL (null until
   * resolved / when none). Resolution order: cached blob in IndexedDB → fetch
   * the remote OBJE URL once (CORS-permitting), thumbnail it, store the blob,
   * then serve from that local blob. The view only ever renders a blob: URL —
   * never a remote <img> — so display stays offline and within img-src.
   * Fetch is lazy (on first view), so a 2000-person tree only pulls the photos
   * actually looked at.
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
    if (!url || !/^https?:\/\//i.test(url)) return null;

    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (!blob.type.startsWith('image/')) return null;
    const thumb = await makeThumbnail(blob).catch(() => null);
    await db.mediaBlobs.put({ treeId, id: mediaId, blob, ...(thumb ? { thumb } : {}) });
    return this.cacheUrl(`thumb:${mediaId}`, thumb ?? blob);
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
