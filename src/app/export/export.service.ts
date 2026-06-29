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
    const nodes: GedcomNode[] = this.buildExportAst(astRec?.nodes);

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

  /**
   * Build the export AST from the live model so edits AND added relationships
   * are reflected. Each INDI/FAM keeps its own tags (name, events, custom, media)
   * via rawRef, but the relational pointers (FAMS/FAMC, HUSB/WIFE/CHIL) are
   * regenerated from the model with valid xrefs. HEAD plus any non-INDI/FAM
   * records (sources, notes, submitters) are carried over from the original AST.
   */
  private buildExportAst(originalAst?: GedcomNode[]): GedcomNode[] {
    const indis = this.store.individuals();
    const unions = this.store.unions();
    const indiXref = new Map(indis.map((i) => [i.id, i.sourceXref || `@I${i.id.slice(0, 8).toUpperCase()}@`]));
    const unionXref = new Map(unions.map((u) => [u.id, u.sourceXref || `@F${u.id.slice(0, 8).toUpperCase()}@`]));

    const indiNodes = indis.map((i) => {
      const base = i.rawRef ? cloneNode(i.rawRef) : node('INDI');
      base.xref = indiXref.get(i.id);
      base.children = base.children.filter((c) => c.tag !== 'FAMS' && c.tag !== 'FAMC');
      for (const u of unions) {
        const ux = unionXref.get(u.id)!;
        if (u.spouseIds.includes(i.id)) base.children.push(ptr('FAMS', ux));
        const cl = u.childLinks.find((c) => c.childId === i.id);
        if (cl) {
          const famc = ptr('FAMC', ux);
          if (cl.pedi) famc.children.push(node('PEDI', cl.pedi, [], 2));
          if (cl.status) famc.children.push(node('STAT', cl.status, [], 2));
          base.children.push(famc);
        }
      }
      return base;
    });

    const famNodes = unions.map((u) => {
      const base = u.rawRef ? cloneNode(u.rawRef) : node('FAM');
      base.xref = unionXref.get(u.id);
      const rel: GedcomNode[] = [];
      for (const sid of u.spouseIds) {
        const sx = indiXref.get(sid);
        if (sx) rel.push(ptr(indis.find((x) => x.id === sid)?.sex === 'F' ? 'WIFE' : 'HUSB', sx));
      }
      for (const cl of u.childLinks) {
        const cx = indiXref.get(cl.childId);
        if (cx) rel.push(ptr('CHIL', cx));
      }
      base.children = [...rel, ...base.children.filter((c) => !['HUSB', 'WIFE', 'CHIL'].includes(c.tag))];
      return base;
    });

    const head = originalAst?.find((n) => n.tag === 'HEAD') ?? node('HEAD', undefined, [
      node('GEDC', undefined, [node('VERS', '5.5.1', [], 2)], 1),
      node('CHAR', 'UTF-8', [], 1),
    ]);
    const others = (originalAst ?? []).filter((n) => !['HEAD', 'INDI', 'FAM', 'TRLR'].includes(n.tag));
    return [head, ...others, ...indiNodes, ...famNodes, node('TRLR')];
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

function node(tag: string, value?: string, children: GedcomNode[] = [], level = 0): GedcomNode {
  return { level, tag, value, children, xref: undefined, pointer: undefined };
}

function ptr(tag: string, pointer: string): GedcomNode {
  return { level: 1, tag, pointer, value: undefined, xref: undefined, children: [] };
}

function cloneNode(n: GedcomNode): GedcomNode {
  return { ...n, children: n.children.map(cloneNode) };
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
