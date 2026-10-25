import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KaliwatDb } from './kaliwat-db';
import { PersistenceService } from './persistence.service';

let dbSeq = 0;

describe('PersistenceService.saveTree', () => {
  let testDb: KaliwatDb;
  let service: PersistenceService;

  beforeEach(() => {
    testDb = new KaliwatDb(`kaliwat-persist-test-${++dbSeq}`);
    service = new PersistenceService();
    // The service reads its database from a private field; give it this test's own database. (In the full test run the
    // module-level singleton is not reachable from the service's chunk, so relying on it fails there.)
    (service as unknown as { _db: KaliwatDb })._db = testDb;
  });

  afterEach(() => {
    service.ngOnDestroy();
    testDb.close();
  });

  it('keeps the stored meta when none is passed', async () => {
    await testDb.trees.put({ id: 'meta-keep', meta: { gedcomVersion: '5.5.1', charset: 'UTF-8' }, updatedAt: 1 });

    await service.saveTree('meta-keep');

    const row = (await testDb.trees.get('meta-keep'))!;
    expect(row.meta).toEqual({ gedcomVersion: '5.5.1', charset: 'UTF-8' });
    expect(row.updatedAt).toBeGreaterThan(1);
  });

  it('replaces the stored meta when meta is passed', async () => {
    await testDb.trees.put({ id: 'meta-keep', meta: { gedcomVersion: '5.5.1', charset: 'UTF-8' }, updatedAt: 1 });

    await service.saveTree('meta-keep', { gedcomVersion: '7.0' });

    expect((await testDb.trees.get('meta-keep'))!.meta).toEqual({ gedcomVersion: '7.0' });
  });

  it('stores empty meta for a tree that has none yet', async () => {
    await service.saveTree('brand-new');

    expect((await testDb.trees.get('brand-new'))!.meta).toEqual({});
  });
});
