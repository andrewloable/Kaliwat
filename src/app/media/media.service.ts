import { Injectable, OnDestroy } from '@angular/core';
import { db } from '../core/db/kaliwat-db';

/**
 * Manages photo Blobs and their Object URLs.
 * URLs are created lazily on request and revoked in bulk when the service
 * is destroyed (i.e., on navigation away), not per-item. This prevents
 * broken images during d3 pan/zoom or CDK virtual-scroll recycling.
 */
@Injectable({ providedIn: 'root' })
export class MediaService implements OnDestroy {
  private readonly urls = new Map<string, string>(); // mediaId → objectURL

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
