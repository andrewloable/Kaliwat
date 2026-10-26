import { Injectable, inject, signal } from '@angular/core';
import { db } from '../db/kaliwat-db';
import { PersistenceService } from '../db/persistence.service';
import { TreeStore } from '../tree-store/tree.store';
import { createParserClient } from '../../gedcom/parser/parser-client';
import { ParseResult } from '../../gedcom/parser/gedcom-parser';
import { UUID } from '../model/types';
import { readTreeFile, TreeFile } from '../import/read-tree-file';
import { planMerge, sideOf, recordsOf, MergePlan, MergeSide } from './merge-plan';
import { applyMerge, Choice, MergeSummary } from './merge-apply';
import { MediaService } from '../../media/media.service';

export interface MergePending {
  fileName: string;
  plan: MergePlan;
  current: MergeSide;
  incoming: MergeSide;
  blobs: TreeFile['mediaBlobs'];
  /** Media in the open tree that have a stored image. */
  currentImages: Set<UUID>;
  /** Photos already in the tree, without an image, that this file brings the image for. */
  fills: number;
  /** Added photos that are web links with no image inside the file (they load when shown). */
  webPhotos: number;
  /** Whether a test download of one of those links worked (null when there are none). */
  webPhotosWork: boolean | null;
}

/** What a merge did: the engine's counts plus the images stored for photos the tree already had. */
export type MergeOutcome = MergeSummary & { imagesFilled: number };

const MIN_ID = '';
const MAX_ID = '￿';
const BYTES_PER_INDIVIDUAL_ESTIMATE = 4096;

const WEB = /^https?:\/\//i;

