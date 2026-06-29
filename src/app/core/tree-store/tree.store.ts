import { Injectable, signal, computed } from '@angular/core';
import { Individual } from '../model/types';

export type ImportStatus =
  | { kind: 'idle' }
  | { kind: 'importing' }
  | { kind: 'success'; treeId: string; total: number; skipped: number; warnings: string[] }
  | { kind: 'error'; message: string };

@Injectable({ providedIn: 'root' })
export class TreeStore {
  readonly currentTreeId = signal<string | null>(null);
  readonly individuals = signal<Individual[]>([]);
  readonly importStatus = signal<ImportStatus>({ kind: 'idle' });

  readonly isEmpty = computed(() => this.individuals().length === 0);

  setIndividuals(people: Individual[]): void {
    this.individuals.set(people);
  }

  setTreeId(id: string): void {
    this.currentTreeId.set(id);
  }

  clearTree(): void {
    this.currentTreeId.set(null);
    this.individuals.set([]);
    this.importStatus.set({ kind: 'idle' });
  }
}
