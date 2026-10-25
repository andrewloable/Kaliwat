import { Injectable, inject } from '@angular/core';
import { TreeStore } from '../tree-store/tree.store';
import { PersistenceService } from '../db/persistence.service';
import { db } from '../db/kaliwat-db';
import { makeThumbnail } from '../../gedcom/gedzip/gedzip';
import { Individual, Union, UUID, GedcomNode, PersonName, GedcomEvent, MediaObject } from '../model/types';
import { LIFE_EVENT_TYPES } from '../model/life-events';

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

export type TrimSide = 'ancestors' | 'descendants';

/**
 * Who trimming one side of `personId` removes. The line itself always goes: ancestors are the
 * parents and up, descendants the children and down. So does everyone who is no longer connected
 * to the person once the line is gone (with ancestors: siblings, aunts and uncles, cousins; with
 * descendants: the children's partners and in-laws). Anyone still connected another way stays,
 * e.g. the person's own partners, or a niece married to the person's son.
 */
export function trimSet(unions: Union[], personId: UUID, side: TrimSide): UUID[] {
  const byPerson = new Map<UUID, Union[]>();
  const members = (u: Union) => [...u.spouseIds, ...u.childLinks.map((c) => c.childId)];
  for (const u of unions) for (const p of members(u)) byPerson.set(p, [...(byPerson.get(p) ?? []), u]);

  // The line: up through the families the person is a child of, or down through the families they head.
  const line = new Set<UUID>();
  const up = [personId];
  while (up.length) {
    const p = up.pop()!;
    for (const u of byPerson.get(p) ?? []) {
      const next = side === 'ancestors'
        ? (u.childLinks.some((c) => c.childId === p) ? u.spouseIds : [])
        : (u.spouseIds.includes(p) ? u.childLinks.map((c) => c.childId) : []);
      for (const q of next) if (q !== personId && !line.has(q)) { line.add(q); up.push(q); }
    }
  }
  if (!line.size) return [];

  // Who stays: everyone still reachable from the person without the line. Trimming ancestors also cuts the
  // person's own link into their parents' families, so siblings are kept only if connected another way.
  const reach = (trimmed: boolean): Set<UUID> => {
    const seen = new Set([personId]);
    const queue = [personId];
    while (queue.length) {
      const p = queue.pop()!;
      for (const u of byPerson.get(p) ?? []) {
        if (trimmed && side === 'ancestors' && p === personId && !u.spouseIds.includes(personId)) continue;
        for (const q of members(u)) if (!seen.has(q) && !(trimmed && line.has(q))) { seen.add(q); queue.push(q); }
      }
    }
    return seen;
  };

  const kept = reach(true);
  return [...reach(false)].filter((p) => !kept.has(p));
}

/**
 * People not connected to the main tree, as connected groups (largest first). The
 * main tree is the largest connected group; every other group, whether a lone
 * person or a few people linked only to each other, is an orphan group.
 * ponytail: "main" = largest group, ties go to the first found; add a pinned home
 * person if users need to pick which tree is main.
 */
export function orphanGroups(individuals: Individual[], unions: Union[]): UUID[][] {
  const adj = new Map<UUID, UUID[]>(individuals.map((i) => [i.id, []]));
  for (const u of unions) {
    const members = [...u.spouseIds, ...u.childLinks.map((c) => c.childId)];
    for (const p of members) adj.get(p)?.push(...members);
  }
  const seen = new Set<UUID>();
  const groups: UUID[][] = [];
  for (const { id } of individuals) {
    if (seen.has(id)) continue;
    seen.add(id);
    const group = [id];
    for (let k = 0; k < group.length; k++) {
      for (const q of adj.get(group[k])!) {
        if (!seen.has(q) && adj.has(q)) { seen.add(q); group.push(q); }
      }
    }
    groups.push(group);
  }
  return groups.sort((a, b) => b.length - a.length).slice(1);
}

/** Kinds of fact the editor can add to a person's record. */
export type FactKind = 'email' | 'phone' | 'website' | 'facebook' | 'instagram' | 'twitter' | 'linkedin';

