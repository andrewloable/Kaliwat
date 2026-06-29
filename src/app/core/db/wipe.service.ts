import { Injectable } from '@angular/core';
import { db } from './kaliwat-db';
import Dexie from 'dexie';

const KALIWAT_CACHE_PREFIX = 'kaliwat-';

@Injectable({ providedIn: 'root' })
export class WipeService {
  async wipeTreeData(treeId: string): Promise<void> {
    const tables: Dexie.Table<any, any>[] = [
      db.individuals as unknown as Dexie.Table<any, any>,
      db.unions as unknown as Dexie.Table<any, any>,
      db.mediaMeta as unknown as Dexie.Table<any, any>,
      db.mediaBlobs as unknown as Dexie.Table<any, any>,
      db.rawAst as unknown as Dexie.Table<any, any>,
    ];
    await db.transaction('rw', tables, async () => {
      await Promise.all(
        tables.map((t) =>
          t.where('[treeId+id]').between([treeId, Dexie.minKey], [treeId, Dexie.maxKey]).delete(),
        ),
      );
      await db.trees.delete(treeId);
    });
  }

  async fullReset(treeId: string): Promise<void> {
    await this.wipeTreeData(treeId);
    await this._clearKaliwatCaches();
  }

  private async _clearKaliwatCaches(): Promise<void> {
    if (typeof caches === 'undefined') return;
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith(KALIWAT_CACHE_PREFIX)).map((k) => caches.delete(k)),
    );
  }
}
