import { Injectable } from '@angular/core';
import { db } from '../db/kaliwat-db';
import { PersistenceService } from '../db/persistence.service';
import { TreeStore } from '../tree-store/tree.store';
import { createParserClient } from '../../gedcom/parser/parser-client';
import { normalizeAst } from '../../gedcom/normalize/normalizer';
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

const BYTES_PER_INDIVIDUAL_ESTIMATE = 4096; // conservative per-record estimate

@Injectable({ providedIn: 'root' })
export class ImportService {
  constructor(
    private readonly persistence: PersistenceService,
    private readonly store: TreeStore,
  ) {}

  async importFile(file: File): Promise<ImportOutcome> {
    this.store.importStatus.set({ kind: 'importing' });

    try {
      // Phase 1: Parse in worker
      const client = createParserClient();
      const parseResult = await client.parse(file);

      if (parseResult.aborted) {
        const msg = parseResult.report[0]?.message ?? 'File too large or parse aborted';
        this.store.importStatus.set({ kind: 'error', message: msg });
        return { status: 'aborted', message: msg };
      }

      // Phase 2: Normalize in memory (staging)
      const { model, report: normalizeReport } = normalizeAst(parseResult.ast);
      const individuals = [...model.individuals.values()];
      const unions = [...model.unions.values()];

      // Phase 3: Quota check before any write
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
        [db.trees, db.individuals, db.unions, db.rawAst],
        async () => {
          await db.trees.put({ id: treeId, meta: model.meta as Record<string, unknown>, updatedAt: Date.now() });
          await db.rawAst.put({ treeId, id: 'root', nodes: parseResult.ast as GedcomNode[] });
          await db.individuals.bulkPut(individuals.map((d) => ({ treeId, id: d.id, data: d })));
          await db.unions.bulkPut(unions.map((d) => ({ treeId, id: d.id, data: d })));
        },
      );

      // Request durable storage after first successful write
      await this.persistence.requestPersistence();

      const warnings = [
        ...parseResult.report.map((r) => r.message),
        ...normalizeReport.orphanPointers.map((p) => `Orphan pointer: ${p}`),
        ...normalizeReport.warnings,
      ];
      const report: ImportReport = {
        total: individuals.length,
        skipped: parseResult.report.length + normalizeReport.orphanPointers.length,
        warnings,
      };

      // Update store
      this.store.setTreeId(treeId);
      this.store.setIndividuals(individuals);
      this.store.importStatus.set({ kind: 'success', treeId, total: report.total, skipped: report.skipped, warnings });

      return { status: 'success', treeId, report };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed';
      this.store.importStatus.set({ kind: 'error', message: msg });
      return { status: 'error', message: msg };
    }
  }
}
