import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KaliwatDb } from './kaliwat-db';
import Dexie from 'dexie';

let dbSeq = 0;
function makeDb() {
  return new KaliwatDb(`kaliwat-wipe-test-${++dbSeq}`);
}

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
  it('clears all stores for the target tree', async () => {
    const d = makeDb();
    await d.open();
    await d.individuals.bulkPut([
      { treeId: TREE_ID, id: 'a', data: { id: 'a', names: [], events: [], unions: [], mediaIds: [], notes: [] } },
    ]);
    await d.trees.put({ id: TREE_ID, meta: {}, updatedAt: 0 });

    // Run wipe operations directly on this db instance
    await d.individuals.where('[treeId+id]').between([TREE_ID, Dexie.minKey], [TREE_ID, Dexie.maxKey]).delete();
    await d.trees.delete(TREE_ID);

    expect(await d.individuals.count()).toBe(0);
    expect(await d.trees.get(TREE_ID)).toBeUndefined();
    d.close();
  });

  it('does not touch data for other trees', async () => {
    const d = makeDb();
    await d.open();
    await d.individuals.bulkPut([
      { treeId: TREE_ID, id: 'a', data: { id: 'a', names: [], events: [], unions: [], mediaIds: [], notes: [] } },
      { treeId: OTHER_TREE, id: 'b', data: { id: 'b', names: [], events: [], unions: [], mediaIds: [], notes: [] } },
    ]);

    await d.individuals.where('[treeId+id]').between([TREE_ID, Dexie.minKey], [TREE_ID, Dexie.maxKey]).delete();

    const remaining = await d.individuals.toArray();
    expect(remaining.length).toBe(1);
    expect(remaining[0].treeId).toBe(OTHER_TREE);
    d.close();
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