export const FACT_KINDS: { kind: FactKind; label: string; placeholder: string }[] = [
  { kind: 'email', label: 'Email', placeholder: 'name@example.com' },
  { kind: 'phone', label: 'Phone', placeholder: '+63 917 555 1234' },
  { kind: 'website', label: 'Website', placeholder: 'https://example.com' },
  { kind: 'facebook', label: 'Facebook', placeholder: 'https://facebook.com/name' },
  { kind: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/name' },
  { kind: 'twitter', label: 'Twitter / X', placeholder: 'https://x.com/name' },
  { kind: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/name' },
];

/** Add https:// when missing and require a plausible web address; null if it isn't one. */
function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Why `raw` isn't a valid value for this kind of fact, or null when it is. */
export function validateFact(kind: FactKind, raw: string): string | null {
  const value = raw.trim();
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Enter a valid email address.';
  if (kind === 'phone') return value.replace(/\D/g, '').length >= 5 ? null : 'Enter a valid phone number.';
  const url = normalizeUrl(value);
  if (!url) return 'Enter a valid web address (for example https://example.com).';
  if (kind === 'facebook' && !/(^|\.)(facebook\.com|fb\.com|fb\.me)$/i.test(new URL(url).hostname)) {
    return "That doesn't look like a Facebook link. Paste the profile address, e.g. facebook.com/name.";
  }
  return null;
}

function leaf(level: number, tag: string, value: string): GedcomNode {
  return { level, tag, value, xref: undefined, pointer: undefined, children: [] };
}

/** Remove `target` from anywhere under `node`; true if it was found. */
function removeNode(node: GedcomNode, target: GedcomNode): boolean {
  const i = node.children.indexOf(target);
  if (i >= 0) { node.children.splice(i, 1); return true; }
  return node.children.some((c) => removeNode(c, target));
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
  | { kind: 'cycle'; message: string }
  | { kind: 'duplicate'; message: string };

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
      notes: data.notes ? [data.notes] : [],
    };
    // Update rawRef if present; its BIRT/DEAT survive when they still carry sources etc.
    const kept = updated.rawRef ? this._applyToNode(updated.rawRef, data) : { BIRT: false, DEAT: false };
    updated.events = this._mergeCoreEvents(existing.events, data, kept);
    this.store.upsertIndividual(updated);
    this._scheduleWrite();
  }

  /**
   * Add a parent-child link. parentId will be added as a parent of childId
   * via a new or existing union.
   *
   * Connecting moves the child: they leave any family they were a child of, so the tree
   * shows them under the new parent (pass move=false to keep their other families).
   *
   * Validation: rejects self-parenting, ancestry cycles and an existing link.
   */
  addParentChild(parentId: UUID, childId: UUID, move = true): ValidationError | null {
    if (parentId === childId) {
      return { kind: 'self-parent', message: 'A person cannot be their own parent.' };
    }
    // Cycle: adding "parentId is parent of childId" creates a cycle if childId is
    // already an ancestor of parentId (child→...→parent path already exists).
    const parentAncestors = this.store.ancestorIds(parentId);
    if (parentAncestors.has(childId)) {
      return { kind: 'cycle', message: 'Adding this relationship would create an ancestry cycle.' };
    }

    const linked = this.store.unions().find(u => u.spouseIds.includes(parentId) && u.childLinks.some(c => c.childId === childId));
    if (linked) {
      return { kind: 'duplicate', message: 'They are already linked as parent and child.' };
    }

    // Find existing union where parentId is already a spouse
    const target = this.store.unions().find(u => u.spouseIds.includes(parentId));
    if (move) this._leaveParentFamilies(childId, target?.id);
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
    if (this.store.unions().some(u => u.spouseIds.includes(personAId) && u.spouseIds.includes(personBId))) {
      return { kind: 'duplicate', message: 'They are already partners.' };
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
    this._removePeople(new Set([id]));
  }

  /** Delete several people at once (e.g. orphan groups), with deleteIndividual's cleanup. */
  deletePeople(ids: UUID[]): void {
    this._removePeople(new Set(ids));
  }

  /**
   * Trim the ancestors or the descendants of `personId`: delete everyone connected to
   * them only through that side (see trimSet). Returns how many people were removed.
   */
  trim(personId: UUID, side: TrimSide): number {
    const gone = trimSet(this.store.unions(), personId, side);
    this._removePeople(new Set(gone));
    return gone.length;
  }

  /** Remove `ids` with deleteIndividual's cleanup rules. */
  private _removePeople(ids: Set<UUID>): void {
    const removedUnionIds: UUID[] = [];
    const keptUnions = this.store.unions()
      .map((u) => ({
        ...u,
        spouseIds: u.spouseIds.filter((s) => !ids.has(s)),
        childLinks: u.childLinks.filter((c) => !ids.has(c.childId)),
      }))
      .filter((u) => {
        if (u.spouseIds.length + u.childLinks.length >= 2) return true;
        removedUnionIds.push(u.id);
        return false;
      });

    const removed = new Set(removedUnionIds);
    const individuals = this.store.individuals()
      .filter((i) => !ids.has(i.id))
      .map((i) =>
        i.unions.some((r) => removed.has(r.unionId))
          ? { ...i, unions: i.unions.filter((r) => !removed.has(r.unionId)) }
          : i,
      );

    const candidates = [...new Set(this.store.individuals().filter((i) => ids.has(i.id)).flatMap((i) => i.mediaIds))];
    this.store.setIndividuals(individuals);
    this.store.setUnions(keptUnions);

    const treeId = this.store.currentTreeId();
    if (treeId) {
      void db.individuals.bulkDelete([...ids].map((id): [string, string] => [treeId, id]));
      void db.unions.bulkDelete(removedUnionIds.map((uid): [string, string] => [treeId, uid]));
      if (candidates.length) void this._dropUnusedMedia(treeId, candidates, individuals, keptUnions);
    }
    this._scheduleWrite();
  }

  /**
   * Delete the photos (blob + metadata) of removed people, unless a kept person or a kept
   * family's raw OBJE still uses them: dropping a shared photo would silently lose data.
   */
  private async _dropUnusedMedia(treeId: string, candidates: UUID[], keptIndividuals: Individual[], keptUnions: Union[]): Promise<void> {
    const inUse = new Set(keptIndividuals.flatMap((i) => i.mediaIds));
    const famFiles = new Set<string>();
    const famPointers = new Set<string>();
    const walkObje = (n: GedcomNode) => {
      if (n.tag === 'OBJE') {
        if (n.pointer) famPointers.add(n.pointer);
        const f = n.children.find((c) => c.tag === 'FILE')?.value;
        if (f) famFiles.add(f);
      }
      n.children.forEach(walkObje);
    };
    keptUnions.forEach((u) => u.rawRef && walkObje(u.rawRef));

    const drop: [string, string][] = [];
    for (const id of candidates) {
      if (inUse.has(id)) continue;
      const meta = await db.mediaMeta.get([treeId, id]);
      const file = meta?.data?.file;
      const xref = meta?.data?.rawRef?.xref;
      if ((file && famFiles.has(file)) || (xref && famPointers.has(xref))) continue;
      drop.push([treeId, id]);
    }
    if (drop.length) {
      await db.mediaBlobs.bulkDelete(drop);
      await db.mediaMeta.bulkDelete(drop);
    }
  }

  // ── Facts (email, phone, website, social links) ───────────────────────────

  /**
   * Add a fact to a person's record as standard GEDCOM (EMAIL / PHON / WWW, or an EVEN
   * with the link and a TYPE for social networks), so it round-trips on export.
   * Returns an error message, or null on success.
   */
  addFact(personId: UUID, kind: FactKind, raw: string): string | null {
    const indi = this.store.individuals().find((i) => i.id === personId);
    if (!indi?.rawRef) return 'Person not found.';
    const bad = validateFact(kind, raw);
    if (bad) return bad;
    const value = raw.trim();
    let node: GedcomNode;
    if (kind === 'email') {
      node = leaf(1, 'EMAIL', value.replace(/@/g, '@@')); // GEDCOM escapes a literal @
    } else if (kind === 'phone') {
      node = leaf(1, 'PHON', value);
    } else {
      const url = normalizeUrl(value)!; // validated above
      if (kind === 'website') {
        node = leaf(1, 'WWW', url);
      } else {
        const label = FACT_KINDS.find((k) => k.kind === kind)!.label;
        node = leaf(1, 'EVEN', url.replace(/@/g, '@@'));
        node.children.push(leaf(2, 'TYPE', label));
      }
    }
    indi.rawRef.children.push(node);
    this.store.upsertIndividual({ ...indi }); // new object so views re-read the record
    this._scheduleWrite();
    return null;
  }

  /** Remove a fact (a node from extractDetails) from a person's record. */
  removeFact(personId: UUID, node: GedcomNode): void {
    const indi = this.store.individuals().find((i) => i.id === personId);
    if (!indi?.rawRef || !removeNode(indi.rawRef, node)) return;
    this.store.upsertIndividual({ ...indi });
    this._scheduleWrite();
  }

  // ── Life events (baptism, occupation, residence, …) ───────────────────────

  /**
   * Add a life event to a person's record as standard GEDCOM (a tag with DATE and PLAC,
   * plus its text for occupations and the like; "other" events are an EVEN with a TYPE).
   * Returns an error message, or null on success.
   */
  addLifeEvent(
    personId: UUID,
    input: { tag: string; date?: string; place?: string; description?: string; title?: string },
  ): string | null {
    const indi = this.store.individuals().find((i) => i.id === personId);
    if (!indi?.rawRef) return 'Person not found.';
    const type = LIFE_EVENT_TYPES.find((t) => t.tag === input.tag);
    if (!type) return 'Choose a kind of event.';
    const date = input.date?.trim();
    const place = input.place?.trim();
    const description = input.description?.trim();
    const title = input.title?.trim();
    if (type.custom && !title) return 'Enter a name for this event.';
    if (type.description && ['OCCU', 'EDUC'].includes(type.tag) && !description) {
      return `Enter the ${type.label.toLowerCase()}.`;
    }
    if (!date && !place && !description) return 'Enter a date, a place or a description.';

    const node: GedcomNode = {
      level: 1, tag: type.tag, value: type.description && description ? description : undefined,
      xref: undefined, pointer: undefined, children: [],
    };
    if (type.custom) node.children.push(leaf(2, 'TYPE', title!));
    if (date) node.children.push(leaf(2, 'DATE', date));
    if (place) node.children.push(leaf(2, 'PLAC', place));

    const event: GedcomEvent = {
      type: type.tag, date, place, citations: [], notes: [],
      ...(type.description && description ? { description } : {}), raw: node,
    };
    indi.rawRef.children.push(node);
    this.store.upsertIndividual({ ...indi, events: [...indi.events, event] });
    this._scheduleWrite();
    return null;
  }

  /** Remove a life event (not birth or death) from a person. */
  removeLifeEvent(personId: UUID, event: GedcomEvent): void {
    const indi = this.store.individuals().find((i) => i.id === personId);
    if (!indi || !indi.events.includes(event)) return;
    if (indi.rawRef && event.raw) removeNode(indi.rawRef, event.raw);
    this.store.upsertIndividual({ ...indi, events: indi.events.filter((e) => e !== event) });
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

    // The photo editor has already cropped and shrunk this (400×400), so store it as is.
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

  /** `unionId` files the child under that specific family (a parent with several partners). */
  addChild(parentId: UUID, data: PersonFormData = BLANK_PERSON(), unionId?: UUID): UUID {
    const childId = this.createIndividual(data);
    const union = unionId ? this.store.unions().find((u) => u.id === unionId) : undefined;
    if (union) {
      this.store.upsertUnion({
        ...union,
        childLinks: [...union.childLinks, { childId, pedi: undefined, status: undefined, citations: [], notes: [] }],
      });
      this._scheduleWrite();
    } else {
      this.addParentChild(parentId, childId, false);
    }
    return childId;
  }

  /** A blank parent: the second parent of a one-parent family, otherwise a new family. */
  addParent(childId: UUID, data: PersonFormData = BLANK_PERSON()): UUID {
    const parentId = this.createIndividual(data);
    const family = this._parentUnionOf(childId);
    if (family && family.spouseIds.length < 2) {
      this._applyUnions(this.store.unions().map(u =>
        u.id === family.id ? { ...u, spouseIds: [...u.spouseIds, parentId] } : u));
    } else {
      this.addParentChild(parentId, childId, false);
    }
    return parentId;
  }

  // ── Disconnecting ─────────────────────────────────────────────────────────

  /**
   * Remove `childId` from a family: they stop being a child of that family's parents
   * (and the parents stop being theirs). Use this for "remove as child" and for
   * "remove as parent" (from the parent's side, naming the child).
   */
  removeChildLink(childId: UUID, unionId: UUID): void {
    this._applyUnions(this.store.unions().map(u =>
      u.id === unionId ? { ...u, childLinks: u.childLinks.filter(c => c.childId !== childId) } : u));
  }

  /**
   * Remove `personId` as a spouse of a family: they leave the partnership. The
   * family's other spouse and children stay together; a couple with no children
   * simply ends.
   */
  removeSpouse(personId: UUID, unionId: UUID): void {
    this._applyUnions(this.store.unions().map(u =>
      u.id === unionId ? { ...u, spouseIds: u.spouseIds.filter(s => s !== personId) } : u));
  }

  /** Take a child out of every parent family except `keepUnionId`. */
  private _leaveParentFamilies(childId: UUID, keepUnionId?: UUID): void {
    const unions = this.store.unions();
    const leaves = (u: Union) => u.id !== keepUnionId && u.childLinks.some(c => c.childId === childId);
    if (!unions.some(leaves)) return;
    this._applyUnions(unions.map(u =>
      leaves(u) ? { ...u, childLinks: u.childLinks.filter(c => c.childId !== childId) } : u));
  }

  /**
   * Replace the families with `next`, and tidy everything that depended on them:
   * drop families left with fewer than two people, keep each person's list of their
   * own families in step, and delete the stored rows of dropped families.
   */
  private _applyUnions(next: Union[]): void {
    const prev = this.store.unions();
    const kept = next.filter(u => u.spouseIds.length + u.childLinks.length >= 2);
    const keptIds = new Set(kept.map(u => u.id));
    const dropped = prev.filter(u => !keptIds.has(u.id));

    const affected = new Set<UUID>();
    for (const u of [...prev, ...kept]) u.spouseIds.forEach(sid => affected.add(sid));
    const individuals = this.store.individuals().map(i => {
      if (!affected.has(i.id)) return i;
      const member = new Set(kept.filter(u => u.spouseIds.includes(i.id)).map(u => u.id));
      const refs = [
        ...i.unions.filter(r => member.has(r.unionId)),
        ...[...member].filter(uid => !i.unions.some(r => r.unionId === uid)).map(unionId => ({ unionId })),
      ];
      const same = refs.length === i.unions.length && refs.every(r => i.unions.some(o => o.unionId === r.unionId));
      return same ? i : { ...i, unions: refs };
    });

    this.store.setIndividuals(individuals);
    this.store.setUnions(kept);
    const treeId = this.store.currentTreeId();
    if (treeId && dropped.length) {
      void db.unions.bulkDelete(dropped.map((u): [string, string] => [treeId, u.id]));
    }
    this._scheduleWrite();
  }

  addSpouse(personId: UUID, data: PersonFormData = BLANK_PERSON()): UUID {
    const spouseId = this.createIndividual(data);
    this.linkSpouses(personId, spouseId);
    return spouseId;
  }

  addSibling(personId: UUID, data: PersonFormData = BLANK_PERSON()): UUID {
    const sibId = this.createIndividual(data);
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

  private _applyToNode(node: GedcomNode, data: PersonFormData): { BIRT: boolean; DEAT: boolean } {
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
    // Only birth and death are form fields: edit those nodes in place, touch nothing else.
    return {
      BIRT: this._setEventNode(node, 'BIRT', data.birthDate, data.birthPlace),
      DEAT: this._setEventNode(node, 'DEAT', data.deathDate, data.deathPlace),
    };
  }

  /**
   * Set the DATE/PLAC of the first `tag` child in place (keeping its sources, notes and
   * sub-structure). An empty value removes that child; an event left empty is removed.
   * Returns whether the event node still exists.
   */
  private _setEventNode(node: GedcomNode, tag: 'BIRT' | 'DEAT', date?: string, place?: string): boolean {
    let ev = node.children.find(c => c.tag === tag);
    if (!ev) {
      if (!date && !place) return false;
      ev = { level: 1, tag, value: undefined, xref: undefined, pointer: undefined, children: [] };
      node.children.push(ev);
    }
    const target = ev;
    const set = (sub: 'DATE' | 'PLAC', value?: string) => {
      const i = target.children.findIndex(c => c.tag === sub);
      if (value) {
        if (i >= 0) target.children[i].value = value;
        else target.children.push({ level: 2, tag: sub, value, xref: undefined, pointer: undefined, children: [] });
      } else if (i >= 0) {
        target.children.splice(i, 1);
      }
    };
    set('DATE', date);
    set('PLAC', place);
    if (!ev.children.length && !ev.value) {
      node.children.splice(node.children.indexOf(ev), 1);
      return false;
    }
    return true;
  }

  /** Apply the form's birth/death to the model events, leaving every other event as it was. */
  private _mergeCoreEvents(existing: GedcomEvent[], data: PersonFormData, kept: { BIRT: boolean; DEAT: boolean }): GedcomEvent[] {
    const form = { BIRT: [data.birthDate, data.birthPlace], DEAT: [data.deathDate, data.deathPlace] } as const;
    let out = existing;
    for (const type of ['BIRT', 'DEAT'] as const) {
      const [date, place] = form[type];
      const i = out.findIndex(e => e.type === type);
      if (date || place || kept[type]) {
        const next: GedcomEvent = { ...(i >= 0 ? out[i] : { type, citations: [], notes: [] }), date: date || undefined, place: place || undefined };
        out = i >= 0 ? out.map((e, j) => (j === i ? next : e)) : [...out, next];
      } else if (i >= 0) {
        out = out.filter((_, j) => j !== i);
      }
    }
    return out;
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
