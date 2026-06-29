import { Injectable } from '@angular/core';
import { db } from '../db/kaliwat-db';
import { PersistenceService } from '../db/persistence.service';
import { TreeStore } from '../tree-store/tree.store';
import { createParserClient } from '../../gedcom/parser/parser-client';
import { normalizeAst } from '../../gedcom/normalize/normalizer';
import { importGedzip } from '../../gedcom/gedzip/gedzip';
import { GedcomNode } from '../model/types';

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
  constructor(
    private readonly persistence: PersistenceService,
    private readonly store: TreeStore,
  ) {}

  async importFile(file: File): Promise<ImportOutcome> {
    this.store.importStatus.set({ kind: 'importing' });

    try {
      let gedcomFile: File;
      let mediaBlobs: { path: string; id: string; blob: Blob; thumb: Blob | null }[] = [];

      // Unpack .gdz archives first
      if (file.name.toLowerCase().endsWith('.gdz')) {
        const result = await importGedzip(file);
        if ('error' in result) {
          this.store.importStatus.set({ kind: 'error', message: result.error });
          return { status: 'error', message: result.error };
        }
        gedcomFile = new File([result.gedcomBytes], 'gedcom.ged', { type: 'text/plain' });
        // Pair media entries with placeholder IDs (real IDs assigned after normalize)
        mediaBlobs = result.media.map((m, i) => ({
          path: m.path, id: `media-${i}`, blob: m.blob, thumb: m.thumb,
        }));
      } else {
        gedcomFile = file;
      }

      // Phase 1: Parse in worker
      const client = createParserClient();
      const parseResult = await client.parse(gedcomFile);

      if (parseResult.aborted) {
        const msg = parseResult.report[0]?.message ?? 'File too large or parse aborted';
        this.store.importStatus.set({ kind: 'error', message: msg });
        return { status: 'aborted', message: msg };
      }

      // Phase 2: Normalize in memory (staging)
      const { model, report: normalizeReport } = normalizeAst(parseResult.ast);
      const individuals = [...model.individuals.values()];
      const unions = [...model.unions.values()];
      const mediaObjects = [...model.media.values()];

      // Match extracted blobs to MediaObject IDs by FILE path
      for (const m of mediaBlobs) {
        const mo = mediaObjects.find(o => o.file === m.path || o.file?.endsWith(m.path) || m.path.endsWith(o.file ?? ''));
        if (mo) m.id = mo.id;
      }

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
          await db.rawAst.put({ treeId, id: 'root', nodes: parseResult.ast as GedcomNode[] });
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

      await this.persistence.requestPersistence();

      const warnings = [
        ...parseResult.report.map(r => r.message),
        ...normalizeReport.orphanPointers.map(p => `Orphan pointer: ${p}`),
        ...normalizeReport.warnings,
      ];
      const report: ImportReport = {
        total: individuals.length,
        skipped: parseResult.report.length + normalizeReport.orphanPointers.length,
        warnings,
      };

      this.store.setTreeId(treeId);
      this.store.setIndividuals(individuals);
      this.store.setUnions(unions);
      this.store.importStatus.set({ kind: 'success', treeId, total: report.total, skipped: report.skipped, warnings });

      return { status: 'success', treeId, report };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed';
      this.store.importStatus.set({ kind: 'error', message: msg });
      return { status: 'error', message: msg };
    }
  }
}
