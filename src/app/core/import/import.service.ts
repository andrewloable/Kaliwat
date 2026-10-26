import { Injectable, inject } from '@angular/core';
import { db } from '../db/kaliwat-db';
import { PersistenceService } from '../db/persistence.service';
import { TreeStore } from '../tree-store/tree.store';
import { createParserClient } from '../../gedcom/parser/parser-client';
import { readTreeFile } from './read-tree-file';
import { MediaService } from '../../media/media.service';

export interface ImportReport {
  total: number;
  skipped: number;
  warnings: string[];
}

export type ImportOutcome =
  | { status: 'success'; treeId: string; report: ImportReport }
  | { status: 'aborted'; message: string }
  | { status: 'quota-warning'; available: number; needed: number }
  | { status: 'error'; message: string };

const BYTES_PER_INDIVIDUAL_ESTIMATE = 4096;

@Injectable({ providedIn: 'root' })
export class ImportService {
  private readonly media = inject(MediaService);

  constructor(
    private readonly persistence: PersistenceService,
    private readonly store: TreeStore,
  ) {}

  async importFile(file: File): Promise<ImportOutcome> {
    this.store.importStatus.set({ kind: 'importing' });

    try {
      // Phases 1-2: unpack, parse in a worker, normalize in memory (staging)
      const read = await readTreeFile(file, (f) => createParserClient().parse(f));
      if ('error' in read) {
        this.store.importStatus.set({ kind: 'error', message: read.error });
        return read.aborted ? { status: 'aborted', message: read.error } : { status: 'error', message: read.error };
      }
      const { model, mediaBlobs } = read;
      const individuals = [...model.individuals.values()];
      const unions = [...model.unions.values()];
      const mediaObjects = [...model.media.values()];

      // Phase 3: Quota check
      const quota = await this.persistence.estimateQuota();
      if (quota) {
        const needed = individuals.length * BYTES_PER_INDIVIDUAL_ESTIMATE;
        const available = quota.quota - quota.usage;
        if (needed > available) {
          this.store.importStatus.set({ kind: 'error', message: 'Insufficient storage quota' });
          return { status: 'quota-warning', available, needed };
        }
      }

      // Phase 4: Atomic commit to Dexie
      const treeId = model.id;
      await db.transaction(
        'rw',
        [db.trees, db.individuals, db.unions, db.rawAst, db.mediaMeta, db.mediaBlobs],
        async () => {
          await db.trees.put({ id: treeId, meta: model.meta as Record<string, unknown>, updatedAt: Date.now() });
          await db.rawAst.put({ treeId, id: 'root', nodes: read.ast });
          await db.individuals.bulkPut(individuals.map(d => ({ treeId, id: d.id, data: d })));
          await db.unions.bulkPut(unions.map(d => ({ treeId, id: d.id, data: d })));
          if (mediaObjects.length) {
            await db.mediaMeta.bulkPut(mediaObjects.map(d => ({ treeId, id: d.id, data: d })));
          }
          if (mediaBlobs.length) {
            await db.mediaBlobs.bulkPut(mediaBlobs.map(m => ({
              treeId, id: m.id, blob: m.blob, ...(m.thumb ? { thumb: m.thumb } : {}),
            })));
          }
        },
      );

      // Not awaited: Firefox leaves persist() pending until the user answers its prompt,
      // which would hang the import on "Importing…".
      void this.persistence.requestPersistence().catch(() => undefined);

      const { warnings } = read;
      const report: ImportReport = {
        total: individuals.length,
        skipped: read.skipped,
        warnings,
      };

      this.store.setTreeId(treeId);
      this.store.setIndividuals(individuals);
      this.store.setUnions(unions);
      this.store.importStatus.set({ kind: 'success', treeId, total: report.total, skipped: report.skipped, warnings });
      // Photo links (MyHeritage's expire about a week after export): store the images now, while the links work.
      void this.media.downloadLinked(treeId);

      return { status: 'success', treeId, report };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed';
      this.store.importStatus.set({ kind: 'error', message: msg });
      return { status: 'error', message: msg };
    }
  }
}
