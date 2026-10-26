import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { MergeService } from './merge.service';
import { Choice } from './merge-apply';
import { MergePlan } from './merge-plan';
import { TreeStore } from '../tree-store/tree.store';
import { PersistenceService } from '../db/persistence.service';
import { db } from '../db/kaliwat-db';
import { parseGedcomBytes } from '../../gedcom/parser/gedcom-parser';
import { normalizeAst } from '../../gedcom/normalize/normalizer';
import { exportGedzip } from '../../gedcom/gedzip/gedzip';
import type { GedcomNode, Individual } from '../model/types';

// jsdom's Blob has no arrayBuffer() (browsers have it); read through FileReader in tests.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(this);
    });
  };
}

async function fixture(name: string): Promise<string> {
  // @ts-expect-error node built-in: the project has no node types, the test runner still provides it
  const fs = await import('node:fs');
  return fs.readFileSync(`test/fixtures/${name}`, 'utf8');
}
const bytes = (...b: number[]) => new Blob([new Uint8Array(b)], { type: 'image/jpeg' });
const rowsOf = <T>(table: { where(k: string): { between(a: unknown[], b: unknown[]): { toArray(): Promise<T[]> } } }, treeId: string) =>
  table.where('[treeId+id]').between([treeId, ''], [treeId, '￿']).toArray();
const named = (people: Individual[], name: string) => people.find((p) => p.names[0]?.full === name)!;

let treeSeq = 0;

