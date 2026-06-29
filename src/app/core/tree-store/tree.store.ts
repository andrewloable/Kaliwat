import { Injectable, signal, computed } from '@angular/core';
import { Individual, Union, UUID } from '../model/types';

export type ImportStatus =
  | { kind: 'idle' }
  | { kind: 'importing' }
  | { kind: 'success'; treeId: string; total: number; skipped: number; warnings: string[] }
  | { kind: 'error'; message: string };

@Injectable({ providedIn: 'root' })
export class TreeStore {
  readonly currentTreeId = signal<string | null>(null);
  readonly individuals = signal<Individual[]>([]);
  readonly unions = signal<Union[]>([]);
  readonly importStatus = signal<ImportStatus>({ kind: 'idle' });

  readonly isEmpty = computed(() => this.individuals().length === 0);

  setIndividuals(people: Individual[]): void {
    this.individuals.set(people);
  }

  setUnions(unions: Union[]): void {
    this.unions.set(unions);
  }

  setTreeId(id: string): void {
    this.currentTreeId.set(id);
  }

  clearTree(): void {
    this.currentTreeId.set(null);
    this.individuals.set([]);
    this.unions.set([]);
    this.importStatus.set({ kind: 'idle' });
  }

  upsertIndividual(indi: Individual): void {
    this.individuals.update(all => {
      const idx = all.findIndex(i => i.id === indi.id);
      return idx >= 0 ? all.map(i => i.id === indi.id ? indi : i) : [...all, indi];
    });
  }

  upsertUnion(union: Union): void {
    this.unions.update(all => {
      const idx = all.findIndex(u => u.id === union.id);
      return idx >= 0 ? all.map(u => u.id === union.id ? union : u) : [...all, union];
    });
  }

  /** Returns all ancestor IDs of personId (for cycle detection). */
  ancestorIds(personId: UUID): Set<UUID> {
    const result = new Set<UUID>();
    const queue: UUID[] = [personId];
    const unions = this.unions();
    while (queue.length) {
      const id = queue.shift()!;
      if (result.has(id)) continue;
      result.add(id);
      for (const u of unions) {
        if (u.childLinks.some(c => c.childId === id)) {
          queue.push(...u.spouseIds);
        }
      }
    }
    result.delete(personId); // exclude self
    return result;
  }
}
