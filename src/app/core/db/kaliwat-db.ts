import Dexie, { Table } from 'dexie';
import { GedcomNode, Individual, Union, MediaObject } from '../model/types';

export interface TreeRecord {
  id: string;
  meta: Record<string, unknown>;
  updatedAt: number;
}

export interface IndividualRecord {
  treeId: string;
  id: string;
  data: Individual;
}

export interface UnionRecord {
  treeId: string;
  id: string;
  data: Union;
}

export interface MediaMetaRecord {
  treeId: string;
  id: string;
  data: MediaObject;
}

export interface MediaBlobRecord {
  treeId: string;
  id: string;
  blob: Blob;
  thumb?: Blob; // thumbnail blob (webp, max 300px)
}

export interface RawAstRecord {
  treeId: string;
  id: 'root';
  nodes: GedcomNode[];
}

export class KaliwatDb extends Dexie {
  trees!: Table<TreeRecord, string>;
  individuals!: Table<IndividualRecord, [string, string]>;
  unions!: Table<UnionRecord, [string, string]>;
  mediaMeta!: Table<MediaMetaRecord, [string, string]>;
  mediaBlobs!: Table<MediaBlobRecord, [string, string]>;
  rawAst!: Table<RawAstRecord, [string, string]>;

  constructor(name = 'kaliwat') {
    super(name);
    this.version(1).stores({
      trees: 'id',
      individuals: '[treeId+id]',
      unions: '[treeId+id]',
      mediaMeta: '[treeId+id]',
      mediaBlobs: '[treeId+id]',
      rawAst: '[treeId+id]',
    });
    // ponytail: migration scaffold — wire upgrade fns here as schema evolves
    // this.version(2).stores({ ... }).upgrade(tx => { ... });
  }
}

export const db = new KaliwatDb();
