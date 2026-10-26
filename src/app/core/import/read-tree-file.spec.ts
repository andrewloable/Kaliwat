import { describe, it, expect } from 'vitest';
import { readTreeFile } from './read-tree-file';
import { parseGedcomBytes } from '../../gedcom/parser/gedcom-parser';
import { exportGedzip } from '../../gedcom/gedzip/gedzip';

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

const parse = async (f: File) => parseGedcomBytes(new Uint8Array(await f.arrayBuffer()));

async function fixture(name: string): Promise<string> {
  // @ts-expect-error node built-in: the project has no node types, the test runner still provides it
  const fs = await import('node:fs');
  return fs.readFileSync(`test/fixtures/${name}`, 'utf8');
}

describe('readTreeFile', () => {
  it('reads a .ged', async () => {
    const read = await readTreeFile(new File([await fixture('merge-current.ged')], 'merge-current.ged'), parse);
    if ('error' in read) throw new Error(read.error);
    expect(read.model.individuals.size).toBe(6);
    expect(read.warnings).toEqual([]);
    expect(read.mediaBlobs).toEqual([]);
  });

  it('reads a .gdz and pairs its photo', async () => {
    const gdz = await exportGedzip(await fixture('merge-incoming.ged'), [{ path: 'media/rosa.jpg', blob: new Blob([new Uint8Array([1, 2, 3])]) }]);
    const read = await readTreeFile(new File([gdz], 'incoming.gdz'), parse);
    if ('error' in read) throw new Error(read.error);
    const rosa = [...read.model.individuals.values()].find((p) => p.names[0].full === 'Rosa Santos')!;
    expect(read.mediaBlobs.map((m) => m.id)).toEqual([rosa.mediaIds[0]]);
  });

  it('reports a .gdz without a GEDCOM inside', async () => {
    const gdz = await exportGedzip('', []);
    const empty = await import('jszip').then(async ({ default: JSZip }) => {
      const z = await JSZip.loadAsync(gdz);
      z.remove('gedcom.ged');
      return z.generateAsync({ type: 'blob' });
    });
    expect(await readTreeFile(new File([empty], 'x.gdz'), parse)).toEqual({ error: 'No .ged file found in archive' });
  });
});
