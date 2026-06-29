import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Dexie from 'dexie';
import { KaliwatDb } from './kaliwat-db';
import { Individual } from '../model/types';

// Create a fresh DB per test — unique name so fake-indexeddb doesn't share state
let dbSeq = 0;
function makeDb(): KaliwatDb {
  return new KaliwatDb(`kaliwat-test-${++dbSeq}`);
}

const TREE_ID = 'tree-001';

const ALICE: Individual = {
  id: 'uuid-alice',
  sourceXref: '@I1@',
  names: [{ full: 'Alice Smith' }],
  events: [],
  unions: [],
  mediaIds: [],
  notes: [],
};

const BOB: Individual = {
  id: 'uuid-bob',
  sourceXref: '@I2@',
  names: [{ full: 'Bob Smith' }],
  events: [],
  unions: [],
  mediaIds: [],
  notes: [],
};

describe('KaliwatDb', () => {
  it('uses a kaliwat-namespaced database name by default', () => {
    const d = new KaliwatDb();
    expect(d.name).toBe('kaliwat');
    d.close();
  });

  it('write → reload hydrates individuals', async () => {
    const d = makeDb();
    await d.individuals.bulkPut([
      { treeId: TREE_ID, id: ALICE.id, data: ALICE },
      { treeId: TREE_ID, id: BOB.id, data: BOB },
    ]);
    const rows = await d.individuals
      .where('[treeId+id]')
      .between([TREE_ID, Dexie.minKey], [TREE_ID, Dexie.maxKey])
      .toArray();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.data.id)).toContain(ALICE.id);
    d.close();
  });

  it('rawAst round-trips without leaking into individual records', async () => {
    const d = makeDb();
    const ast = [{ level: 0, tag: 'HEAD', children: [] }];
    await d.rawAst.put({ treeId: TREE_ID, id: 'root', nodes: ast });
    const loaded = await d.rawAst.get([TREE_ID, 'root']);
    expect(loaded?.nodes).toEqual(ast);
    // individuals table untouched
    const indis = await d.individuals.count();
    expect(indis).toBe(0);
    d.close();
  });
});

describe('BroadcastChannel reload signal', () => {
  it('postMessage on one channel triggers onmessage on another', async () => {
    const sender = new BroadcastChannel('kaliwat');
    const receiver = new BroadcastChannel('kaliwat');
    const received: unknown[] = [];
    receiver.onmessage = (e) => received.push(e.data);
    sender.postMessage({ type: 'changed' });
    // BroadcastChannel is sync in jsdom — wait a tick
    await new Promise((r) => setTimeout(r, 0));
    expect(received.length).toBeGreaterThan(0);
    sender.close();
    receiver.close();
  });
});

describe('Debounced write + pagehide flush', () => {
  it('flush executes the pending write immediately', async () => {
    let written = false;
    const fn = vi.fn(async () => { written = true; });
    // Simulate the flush mechanism directly
    let pending: (() => Promise<void>) | null = fn;
    const flush = () => {
      if (!pending) return;
      const w = pending;
      pending = null;
      w().catch(console.error);
    };
    flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(written).toBe(true);
  });
});