/** Tries to download one photo link, the way the app shows web photos (it fetches them when shown). */
async function linkWorks(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return resp.ok && (resp.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  }
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Merges a picked .ged/.gdz into the open tree: preview() reads the file and plans the merge without writing
 * anything; apply() writes the result in one IndexedDB transaction, then refreshes the TreeStore.
 */
@Injectable({ providedIn: 'root' })
export class MergeService {
  private readonly store = inject(TreeStore);
  private readonly persistence = inject(PersistenceService);
  private readonly media = inject(MediaService);

  /** The worker parser; tests swap in parseGedcomBytes because workers do not run under vitest. */
  parse: (f: File) => Promise<ParseResult> = (f) => createParserClient().parse(f);

  readonly pending = signal<MergePending | null>(null);
  /** What the merge is doing right now, for the dialog ('' when idle). */
  readonly progress = signal('');

  async preview(file: File): Promise<{ plan: MergePlan } | { error: string }> {
    const treeId = this.store.currentTreeId();
    if (!treeId) return { error: 'Open a tree before merging.' };
    try {
      this.progress.set(`Reading ${file.name}…`);
      const read = await readTreeFile(file, this.parse, (done, total) => this.progress.set(`Preparing photos: ${done} of ${total}…`));
      if ('error' in read) return { error: read.error };

      const [metaRows, root, imageKeys] = await Promise.all([
        db.mediaMeta.where('[treeId+id]').between([treeId, MIN_ID], [treeId, MAX_ID]).toArray(),
        db.rawAst.get([treeId, 'root']),
        db.mediaBlobs.where('[treeId+id]').between([treeId, MIN_ID], [treeId, MAX_ID]).primaryKeys(),
      ]);
      const currentImages = new Set(imageKeys.map((k) => k[1]));
      const current: MergeSide = {
        individuals: this.store.individuals(),
        unions: this.store.unions(),
        media: metaRows.map((r) => r.data),
        records: recordsOf(root?.nodes ?? []),
      };
      const incoming = sideOf(read.model, read.ast);

      // Photo bytes decide sameness only when the file brought photos.
      let hashes: { current: Map<UUID, string>; incoming: Map<UUID, string> } | undefined;
      if (read.mediaBlobs.length) {
        this.progress.set('Comparing photos…');
        // ponytail: hashes every stored photo (~1 s for 700 photos); limit to the matched people's photos if it gets slow.
        const stored = await db.mediaBlobs.where('[treeId+id]').between([treeId, MIN_ID], [treeId, MAX_ID]).toArray();
        const paired = read.mediaBlobs.filter((m) => read.model.media.has(m.id));
        hashes = {
          current: new Map(await Promise.all(stored.map(async (r) => [r.id, await sha256(r.blob)] as const))),
          incoming: new Map(await Promise.all(paired.map(async (m) => [m.id, await sha256(m.blob)] as const))),
        };
      }

      // Images in the file, keyed by the photo record they belong to.
      const withImage = new Set(read.mediaBlobs.filter((b) => read.model.media.has(b.id)).map((b) => b.id));
      const plan = planMerge(current, incoming, hashes, { current: currentImages, incoming: withImage });

      // Images for photos the tree has only as a record (e.g. a web link that no longer works).
      const fills = new Set([...plan.mediaMatches].filter(([inc, cur]) => withImage.has(inc) && !currentImages.has(cur)).map(([, cur]) => cur)).size;

      // Added photos that are only web links: say so, and check that one of them can still be downloaded.
      const contested = plan.conflicts.filter((c) => c.incomingMediaId && !plan.mediaMatches.has(c.incomingMediaId)).map((c) => c.incomingMediaId!);
      const web = [...plan.newMedia, ...contested]
        .map((id) => read.model.media.get(id))
        .filter((m) => m && !withImage.has(m.id) && WEB.test(m.file ?? ''));
      let webPhotosWork: boolean | null = null;
      if (web.length) {
        this.progress.set('Checking photo links…');
        webPhotosWork = await linkWorks(web[0]!.file!);
      }

      this.pending.set({
        fileName: file.name, plan, current, incoming, blobs: read.mediaBlobs,
        currentImages, fills, webPhotos: web.length, webPhotosWork,
      });
      return { plan };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Could not read this file.' };
    } finally {
      this.progress.set('');
    }
  }

  async apply(choices: Map<string, Choice>): Promise<MergeOutcome | { error: string }> {
    const pending = this.pending();
    const treeId = this.store.currentTreeId();
    if (!pending || !treeId) return { error: 'Nothing to merge.' };
    try {
      const result = applyMerge(pending.current, pending.incoming, pending.plan, choices);
      const added = new Set(result.media.map((m) => m.id));
      // Images for added photos, and for photos already in the tree that have no image yet. One image per photo.
      const images = new Map<UUID, TreeFile['mediaBlobs'][number]>();
      for (const b of pending.blobs) {
        const target = result.mediaIdMap.get(b.id);
        if (target && !images.has(target) && (added.has(target) || !pending.currentImages.has(target))) images.set(target, b);
      }
      const blobs = [...images.entries()];
      const imagesFilled = blobs.filter(([target]) => !added.has(target)).length;

      const quota = await this.persistence.estimateQuota();
      const needed = BYTES_PER_INDIVIDUAL_ESTIMATE * result.summary.peopleAdded
        + blobs.reduce((n, [, b]) => n + b.blob.size + (b.thumb?.size ?? 0), 0);
      if (quota && needed > quota.quota - quota.usage) {
        return { error: 'Not enough storage space in this browser for this merge.' };
      }

      // One transaction: a failure leaves the stored tree as it was.
      this.progress.set(`Saving ${result.individuals.length} people${blobs.length ? ` and ${blobs.length} ${blobs.length === 1 ? 'photo' : 'photos'}` : ''}…`);
      await db.transaction(
        'rw',
        [db.trees, db.individuals, db.unions, db.rawAst, db.mediaMeta, db.mediaBlobs],
        async () => {
          const root = (await db.rawAst.get([treeId, 'root']))?.nodes ?? [];
          const tree = await db.trees.get(treeId);
          await db.individuals.bulkPut(result.individuals.map((data) => ({ treeId, id: data.id, data })));
          await db.unions.bulkPut(result.unions.map((data) => ({ treeId, id: data.id, data })));
          if (result.media.length) await db.mediaMeta.bulkPut(result.media.map((data) => ({ treeId, id: data.id, data })));
          if (blobs.length) {
            await db.mediaBlobs.bulkPut(blobs.map(([id, b]) => ({
              treeId, id, blob: b.blob, ...(b.thumb ? { thumb: b.thumb } : {}),
            })));
          }
          // The export takes HEAD and the other records from here; people and families come from the store.
          const kept = root.filter((n) => ['HEAD', 'INDI', 'FAM'].includes(n.tag));
          await db.rawAst.put({ treeId, id: 'root', nodes: [...kept, ...result.records, { level: 0, tag: 'TRLR', children: [] }] });
          await db.trees.put({ id: treeId, meta: tree?.meta ?? {}, updatedAt: Date.now() });
        },
      );

      this.store.setIndividuals(result.individuals);
      this.store.setUnions(result.unions);
      this.pending.set(null);
      // Photos that came in as links: store the images now, while the links work.
      void this.media.downloadLinked(treeId);
      return { ...result.summary, imagesFilled };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'The merge failed; the tree was not changed.' };
    } finally {
      this.progress.set('');
    }
  }

  cancel(): void {
    this.pending.set(null);
  }
}
