import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TreeStore } from '../tree-store/tree.store';
import { EditService } from './edit.service';
import { PersistenceService } from '../db/persistence.service';
import { db } from '../db/kaliwat-db';

// makeThumbnail needs createImageBitmap/OffscreenCanvas (absent in jsdom) — it
// already returns null there, so blobs round-trip without a thumbnail in tests.

function img(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
}
const objeCount = (children: { tag: string }[]) => children.filter((c) => c.tag === 'OBJE').length;

let treeSeq = 0;

describe('EditService photos', () => {
  let store: TreeStore;
  let service: EditService;
  let treeId: string;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TreeStore,
        EditService,
        { provide: PersistenceService, useValue: { scheduleWrite: vi.fn() } },
      ],
    });
    store = TestBed.inject(TreeStore);
    service = TestBed.inject(EditService);
    treeId = `photo-tree-${++treeSeq}`;
    store.setTreeId(treeId);
  });

  it('setPhoto stores a blob, links it as primary, and adds a raw OBJE', async () => {
    const id = service.createIndividual({ given: 'Ana', surname: 'López', sex: 'F' });
    await service.setPhoto(id, img());

    const indi = store.individuals().find((i) => i.id === id)!;
    expect(indi.mediaIds).toHaveLength(1);
    const mediaId = indi.mediaIds[0];

    expect(await db.mediaBlobs.get([treeId, mediaId])).toBeDefined();
    expect((await db.mediaMeta.get([treeId, mediaId]))?.data.file).toBe(`media/${mediaId}.png`);
    expect(objeCount(indi.rawRef!.children)).toBe(1);
  });

  it('setPhoto again replaces the photo: old blob gone, single OBJE kept', async () => {
    const id = service.createIndividual({ given: 'Ana', surname: 'López', sex: 'F' });
    await service.setPhoto(id, img());
    const firstId = store.individuals().find((i) => i.id === id)!.mediaIds[0];

    await service.setPhoto(id, img());
    const indi = store.individuals().find((i) => i.id === id)!;

    expect(indi.mediaIds).toHaveLength(1);
    expect(indi.mediaIds[0]).not.toBe(firstId);
    expect(await db.mediaBlobs.get([treeId, firstId])).toBeUndefined();
    expect(objeCount(indi.rawRef!.children)).toBe(1);
  });

  it('removePhoto clears the link, blob, and raw OBJE', async () => {
    const id = service.createIndividual({ given: 'Ana', surname: 'López', sex: 'F' });
    await service.setPhoto(id, img());
    const mediaId = store.individuals().find((i) => i.id === id)!.mediaIds[0];

    await service.removePhoto(id);
    const indi = store.individuals().find((i) => i.id === id)!;

    expect(indi.mediaIds).toHaveLength(0);
    expect(await db.mediaBlobs.get([treeId, mediaId])).toBeUndefined();
    expect(objeCount(indi.rawRef!.children)).toBe(0);
  });
});
