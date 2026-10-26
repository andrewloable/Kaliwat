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

  it('setPhoto puts the new photo first in the raw record, so it stays the profile picture after export', async () => {
    const id = service.createIndividual({ given: 'Oscar', surname: 'Nakamura', sex: 'M' });
    const obje = (file: string) => ({ level: 1, tag: 'OBJE', children: [{ level: 2, tag: 'FILE', value: file, children: [] }] });
    const indi = store.individuals().find((i) => i.id === id)!;
    indi.rawRef!.children.push(obje('media/a.jpg'), obje('media/b.jpg'));
    store.upsertIndividual({ ...indi, mediaIds: ['ma', 'mb'] });
    await db.mediaMeta.put({ treeId, id: 'ma', data: { id: 'ma', file: 'media/a.jpg', links: [] } });

    await service.setPhoto(id, img());
    const after = store.individuals().find((i) => i.id === id)!;
    const files = after.rawRef!.children.filter((c) => c.tag === 'OBJE').map((o) => o.children.find((c) => c.tag === 'FILE')!.value);
    const primaryFile = (await db.mediaMeta.get([treeId, after.mediaIds[0]]))!.data.file;
    expect(files).toEqual([primaryFile, 'media/b.jpg']);
    expect(after.mediaIds.slice(1)).toEqual(['mb']);
  });

  describe('deleting people cleans up their photos', () => {
    const mediaId = (id: string) => store.individuals().find((i) => i.id === id)!.mediaIds[0];
    const blob = (m: string) => db.mediaBlobs.get([treeId, m]);

    it('deletes_photo_of_removed_person', async () => {
      const a = service.createIndividual({ given: 'A', surname: 'B', sex: 'F' });
      await service.setPhoto(a, img());
      const m = mediaId(a);
      service.deleteIndividual(a);
      await vi.waitFor(async () => expect(await blob(m)).toBeUndefined());
      expect(await db.mediaMeta.get([treeId, m])).toBeUndefined();
    });

    it('keeps_photo_shared_with_kept_person', async () => {
      const a = service.createIndividual({ given: 'A', surname: 'B', sex: 'F' });
      const b = service.createIndividual({ given: 'C', surname: 'D', sex: 'M' });
      await service.setPhoto(a, img());
      const m = mediaId(a);
      const kept = store.individuals().find((i) => i.id === b)!;
      store.upsertIndividual({ ...kept, mediaIds: [m] });
      service.deletePeople([a]);
      await new Promise((r) => setTimeout(r, 100));
      expect(await blob(m)).toBeDefined();
    });

    it('keeps_photo_referenced_by_kept_family', async () => {
      const a = service.createIndividual({ given: 'A', surname: 'B', sex: 'F' });
      const b = service.createIndividual({ given: 'C', surname: 'D', sex: 'M' });
      const c = service.createIndividual({ given: 'E', surname: 'F', sex: 'M' });
      service.linkSpouses(b, c);
      await service.setPhoto(a, img());
      const m = mediaId(a);
      const file = (await db.mediaMeta.get([treeId, m]))!.data.file!;
      const fam = store.unions().find((u) => u.spouseIds.includes(b))!;
      fam.rawRef!.children.push({ level: 1, tag: 'OBJE', children: [{ level: 2, tag: 'FILE', value: file, children: [] }] });
      service.deletePeople([a]);
      await new Promise((r) => setTimeout(r, 100));
      expect(await blob(m)).toBeDefined();
    });
  });
});
