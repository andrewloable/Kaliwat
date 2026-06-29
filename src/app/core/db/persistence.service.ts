import { Injectable, signal, OnDestroy } from '@angular/core';
import Dexie from 'dexie';
import { db, KaliwatDb } from './kaliwat-db';
import { GedcomNode, Individual, Union, MediaObject } from '../model/types';

const DEBOUNCE_MS = 300;
const BROADCAST_CHANNEL = 'kaliwat';

export type StorageGrantState = 'unknown' | 'granted' | 'denied';

export interface QuotaEstimate {
  usage: number;
  quota: number;
}

@Injectable({ providedIn: 'root' })
export class PersistenceService implements OnDestroy {
  readonly storageGrant = signal<StorageGrantState>('unknown');
  readonly reloadSignal = signal<number>(0);

  private readonly _db: KaliwatDb = db;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingWrite: (() => Promise<void>) | null = null;
  private readonly _channel = new BroadcastChannel(BROADCAST_CHANNEL);
  private readonly _onVisibility: () => void;
  private readonly _onPagehide: () => void;

  constructor() {
    this._channel.onmessage = () => {
      this.reloadSignal.update((v) => v + 1);
    };

    this._onVisibility = () => {
      if (document.visibilityState === 'hidden') this._flush();
    };
    this._onPagehide = () => this._flush();

    document.addEventListener('visibilitychange', this._onVisibility);
    window.addEventListener('pagehide', this._onPagehide);
  }

  ngOnDestroy(): void {
    this._flush();
    this._channel.close();
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.removeEventListener('pagehide', this._onPagehide);
  }

  // Request durable storage on first write; updates grant signal
  async requestPersistence(): Promise<void> {
    if (!navigator.storage?.persist) return;
    const granted = await navigator.storage.persist();
    this.storageGrant.set(granted ? 'granted' : 'denied');
  }

  async estimateQuota(): Promise<QuotaEstimate | null> {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  }

  // Schedule a debounced write; also triggers requestPersistence on first call
  scheduleWrite(fn: () => Promise<void>): void {
    this._pendingWrite = fn;
    if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._flush(), DEBOUNCE_MS);
  }

  private _flush(): void {
    if (!this._pendingWrite) return;
    const write = this._pendingWrite;
    this._pendingWrite = null;
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    write()
      .then(() => this._channel.postMessage({ type: 'changed' }))
      .catch(console.error);
  }

  // Tree-level operations
  async saveIndividuals(treeId: string, individuals: Individual[]): Promise<void> {
    await this._db.individuals.bulkPut(
      individuals.map((data) => ({ treeId, id: data.id, data })),
    );
  }

  async loadIndividuals(treeId: string): Promise<Individual[]> {
    const rows = await this._db.individuals.where('[treeId+id]').between(
      [treeId, Dexie.minKey],
      [treeId, Dexie.maxKey],
    ).toArray();
    return rows.map((r) => r.data);
  }

  async saveUnions(treeId: string, unions: Union[]): Promise<void> {
    await this._db.unions.bulkPut(unions.map((data) => ({ treeId, id: data.id, data })));
  }

  async loadUnions(treeId: string): Promise<Union[]> {
    const rows = await this._db.unions.where('[treeId+id]').between(
      [treeId, Dexie.minKey],
      [treeId, Dexie.maxKey],
    ).toArray();
    return rows.map((r) => r.data);
  }

  async saveMedia(treeId: string, media: MediaObject[]): Promise<void> {
    await this._db.mediaMeta.bulkPut(media.map((data) => ({ treeId, id: data.id, data })));
  }

  // Raw AST lives in Dexie only — not in signals
  async saveRawAst(treeId: string, nodes: GedcomNode[]): Promise<void> {
    await this._db.rawAst.put({ treeId, id: 'root', nodes });
  }

  async loadRawAst(treeId: string): Promise<GedcomNode[]> {
    const row = await this._db.rawAst.get([treeId, 'root']);
    return row?.nodes ?? [];
  }

  async clearTree(treeId: string): Promise<void> {
    await this._db.transaction(
      'rw',
      [this._db.individuals, this._db.unions, this._db.mediaMeta, this._db.mediaBlobs, this._db.rawAst],
      async () => {
        // ponytail: cast to any — Dexie's KeyPaths<T> hits circular ref on GedcomNode.children
        const delRange = (t: Dexie.Table<any, any>) =>
          t.where('[treeId+id]').between([treeId, Dexie.minKey], [treeId, Dexie.maxKey]).delete();
        const tables: Dexie.Table<any, any>[] = [
          this._db.individuals as unknown as Dexie.Table<any, any>,
          this._db.unions as unknown as Dexie.Table<any, any>,
          this._db.mediaMeta as unknown as Dexie.Table<any, any>,
          this._db.mediaBlobs as unknown as Dexie.Table<any, any>,
          this._db.rawAst as unknown as Dexie.Table<any, any>,
        ];
        await Promise.all(tables.map(delRange));
        await this._db.trees.delete(treeId);
      },
    );
  }
}
