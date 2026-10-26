import { describe, it, expect, vi, afterEach } from 'vitest';
import { MediaService } from './media.service';
import { db } from '../core/db/kaliwat-db';

let treeSeq = 0;
const photo = (id: string, file: string) => ({ id, file, links: [] });
const ok = () => ({ ok: true, blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }) });
const forbidden = () => ({ ok: false, blob: async () => new Blob(['no'], { type: 'text/plain' }) });

describe('MediaService.downloadLinked', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('downloads every linked photo once and stores it for each photo record', async () => {
    const treeId = `links-${++treeSeq}`;
    await db.mediaMeta.bulkPut([
      { treeId, id: 'm1', data: photo('m1', 'https://photos.test/a.jpg') },
      { treeId, id: 'm2', data: photo('m2', 'https://photos.test/a.jpg') }, // MyHeritage shares one photo between people
      { treeId, id: 'm3', data: photo('m3', 'https://photos.test/expired.jpg') },
      { treeId, id: 'm4', data: photo('m4', 'media/local.jpg') },
    ]);
    const fetch = vi.fn(async (url: string) => (url.endsWith('a.jpg') ? ok() : forbidden()));
    vi.stubGlobal('fetch', fetch);
    // fake-indexeddb under jsdom does not keep a Blob intact: check what is written.
    const put = vi.spyOn(db.mediaBlobs, 'bulkPut');
    const media = new MediaService();

    const result = await media.downloadLinked(treeId);
    const written = put.mock.calls.flatMap(([rows]) => [...rows]);
    put.mockRestore();
    expect(result).toEqual({ total: 2, done: 1, failed: 1, running: false });
    expect(media.linkDownload()).toEqual(result);
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(['https://photos.test/a.jpg', 'https://photos.test/expired.jpg']);
    expect(written.map((r) => [r.id, r.blob.size])).toEqual([['m1', 3], ['m2', 3]]);

    // Again: the stored ones are done and the failed link is not tried again this session.
    expect(await media.downloadLinked(treeId)).toEqual({ total: 0, done: 0, failed: 0, running: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a call while a download runs looks for new links when it ends', async () => {
    const treeId = `links-${++treeSeq}`;
    await db.mediaMeta.put({ treeId, id: 'm1', data: photo('m1', 'https://photos.test/one.jpg') });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetch = vi.fn(async (_url: string) => { await gate; return ok(); });
    vi.stubGlobal('fetch', fetch);
    const media = new MediaService();

    const first = media.downloadLinked(treeId);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await db.mediaMeta.put({ treeId, id: 'm2', data: photo('m2', 'https://photos.test/two.jpg') }); // e.g. a merge added it
    const second = media.downloadLinked(treeId);
    release();
    expect(await second).toEqual(await first);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://photos.test/one.jpg', 'https://photos.test/two.jpg']);
  });
});
