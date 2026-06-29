import { Injectable, inject } from '@angular/core';
import { db } from '../core/db/kaliwat-db';
import { TreeStore } from '../core/tree-store/tree.store';
import { serializeAst } from '../gedcom/serialize/gedcom-serializer';
import { exportGedzip } from '../gedcom/gedzip/gedzip';
import { GedcomNode } from '../core/model/types';

const MIN_ID = '';
const MAX_ID = '￿';

/**
 * Exports the current tree to a downloadable file. Produces a self-contained
 * .gdz (GEDCOM + cached photos, with FILE refs rewritten to local paths) when
 * the tree has cached photos, otherwise a plain .ged. All client-side, no egress.
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly store = inject(TreeStore);

  /** Number of cached photo blobs for a tree — decides .gdz vs .ged. */
  async cachedMediaCount(treeId: string): Promise<number> {
    return db.mediaBlobs.where('[treeId+id]').between([treeId, MIN_ID], [treeId, MAX_ID]).count();
  }

  async export(): Promise<'ged' | 'gdz' | null> {
    const treeId = this.store.currentTreeId();
    if (!treeId) return null;

    const astRec = await db.rawAst.get([treeId, 'root']);
    const nodes: GedcomNode[] = astRec?.nodes ?? this.astFromStore();

    const blobs = await db.mediaBlobs
      .where('[treeId+id]').between([treeId, MIN_ID], [treeId, MAX_ID]).toArray();

    if (blobs.length === 0) {
      this.download(new Blob([serializeAst(nodes)], { type: 'text/plain' }), 'family-tree.ged');
      return 'ged';
    }

    // .gdz: rewrite each remote FILE url to a local archive path, bundle blobs.
    const metas = await db.mediaMeta
      .where('[treeId+id]').between([treeId, MIN_ID], [treeId, MAX_ID]).toArray();
    const urlToLocal = new Map<string, string>();
    const entries: { path: string; blob: Blob }[] = [];
    for (const b of blobs) {
      const meta = metas.find((m) => m.id === b.id);
      const ext = (meta?.data?.form || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
      const path = `media/${b.id}.${ext}`;
      if (meta?.data?.file) urlToLocal.set(meta.data.file, path);
      entries.push({ path, blob: b.blob });
    }
    const rewritten = rewriteFilePaths(nodes, urlToLocal);
    const gdz = await exportGedzip(serializeAst(rewritten), entries);
    this.download(gdz, 'family-tree.gdz');
    return 'gdz';
  }

  /** Fallback documentAst for in-app-created trees (no imported rawAst). */
  private astFromStore(): GedcomNode[] {
    const mk = (tag: string, value?: string, children: GedcomNode[] = [], level = 0): GedcomNode =>
      ({ level, tag, value, children, xref: undefined, pointer: undefined });
    const head = mk('HEAD', undefined, [
      mk('GEDC', undefined, [mk('VERS', '5.5.1', [], 2)], 1),
      mk('CHAR', 'UTF-8', [], 1),
    ]);
    const indis = this.store.individuals().map((i) => i.rawRef).filter(Boolean) as GedcomNode[];
    const fams = this.store.unions().map((u) => u.rawRef).filter(Boolean) as GedcomNode[];
    return [head, ...indis, ...fams, mk('TRLR')];
  }

  private download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Deep-clone the AST, rewriting FILE node values that match a cached URL. */
function rewriteFilePaths(nodes: GedcomNode[], urlToLocal: Map<string, string>): GedcomNode[] {
  const clone = (n: GedcomNode): GedcomNode => ({
    ...n,
    value: n.tag === 'FILE' && n.value && urlToLocal.has(n.value) ? urlToLocal.get(n.value)! : n.value,
    children: n.children.map(clone),
  });
  return nodes.map(clone);
}
