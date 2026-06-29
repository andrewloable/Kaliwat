import { Injectable, inject } from '@angular/core';
import { TreeStore } from '../tree-store/tree.store';
import { PersistenceService } from '../db/persistence.service';
import { db } from '../db/kaliwat-db';
import { makeThumbnail } from '../../gedcom/gedzip/gedzip';
import { Individual, Union, UUID, GedcomNode, PersonName, GedcomEvent, MediaObject } from '../model/types';

function uuid(): UUID {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function makeIndiNode(xref: string, given: string, surname: string, sex: string): GedcomNode {
  return {
    level: 0, tag: 'INDI', xref, value: undefined, pointer: undefined,
    children: [
      {
        level: 1, tag: 'NAME', value: `${given} /${surname}/`, xref: undefined, pointer: undefined,
        children: [
          { level: 2, tag: 'GIVN', value: given, xref: undefined, pointer: undefined, children: [] },
          { level: 2, tag: 'SURN', value: surname, xref: undefined, pointer: undefined, children: [] },
        ],
      },
      { level: 1, tag: 'SEX', value: sex, xref: undefined, pointer: undefined, children: [] },
    ],
  };
}

function makeFamNode(xref: string, husbRef?: string, wifeRef?: string): GedcomNode {
  const children: GedcomNode[] = [];
  if (husbRef) children.push({ level: 1, tag: 'HUSB', pointer: husbRef, value: undefined, xref: undefined, children: [] });
  if (wifeRef) children.push({ level: 1, tag: 'WIFE', pointer: wifeRef, value: undefined, xref: undefined, children: [] });
  return { level: 0, tag: 'FAM', xref, children, value: undefined, pointer: undefined };
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/tiff': 'tiff', 'image/bmp': 'bmp',
};
function extForType(mime: string): string {
  return MIME_EXT[mime.toLowerCase()] ?? 'jpg';
}

/** Inline `1 OBJE / 2 FILE <path> / 2 FORM <ext>` block (the form the normalizer reads). */
function makeObjeNode(path: string, ext: string): GedcomNode {
  return {
    level: 1, tag: 'OBJE', value: undefined, xref: undefined, pointer: undefined,
    children: [
      { level: 2, tag: 'FILE', value: path, xref: undefined, pointer: undefined, children: [] },
      { level: 2, tag: 'FORM', value: ext, xref: undefined, pointer: undefined, children: [] },
    ],
  };
}

/** True if node is an inline OBJE whose FILE child points at `file`. */
function isObjeFor(node: GedcomNode, file: string): boolean {
  return node.tag === 'OBJE' && node.children.some((c) => c.tag === 'FILE' && c.value === file);
}

export interface PersonFormData {
  given: string;
  surname: string;
  sex: 'M' | 'F' | 'U';
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  notes?: string;
}

export type ValidationError =
  | { kind: 'self-parent'; message: string }
  | { kind: 'cycle'; message: string };

const BLANK_PERSON = (): PersonFormData => ({ given: '', surname: '', sex: 'U' });

@Injectable({ providedIn: 'root' })
export class EditService {
  private readonly store = inject(TreeStore);
  private readonly persistence = inject(PersistenceService);

  /** Create a brand-new individual. Returns the new individual's UUID. */
  createIndividual(data: PersonFormData): UUID {
    const id = uuid();
    const xref = `@K${id.slice(0, 8).toUpperCase()}@`;
    const rawNode = makeIndiNode(xref, data.given, data.surname, data.sex);

    const indi: Individual = {
      id, sourceXref: xref,
      names: [{ full: `${data.given} ${data.surname}`.trim(), given: data.given, surname: data.surname }],
      sex: data.sex,
      events: this._buildEvents(data),
      unions: [],
      mediaIds: [],
      notes: data.notes ? [data.notes] : [],
      rawRef: rawNode,
    };

    this._addEventsToNode(rawNode, data);

    this.store.upsertIndividual(indi);
    this._scheduleWrite();
    return id;
  }

  /** Update an existing individual's core fields. */
  updateIndividual(id: UUID, data: PersonFormData): void {
    const all = this.store.individuals();
    const existing = all.find(i => i.id === id);
    if (!existing) return;

    const updated: Individual = {
      ...existing,
      names: [{ full: `${data.given} ${data.surname}`.trim(), given: data.given, surname: data.surname }],
      sex: data.sex,
      events: this._buildEvents(data),
      notes: data.notes ? [data.notes] : [],
    };
    // Update rawRef if present
    if (updated.rawRef) {
      this._applyToNode(updated.rawRef, data);
    }
    this.store.upsertIndividual(updated);
    this._scheduleWrite();
  }

  /**
   * Add a parent-child link. parentId will be added as a parent of childId
   * via a new or existing union.
   *
   * Validation: rejects self-parenting and ancestry cycles.
   */
  addParentChild(parentId: UUID, childId: UUID): ValidationError | null {
    if (parentId === childId) {
      return { kind: 'self-parent', message: 'A person cannot be their own parent.' };
    }
    // Cycle: adding "parentId is parent of childId" creates a cycle if childId is
    // already an ancestor of parentId (child→...→parent path already exists).
    const parentAncestors = this.store.ancestorIds(parentId);
    if (parentAncestors.has(childId)) {
      return { kind: 'cycle', message: 'Adding this relationship would create an ancestry cycle.' };
    }

    // Find existing union where parentId is already a spouse
    const existingUnion = this.store.unions().find(u => u.spouseIds.includes(parentId));

    if (existingUnion) {
      // Add child to existing union
      const updated: Union = {
        ...existingUnion,
        childLinks: [
          ...existingUnion.childLinks,
          { childId, pedi: undefined, status: undefined, citations: [], notes: [] },
        ],
      };
      this.store.upsertUnion(updated);
      this._linkChildToUnion(childId, updated.id);
    } else {
      // Create a new union with just the parent
      const unionId = uuid();
      const xref = `@F${unionId.slice(0, 8).toUpperCase()}@`;
      const parentIndiv = this.store.individuals().find(i => i.id === parentId);
      const rawNode = makeFamNode(xref,
        parentIndiv?.sex === 'F' ? undefined : parentId,
        parentIndiv?.sex === 'F' ? parentId : undefined,
      );
      const union: Union = {
        id: unionId, sourceXref: xref,
        spouseIds: [parentId],
        events: [], childLinks: [{ childId, pedi: undefined, status: undefined, citations: [], notes: [] }],
        rawRef: rawNode,
      };
      this.store.upsertUnion(union);
      this._linkChildToUnion(childId, unionId);
      // Add union reference to parent
      const parent = this.store.individuals().find(i => i.id === parentId);
      if (parent && !parent.unions.some(u => u.unionId === unionId)) {
        this.store.upsertIndividual({ ...parent, unions: [...parent.unions, { unionId }] });
      }
    }

    this._scheduleWrite();
    return null;
  }

  /**
   * Link two people as spouses. Creates a new union.
   * Validation: rejects self-union, detects simple cycle (one is ancestor of the other — allowed
   * genealogically, so we only block explicit self-union).
   */
  linkSpouses(personAId: UUID, personBId: UUID): ValidationError | null {
    if (personAId === personBId) {
      return { kind: 'self-parent', message: 'A person cannot be married to themselves.' };
    }
    const a = this.store.individuals().find(i => i.id === personAId);
    const b = this.store.individuals().find(i => i.id === personBId);
    if (!a || !b) return null;

    const unionId = uuid();
    const xref = `@F${unionId.slice(0, 8).toUpperCase()}@`;
    const rawNode = makeFamNode(xref,
      a.sex === 'M' || b.sex === 'F' ? personAId : personBId,
      a.sex === 'M' || b.sex === 'F' ? personBId : personAId,
    );
    const union: Union = {
      id: unionId, sourceXref: xref,
      spouseIds: [personAId, personBId],
      events: [], childLinks: [],
      rawRef: rawNode,
    };
    this.store.upsertUnion(union);
    // Update both spouses
    this.store.upsertIndividual({ ...a, unions: [...a.unions, { unionId }] });
    this.store.upsertIndividual({ ...b, unions: [...b.unions, { unionId }] });

    this._scheduleWrite();
    return null;
  }

  /**
   * Delete an individual and clean up references: remove them from every union's
   * spouses and children, drop unions left with fewer than two participants, and
   * unlink those dropped unions from the people who referenced them. Removed rows
   * are deleted from IndexedDB immediately (not via the debounced write) so rapid
   * deletes can't coalesce a removal away.
   */
  deleteIndividual(id: UUID): void {
    const removedUnionIds: UUID[] = [];
    const keptUnions = this.store.unions()
      .map((u) => ({
        ...u,
        spouseIds: u.spouseIds.filter((s) => s !== id),
        childLinks: u.childLinks.filter((c) => c.childId !== id),
      }))
      .filter((u) => {
        if (u.spouseIds.length + u.childLinks.length >= 2) return true;
        removedUnionIds.push(u.id);
        return false;
      });

    const removed = new Set(removedUnionIds);
    const individuals = this.store.individuals()
      .filter((i) => i.id !== id)
      .map((i) =>
        i.unions.some((r) => removed.has(r.unionId))
          ? { ...i, unions: i.unions.filter((r) => !removed.has(r.unionId)) }
          : i,
      );

    this.store.setIndividuals(individuals);
    this.store.setUnions(keptUnions);

    const treeId = this.store.currentTreeId();
    if (treeId) {
      void db.individuals.delete([treeId, id]);
      for (const uid of removedUnionIds) void db.unions.delete([treeId, uid]);
    }
    this._scheduleWrite();
  }

  // ── Photos ────────────────────────────────────────────────────────────────

  /**
   * Set (add or replace) a person's primary photo from a local image Blob.
   * Stores the full blob + a thumbnail in IndexedDB, records a MediaObject, and
   * adds an inline `OBJE/FILE` to the raw record so the photo round-trips on
   * export. Any existing primary photo is removed first.
   * ponytail: object URLs for the replaced blob are revoked in bulk on
   * navigation (MediaService.revokeAll), not per-replace.
   */
  async setPhoto(personId: UUID, file: Blob): Promise<void> {
    const treeId = this.store.currentTreeId();
    if (!treeId) return;
    const indi = this.store.individuals().find((i) => i.id === personId);
    if (!indi) return;

    const oldId = indi.mediaIds[0];
    const oldMeta = oldId ? await db.mediaMeta.get([treeId, oldId]) : undefined;

    const mediaId = uuid();
    const ext = extForType(file.type);
    const path = `media/${mediaId}.${ext}`;
    const thumb = await makeThumbnail(file).catch(() => null);
    await db.mediaBlobs.put({ treeId, id: mediaId, blob: file, ...(thumb ? { thumb } : {}) });

    const objeNode = makeObjeNode(path, ext);
    const media: MediaObject = {
      id: mediaId, form: ext, file: path,
      links: [{ targetId: personId, isPrimary: true }], rawRef: objeNode,
    };
    await db.mediaMeta.put({ treeId, id: mediaId, data: media });

    if (oldId) {
      await db.mediaBlobs.delete([treeId, oldId]);
      await db.mediaMeta.delete([treeId, oldId]);
    }
    if (indi.rawRef) {
      if (oldMeta?.data?.file) indi.rawRef.children = indi.rawRef.children.filter((c) => !isObjeFor(c, oldMeta.data.file!));
      indi.rawRef.children.push(objeNode);
    }
    this.store.upsertIndividual({ ...indi, mediaIds: [mediaId, ...indi.mediaIds.filter((m) => m !== oldId)] });
    this._scheduleWrite();
  }

  /** Remove a person's primary photo: blob, metadata, and its raw `OBJE`. */
  async removePhoto(personId: UUID): Promise<void> {
    const treeId = this.store.currentTreeId();
    if (!treeId) return;
    const indi = this.store.individuals().find((i) => i.id === personId);
    if (!indi || !indi.mediaIds.length) return;

    const oldId = indi.mediaIds[0];
    const oldMeta = await db.mediaMeta.get([treeId, oldId]);
    await db.mediaBlobs.delete([treeId, oldId]);
    await db.mediaMeta.delete([treeId, oldId]);
    if (indi.rawRef && oldMeta?.data?.file) {
      indi.rawRef.children = indi.rawRef.children.filter((c) => !isObjeFor(c, oldMeta.data.file!));
    }
    this.store.upsertIndividual({ ...indi, mediaIds: indi.mediaIds.slice(1) });
    this._scheduleWrite();
  }

  // ── Quick relationship builders ───────────────────────────────────────────
  // Each creates a blank person wired to `personId`, returning the new id so the
  // caller can open the editor to fill in their name.

  addChild(parentId: UUID): UUID {
    const childId = this.createIndividual(BLANK_PERSON());
    this.addParentChild(parentId, childId);
    return childId;
  }

  addParent(childId: UUID): UUID {
    const parentId = this.createIndividual(BLANK_PERSON());
    this.addParentChild(parentId, childId);
    return parentId;
  }

  addSpouse(personId: UUID): UUID {
    const spouseId = this.createIndividual(BLANK_PERSON());
    this.linkSpouses(personId, spouseId);
    return spouseId;
  }

  addSibling(personId: UUID): UUID {
    const sibId = this.createIndividual(BLANK_PERSON());
    const union = this._parentUnionOf(personId) ?? this._newParentUnion(personId);
    if (!union.childLinks.some((c) => c.childId === sibId)) {
      this.store.upsertUnion({
        ...union,
        childLinks: [...union.childLinks, { childId: sibId, pedi: undefined, status: undefined, citations: [], notes: [] }],
      });
    }
    this._scheduleWrite();
    return sibId;
  }

  /** The union whose childLinks include `childId` (their parents), if any. */
  private _parentUnionOf(childId: UUID): Union | undefined {
    return this.store.unions().find((u) => u.childLinks.some((c) => c.childId === childId));
  }

  /** Create a childless-parents union holding `childId` (so siblings can attach). */
  private _newParentUnion(childId: UUID): Union {
    const unionId = uuid();
    const xref = `@F${unionId.slice(0, 8).toUpperCase()}@`;
    const union: Union = {
      id: unionId, sourceXref: xref, spouseIds: [], events: [],
      childLinks: [{ childId, pedi: undefined, status: undefined, citations: [], notes: [] }],
      rawRef: makeFamNode(xref),
    };
    this.store.upsertUnion(union);
    return union;
  }

  private _linkChildToUnion(childId: UUID, unionId: UUID): void {
    const child = this.store.individuals().find(i => i.id === childId);
    if (child && !child.unions.some(u => u.unionId === unionId)) {
      // Note: for children, the unionRef in their unions array means FAMC (not FAMS)
      // We don't add FAMC to the child's unions array — that's only for spouses (FAMS).
      // The union's childLinks is the source of truth for parent-child links.
    }
  }

  private _buildEvents(data: PersonFormData): GedcomEvent[] {
    const events: GedcomEvent[] = [];
    if (data.birthDate || data.birthPlace) {
      events.push({
        type: 'BIRT', date: data.birthDate, place: data.birthPlace,
        citations: [], notes: [], raw: undefined,
      });
    }
    if (data.deathDate || data.deathPlace) {
      events.push({
        type: 'DEAT', date: data.deathDate, place: data.deathPlace,
        citations: [], notes: [], raw: undefined,
      });
    }
    return events;
  }

  private _addEventsToNode(node: GedcomNode, data: PersonFormData): void {
    if (data.birthDate || data.birthPlace) {
      const birt: GedcomNode = { level: 1, tag: 'BIRT', value: undefined, xref: undefined, pointer: undefined, children: [] };
      if (data.birthDate) birt.children.push({ level: 2, tag: 'DATE', value: data.birthDate, xref: undefined, pointer: undefined, children: [] });
      if (data.birthPlace) birt.children.push({ level: 2, tag: 'PLAC', value: data.birthPlace, xref: undefined, pointer: undefined, children: [] });
      node.children.push(birt);
    }
    if (data.deathDate || data.deathPlace) {
      const deat: GedcomNode = { level: 1, tag: 'DEAT', value: undefined, xref: undefined, pointer: undefined, children: [] };
      if (data.deathDate) deat.children.push({ level: 2, tag: 'DATE', value: data.deathDate, xref: undefined, pointer: undefined, children: [] });
      if (data.deathPlace) deat.children.push({ level: 2, tag: 'PLAC', value: data.deathPlace, xref: undefined, pointer: undefined, children: [] });
      node.children.push(deat);
    }
  }

  private _applyToNode(node: GedcomNode, data: PersonFormData): void {
    // Update NAME
    const nameNode = node.children.find(c => c.tag === 'NAME');
    if (nameNode) {
      nameNode.value = `${data.given} /${data.surname}/`;
      const givn = nameNode.children.find(c => c.tag === 'GIVN');
      if (givn) givn.value = data.given;
      const surn = nameNode.children.find(c => c.tag === 'SURN');
      if (surn) surn.value = data.surname;
    }
    // Update SEX
    const sexNode = node.children.find(c => c.tag === 'SEX');
    if (sexNode) sexNode.value = data.sex;
    // Remove old events and re-add
    node.children = node.children.filter(c => c.tag !== 'BIRT' && c.tag !== 'DEAT');
    this._addEventsToNode(node, data);
  }

  private _scheduleWrite(): void {
    const treeId = this.store.currentTreeId();
    if (!treeId) return;
    const individuals = this.store.individuals();
    const unions = this.store.unions();
    this.persistence.scheduleWrite(async () => {
      await this.persistence.saveTree(treeId);
      await this.persistence.saveIndividuals(treeId, individuals);
      await this.persistence.saveUnions(treeId, unions);
    });
  }
}
