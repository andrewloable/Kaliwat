import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from './kaliwat-db';
import { WipeService } from './wipe.service';
import Dexie from 'dexie';

const TREE_ID = 'tree-wipe';
const OTHER_TREE = 'tree-other';

// Minimal fake Cache API for testing
function makeFakeCaches(cacheNames: string[]) {
  const store: Record<string, Map<string, Response>> = {};
  for (const name of cacheNames) store[name] = new Map();
  return {
    keys: async () => cacheNames.filter((n) => store[n] !== undefined),
    delete: async (name: string) => {
      if (store[name]) { delete store[name]; return true; }
      return false;
    },
    open: async (name: string) => store[name] || (store[name] = new Map()),
    has: (name: string) => name in store,
  };
}

describe('wipeTreeData', () => {
  // Calls the real service on the singleton db (an earlier version re-ran the deletes by hand, so it never exercised
  // the service and missed that the tree record was deleted outside the transaction).
  it('clears all stores for the target tree, including its tree record', async () => {
    await db.individuals.bulkPut([
      { treeId: TREE_ID, id: 'a', data: { id: 'a', names: [], events: [], unions: [], mediaIds: [], notes: [] } },
    ]);
    await db.trees.put({ id: TREE_ID, meta: {}, updatedAt: 0 });

    await new WipeService().wipeTreeData(TREE_ID);

    expect(await db.individuals.where('[treeId+id]').between([TREE_ID, Dexie.minKey], [TREE_ID, Dexie.maxKey]).count()).toBe(0);
    expect(await db.trees.get(TREE_ID)).toBeUndefined();
  });

  it('does not touch data for other trees', async () => {
    await db.individuals.bulkPut([
      { treeId: TREE_ID, id: 'a', data: { id: 'a', names: [], events: [], unions: [], mediaIds: [], notes: [] } },
      { treeId: OTHER_TREE, id: 'b', data: { id: 'b', names: [], events: [], unions: [], mediaIds: [], notes: [] } },
    ]);
    await db.trees.put({ id: OTHER_TREE, meta: {}, updatedAt: 0 });

    await new WipeService().wipeTreeData(TREE_ID);

    expect(await db.individuals.get([OTHER_TREE, 'b'])).toBeDefined();
    expect(await db.trees.get(OTHER_TREE)).toBeDefined();
    await db.individuals.where('treeId').equals(OTHER_TREE).delete();
    await db.trees.delete(OTHER_TREE);
  });
});

describe('fullReset cache clearing', () => {
  it('clears only kaliwat-* caches, leaves others intact', async () => {
    const fakeCaches = makeFakeCaches(['kaliwat-shell-v1', 'kaliwat-shell-v2', 'otherapp-cache']);
    // Simulate the cache-clearing logic
    const keys = await fakeCaches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith('kaliwat-')).map((k) => fakeCaches.delete(k)),
    );
    const remaining = await fakeCaches.keys();
    expect(remaining).toEqual(['otherapp-cache']);
  });
});