describe('MergeService', () => {
  let service: MergeService;
  let store: TreeStore;
  let treeId: string;

  /** Loads merge-current.ged as the open tree, the way ImportService stores an import. */
  async function seed(): Promise<void> {
    const ast = parseGedcomBytes(new TextEncoder().encode(await fixture('merge-current.ged'))).ast as GedcomNode[];
    const { model } = normalizeAst(ast);
    const individuals = [...model.individuals.values()], unions = [...model.unions.values()], media = [...model.media.values()];
    await db.trees.put({ id: treeId, meta: model.meta as Record<string, unknown>, updatedAt: 1 });
    await db.rawAst.put({ treeId, id: 'root', nodes: ast });
    await db.individuals.bulkPut(individuals.map((data) => ({ treeId, id: data.id, data })));
    await db.unions.bulkPut(unions.map((data) => ({ treeId, id: data.id, data })));
    await db.mediaMeta.bulkPut(media.map((data) => ({ treeId, id: data.id, data })));
    store.setTreeId(treeId);
    store.setIndividuals(individuals);
    store.setUnions(unions);
  }
  const incomingGed = async () => new File([await fixture('merge-incoming.ged')], 'merge-incoming.ged');
  const incomingGdz = async (entries: { path: string; blob: Blob }[]) =>
    new File([await exportGedzip(await fixture('merge-incoming.ged'), entries)], 'merge-incoming.gdz');
  /** Choices "A": Juan's birth from the file, the Lito/Ana marriage kept, Maria's photo from the file. */
  const choicesA = (plan: MergePlan) => {
    const key = (tag: string) => plan.conflicts.find((c) => c.tag === tag)!.key;
    return new Map<string, Choice>([[key('BIRT'), 'incoming'], [key('MARR'), 'current'], [key('OBJE'), 'incoming']]);
  };
  const preview = async (file: File) => {
    const r = await service.preview(file);
    if ('error' in r) throw new Error(r.error);
    return r.plan;
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PersistenceService, useValue: { scheduleWrite: vi.fn(), estimateQuota: vi.fn(async () => null) } }],
    });
    service = TestBed.inject(MergeService);
    store = TestBed.inject(TreeStore);
    service.parse = async (f) => parseGedcomBytes(new Uint8Array(await f.arrayBuffer()));
    treeId = `merge-tree-${++treeSeq}`;
  });

  it('preview plans without writing', async () => {
    await seed();
    const plan = await preview(await incomingGed());
    expect(plan.newPeople).toHaveLength(2);
    expect(plan.conflicts).toHaveLength(3);
    expect(await rowsOf(db.individuals, treeId)).toHaveLength(6);
    expect(service.pending()?.fileName).toBe('merge-incoming.ged');
  });

  it('apply writes everything and refreshes the store', async () => {
    await seed();
    const plan = await preview(await incomingGed());
    const summary = await service.apply(choicesA(plan));
    expect(summary).toMatchObject({ peopleAdded: 2, familiesAdded: 1 });
    expect(store.individuals()).toHaveLength(8);
    const stored = (await rowsOf<{ data: Individual }>(db.individuals, treeId)).map((r) => r.data);
    expect(stored).toHaveLength(8);
    expect(await rowsOf(db.unions, treeId)).toHaveLength(3);
    expect(named(stored, 'Juan Santos').events.find((e) => e.type === 'BIRT')!.date).toBe('2 JAN 1950');
    expect(named(stored, 'Rosa Santos').rawRef).toBeTruthy();
    const root = (await db.rawAst.get([treeId, 'root']))!.nodes;
    expect(root.some((n) => n.tag === 'SOUR' && n.children.some((c) => c.tag === 'TITL' && c.value === 'Civil registry'))).toBe(true);
    expect(root.filter((n) => n.tag === 'HEAD')).toHaveLength(1);
    expect(root[root.length - 1].tag).toBe('TRLR');
    expect(service.pending()).toBeNull();
  });

  it('a .gdz photo is stored under the merged id', async () => {
    await seed();
    const plan = await preview(await incomingGdz([{ path: 'media/rosa.jpg', blob: bytes(1, 2, 3) }]));
    // fake-indexeddb under jsdom does not keep a Blob intact, so check what was written as well as the stored row.
    const put = vi.spyOn(db.mediaBlobs, 'bulkPut');
    await service.apply(choicesA(plan));
    const rosa = named(store.individuals(), 'Rosa Santos');
    const written = put.mock.calls.flatMap(([rows]) => [...rows]);
    put.mockRestore();
    expect(written.map((r) => [r.id, r.blob.size])).toEqual([[rosa.mediaIds[0], 3]]);
    expect(await db.mediaBlobs.get([treeId, rosa.mediaIds[0]])).toBeDefined();
    expect((await db.mediaMeta.get([treeId, rosa.mediaIds[0]]))?.data.file).toBe('media/rosa.jpg');
  });

  it('the same photo bytes under another file name is not a conflict', async () => {
    await seed();
    // The stored photo of Maria, served as a real Blob (fake-indexeddb under jsdom would not return one).
    const maria = named(store.individuals(), 'Maria Reyes').mediaIds[0];
    const stored = [{ treeId, id: maria, blob: bytes(9, 9, 9) }];
    const where = vi.spyOn(db.mediaBlobs, 'where').mockReturnValue({
      between: () => ({ toArray: async () => stored, primaryKeys: async () => stored.map((r) => [r.treeId, r.id]) }),
    } as never);
    const plan = await preview(await incomingGdz([{ path: 'media/maria-b.jpg', blob: bytes(9, 9, 9) }])).finally(() => where.mockRestore());
    expect(plan.conflicts).toHaveLength(2);
    expect(plan.conflicts.map((c) => c.tag)).not.toContain('OBJE');
  });

  it('cancel drops the pending merge', async () => {
    await seed();
    await preview(await incomingGed());
    service.cancel();
    expect(service.pending()).toBeNull();
    expect(await service.apply(new Map())).toEqual({ error: 'Nothing to merge.' });
  });

  it('an image for a photo already in the tree without one is stored', async () => {
    await seed();
    const maria = named(store.individuals(), 'Maria Reyes').mediaIds[0];
    const same = new File([await exportGedzip(await fixture('merge-current.ged'), [{ path: 'media/maria-a.jpg', blob: bytes(7, 7, 7, 7) }])], 'same.gdz');
    await preview(same);
    expect(service.pending()!.fills).toBe(1);
    const put = vi.spyOn(db.mediaBlobs, 'bulkPut');
    const outcome = await service.apply(new Map());
    const written = put.mock.calls.flatMap(([rows]) => [...rows]);
    put.mockRestore();
    expect(written.map((r) => [r.id, r.blob.size])).toEqual([[maria, 4]]);
    expect(outcome).toMatchObject({ peopleAdded: 0, photosAdded: 0, imagesFilled: 1 });
  });

  it('web-link photos are counted and one link is tested', async () => {
    await seed();
    const text = (await fixture('merge-incoming.ged')).replace('2 FILE media/rosa.jpg', '2 FILE https://example.invalid/rosa.jpg');
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetch);
    try {
      await preview(new File([text], 'links.ged'));
      expect(fetch).toHaveBeenCalledWith('https://example.invalid/rosa.jpg', expect.anything());
      expect(service.pending()).toMatchObject({ webPhotos: 1, webPhotosWork: false });

      fetch.mockImplementation(async () => ({ ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }) }) as unknown as never);
      await preview(new File([text], 'links.ged'));
      expect(service.pending()).toMatchObject({ webPhotos: 1, webPhotosWork: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a file without web-link photos tests no link', async () => {
    await seed();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      await preview(await incomingGed());
      expect(fetch).not.toHaveBeenCalled();
      expect(service.pending()).toMatchObject({ webPhotos: 0, webPhotosWork: null, fills: 0 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('no tree open', async () => {
    expect(await service.preview(await incomingGed())).toEqual({ error: 'Open a tree before merging.' });
  });

  it('a failed write changes nothing', async () => {
    await seed();
    await preview(await incomingGed());
    const spy = vi.spyOn(db.unions, 'bulkPut').mockRejectedValueOnce(new Error('disk full'));
    expect(await service.apply(new Map())).toEqual({ error: 'disk full' });
    spy.mockRestore();
    expect(store.individuals()).toHaveLength(6);
    expect(await rowsOf(db.individuals, treeId)).toHaveLength(6);
    expect(service.pending()).not.toBeNull();
  });
});
