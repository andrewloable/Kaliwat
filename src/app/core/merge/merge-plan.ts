import { GedcomNode, Individual, Union, MediaObject, TreeModel, UUID } from '../model/types';
import { serializeAst } from '../../gedcom/serialize/gedcom-serializer';
import { fold } from '../search/search-util';
import { LIFE_EVENT_TYPES } from '../model/life-events';

/** One side of a merge: the tree in the browser ("current") or the picked file ("incoming"). */
export interface MergeSide {
  individuals: Individual[];
  unions: Union[];
  media: MediaObject[];
  /** Top-level records other than HEAD, TRLR, INDI and FAM (SOUR, REPO, NOTE, OBJE, SUBM, SNOTE...). */
  records: GedcomNode[];
}

export type MatchRule = 'uid' | 'kaliwat-xref' | 'xref-name';

export interface FactConflict {
  key: string; // `${ownerKind}|${currentId}|${tag}|${n}`, n = pair index within that tag
  ownerKind: 'person' | 'family';
  currentId: UUID;
  incomingId: UUID;
  tag: string; // 'OBJE' for the primary-photo conflict
  label: string;
  current: GedcomNode;
  incoming: GedcomNode; // pointers not rewritten: applyMerge does that
  currentMediaId?: UUID;
  incomingMediaId?: UUID;
}

export interface FactAddition { ownerKind: 'person' | 'family'; currentId: UUID; node: GedcomNode }

export interface MergePlan {
  personMatches: Map<UUID, UUID>; // incoming person id → current person id
  matchedBy: Map<UUID, MatchRule>;
  newPeople: UUID[];
  familyMatches: Map<UUID, UUID>; // incoming union id → current union id
  newFamilies: UUID[];
  newChildLinks: { currentFamilyId: UUID; incomingChildId: UUID }[];
  newSpouseLinks: { currentFamilyId: UUID; incomingSpouseId: UUID }[];
  factAdditions: FactAddition[];
  conflicts: FactConflict[];
  mediaMatches: Map<UUID, UUID>; // incoming media id → current media id
  newMedia: UUID[]; // added whatever the choices (not the incoming side of a photo conflict)
  /** Profile pictures that are only a web link in the tree, replaced by the image the file has (no question asked). */
  photoOverwrites: { currentId: UUID; currentMediaId: UUID; incomingMediaId: UUID }[];
  recordMatches: Map<string, string>; // incoming record xref → current record xref
  newRecords: string[];
  warnings: string[];
}

const RECORD_SKIP = new Set(['HEAD', 'TRLR', 'INDI', 'FAM']);
const PERSON_SKIP = new Set(['FAMS', 'FAMC', 'OBJE', '_UID', 'RIN', '_UPD', 'CHAN']);
const FAMILY_SKIP = new Set(['HUSB', 'WIFE', 'CHIL', '_UID', 'RIN', '_UPD', 'CHAN']);
const KALIWAT_XREF = /^@K[0-9A-F]{8}@$/;
const WEB = /^https?:\/\//i;
const LABELS: Record<string, string> = {
  ...Object.fromEntries(LIFE_EVENT_TYPES.map((t) => [t.tag, t.label])),
  NAME: 'Name', SEX: 'Sex', BIRT: 'Birth', DEAT: 'Death', BURI: 'Burial', CREM: 'Cremation',
  MARR: 'Marriage', DIV: 'Divorce', NOTE: 'Note', OBJE: 'Profile picture',
};

/** The records of a file's top level that are not people, families, HEAD or TRLR. */
export function recordsOf(ast: GedcomNode[]): GedcomNode[] {
  return ast.filter((n) => !RECORD_SKIP.has(n.tag));
}

/** A normalized file as a merge side. */
export function sideOf(model: TreeModel, ast: GedcomNode[]): MergeSide {
  return {
    individuals: [...model.individuals.values()],
    unions: [...model.unions.values()],
    media: [...model.media.values()],
    records: recordsOf(ast),
  };
}

const childValue = (n: GedcomNode | undefined, tag: string) => n?.children.find((c) => c.tag === tag)?.value;
// PAF and Legacy append a 4-digit checksum to the 32-hex _UID.
const uidOf = (raw?: GedcomNode) => childValue(raw, '_UID')?.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 32) || undefined;
const text = (n: GedcomNode) => serializeAst([n]);
const nameOf = (p: Individual) => p.names[0]?.full || '(no name)';
const setKey = (ids: UUID[]) => [...ids].sort().join('|');
/** Two records whose _UIDs are both known and differ are different records, whatever their xrefs say. */
const uidsDisagree = (a?: GedcomNode, b?: GedcomNode) => {
  const ua = uidOf(a), ub = uidOf(b);
  return !!ua && !!ub && ua !== ub;
};

/** A clone with every pointer, at every depth, mapped through `map` (unknown pointers stay as they are). */
export function remapPointers(n: GedcomNode, map: Map<string, string>): GedcomNode {
  return { ...n, pointer: n.pointer && (map.get(n.pointer) ?? n.pointer), children: n.children.map((c) => remapPointers(c, map)) };
}

/**
 * Compares the tree in the browser with an incoming file and lists what a merge would add and which facts differ.
 * Two-way: nothing is ever removed from the current tree. Pure; `hashes` (SHA-256 of photo bytes) come from the caller.
 */
export function planMerge(
  current: MergeSide,
  incoming: MergeSide,
  hashes?: { current: Map<UUID, string>; incoming: Map<UUID, string> },
  /** Media ids that have a stored image (current) or an image inside the file (incoming). */
  images?: { current: Set<UUID>; incoming: Set<UUID> },
): MergePlan {
  const plan: MergePlan = {
    personMatches: new Map(), matchedBy: new Map(), newPeople: [],
    familyMatches: new Map(), newFamilies: [], newChildLinks: [], newSpouseLinks: [],
    factAdditions: [], conflicts: [], mediaMatches: new Map(), newMedia: [], photoOverwrites: [],
    recordMatches: new Map(), newRecords: [], warnings: [],
  };

  // Records (sources, notes, ...): the same content under any xref is the same record.
  // ponytail: a record pointing at another record under a different xref compares as different and is added again.
  const recordText = (n: GedcomNode) => text({ ...n, xref: undefined });
  const currentRecords = new Map<string, string>(); // content → first xref with it
  const currentRecordText = new Map<string, string>(); // xref → content
  // Duplicate records in the current tree (MyHeritage repeats sources) all stand for the first copy when comparing.
  const sameRecord = new Map<string, string>();
  for (const r of current.records) {
    if (!r.xref) continue;
    const t = recordText(r);
    currentRecordText.set(r.xref, t);
    if (!currentRecords.has(t)) currentRecords.set(t, r.xref);
    else sameRecord.set(r.xref, currentRecords.get(t)!);
  }
  for (const r of incoming.records) {
    if (!r.xref) continue;
    const t = recordText(r);
    const hit = currentRecordText.get(r.xref) === t ? r.xref : currentRecords.get(t);
    if (hit) plan.recordMatches.set(r.xref, hit);
    else plan.newRecords.push(r.xref);
  }

  // People: _UID, then a Kaliwat-made xref, then the same xref with the same name. One-to-one.
  const curPeople = new Map(current.individuals.map((p) => [p.id, p]));
  const byUid = new Map<string, Individual>();
  const byXref = new Map<string, Individual>();
  for (const p of current.individuals) {
    const uid = uidOf(p.rawRef);
    if (uid && !byUid.has(uid)) byUid.set(uid, p);
    if (p.sourceXref && !byXref.has(p.sourceXref)) byXref.set(p.sourceXref, p);
  }
  const takenPeople = new Set<UUID>();
  const takePerson = (p: Individual, hit: Individual, rule: MatchRule) => {
    takenPeople.add(hit.id);
    plan.personMatches.set(p.id, hit.id);
    plan.matchedBy.set(p.id, rule);
  };
  // Every _UID match first, so a weaker rule cannot take a person that a later _UID match needs.
  for (const p of incoming.individuals) {
    const hit = byUid.get(uidOf(p.rawRef) ?? '');
    if (hit && takenPeople.has(hit.id)) {
      plan.warnings.push(`${nameOf(p)} in the file matches ${nameOf(hit)}, who already matched someone else in the file, so ${nameOf(p)} is added as a new person.`);
    } else if (hit) {
      takePerson(p, hit, 'uid');
    }
  }
  for (const p of incoming.individuals) {
    const sameXref = p.sourceXref ? byXref.get(p.sourceXref) : undefined;
    if (plan.personMatches.has(p.id) || !sameXref || takenPeople.has(sameXref.id) || uidsDisagree(p.rawRef, sameXref.rawRef)) continue;
    if (KALIWAT_XREF.test(p.sourceXref!)) takePerson(p, sameXref, 'kaliwat-xref');
    else if (fold(p.names[0]?.full ?? '') && fold(p.names[0]?.full ?? '') === fold(sameXref.names[0]?.full ?? '')) takePerson(p, sameXref, 'xref-name');
  }
  for (const p of incoming.individuals) if (!plan.personMatches.has(p.id)) plan.newPeople.push(p.id);

  // Families: _UID, then the same set of spouses, then (no spouses on either side) the same set of children.
  const curUnions = new Map(current.unions.map((u) => [u.id, u]));
  const famByUid = new Map<string, Union>();
  const famBySpouses = new Map<string, Union>();
  const famByChildren = new Map<string, Union>();
  for (const u of current.unions) {
    const uid = uidOf(u.rawRef);
    if (uid && !famByUid.has(uid)) famByUid.set(uid, u);
    if (u.spouseIds.length) {
      if (!famBySpouses.has(setKey(u.spouseIds))) famBySpouses.set(setKey(u.spouseIds), u);
    } else if (u.childLinks.length && !famByChildren.has(setKey(u.childLinks.map((c) => c.childId)))) {
      famByChildren.set(setKey(u.childLinks.map((c) => c.childId)), u);
    }
  }
  const mapped = (ids: UUID[]) => {
    const out = ids.map((id) => plan.personMatches.get(id));
    return out.length && out.every((id) => id !== undefined) ? setKey(out as UUID[]) : undefined;
  };
  const takenFamilies = new Set<UUID>();
  const takeFamily = (u: Union, hit: Union) => {
    takenFamilies.add(hit.id);
    plan.familyMatches.set(u.id, hit.id);
  };
  // Again every _UID match first.
  for (const u of incoming.unions) {
    const hit = famByUid.get(uidOf(u.rawRef) ?? '');
    if (hit && takenFamilies.has(hit.id)) {
      plan.warnings.push('Two families in the file match the same family in the tree; the second is added as a new family.');
    } else if (hit) {
      takeFamily(u, hit);
    }
  }
  for (const u of incoming.unions) {
    if (plan.familyMatches.has(u.id)) continue;
    const key = u.spouseIds.length ? mapped(u.spouseIds) : mapped(u.childLinks.map((c) => c.childId));
    const hit = key ? (u.spouseIds.length ? famBySpouses : famByChildren).get(key) : undefined;
    if (hit && !takenFamilies.has(hit.id) && !uidsDisagree(u.rawRef, hit.rawRef)) takeFamily(u, hit);
  }
  for (const u of incoming.unions) {
    const hit = curUnions.get(plan.familyMatches.get(u.id) ?? '');
    if (!hit) {
      plan.newFamilies.push(u.id);
      continue;
    }
    for (const c of u.childLinks) {
      const cur = plan.personMatches.get(c.childId);
      if (!cur || !hit.childLinks.some((l) => l.childId === cur)) plan.newChildLinks.push({ currentFamilyId: hit.id, incomingChildId: c.childId });
    }
    let spouses = hit.spouseIds.length;
    for (const s of u.spouseIds) {
      const cur = plan.personMatches.get(s);
      if (cur && hit.spouseIds.includes(cur)) continue;
      if (spouses >= 2) {
        const who = incoming.individuals.find((p) => p.id === s);
        plan.warnings.push(`${who ? nameOf(who) : 'A spouse'} is not added to a family that already has two spouses.`);
        continue;
      }
      spouses++;
      plan.newSpouseLinks.push({ currentFamilyId: hit.id, incomingSpouseId: s });
    }
  }

  // Pointers in incoming facts are compared under the current xrefs of what they point at.
  const incPeople = new Map(incoming.individuals.map((p) => [p.id, p]));
  const incUnions = new Map(incoming.unions.map((u) => [u.id, u]));
  const pointers = new Map(plan.recordMatches);
  for (const [inc, cur] of plan.personMatches) {
    const from = incPeople.get(inc)?.sourceXref, to = curPeople.get(cur)?.sourceXref;
    if (from && to) pointers.set(from, to);
  }
  for (const [inc, cur] of plan.familyMatches) {
    const from = incUnions.get(inc)?.sourceXref, to = curUnions.get(cur)?.sourceXref;
    if (from && to) pointers.set(from, to);
  }

  const diffFacts = (ownerKind: 'person' | 'family', cur: Individual | Union, inc: Individual | Union, skip: Set<string>) => {
    const groups = (raw?: GedcomNode) => {
      const out = new Map<string, GedcomNode[]>();
      for (const c of raw?.children ?? []) if (!skip.has(c.tag)) out.set(c.tag, [...(out.get(c.tag) ?? []), c]);
      return out;
    };
    const curGroups = groups(cur.rawRef);
    for (const [tag, incNodes] of groups(inc.rawRef)) {
      const curNodes = curGroups.get(tag) ?? [];
      const curTexts = curNodes.map((n) => text(remapPointers(n, sameRecord)));
      const used = curNodes.map(() => false);
      // Identical facts pair up first; what is left pairs in order.
      const rest = incNodes.filter((n) => {
        const t = text(remapPointers(remapPointers(n, pointers), sameRecord));
        const j = curTexts.findIndex((ct, k) => !used[k] && ct === t);
        if (j >= 0) used[j] = true;
        return j < 0;
      });
      const free = curNodes.filter((_, k) => !used[k]);
      rest.forEach((node, n) => {
        if (free[n]) {
          plan.conflicts.push({
            key: `${ownerKind}|${cur.id}|${tag}|${n}`, ownerKind, currentId: cur.id, incomingId: inc.id,
            tag, label: LABELS[tag] ?? tag, current: free[n], incoming: node,
          });
        } else {
          plan.factAdditions.push({ ownerKind, currentId: cur.id, node });
        }
      });
    }
  };

  // Photos: the same MyHeritage photo id, file, or bytes is the same photo.
  const curMedia = new Map(current.media.map((m) => [m.id, m]));
  const incMedia = new Map(incoming.media.map((m) => [m.id, m]));
  const allCurMedia = current.media.map((m) => m.id);
  const photoRin = (m: MediaObject) => childValue(m.rawRef, '_PHOTO_RIN');
  const same = (c: MediaObject | undefined, i: MediaObject | undefined) => {
    if (!c || !i) return false;
    if (photoRin(c) && photoRin(c) === photoRin(i)) return true;
    if (c.file && c.file === i.file) return true;
    const hc = hashes?.current.get(c.id);
    return !!hc && hc === hashes?.incoming.get(i.id);
  };
  const findSame = (m: MediaObject, among: UUID[]) => among.find((id) => same(curMedia.get(id), m));
  const linkOnly = (m: MediaObject, have?: Set<UUID>) => !!have && WEB.test(m.file ?? '') && !have.has(m.id);

  for (const p of incoming.individuals) {
    const curId = plan.personMatches.get(p.id);
    const cur = curId ? curPeople.get(curId) : undefined;
    if (cur) diffFacts('person', cur, p, PERSON_SKIP);

    let contested: UUID | undefined;
    if (cur?.mediaIds[0] && p.mediaIds[0]) {
      // Compared directly: MyHeritage attaches one photo to several people, so a tree-wide match proves nothing here.
      const a = curMedia.get(cur.mediaIds[0]), b = incMedia.get(p.mediaIds[0]);
      if (a?.rawRef && b?.rawRef && !same(a, b) && linkOnly(a, images?.current) && images?.incoming.has(b.id)) {
        // An image replaces a profile picture that is only a web link (MyHeritage's expire): no question.
        contested = b.id;
        plan.photoOverwrites.push({ currentId: cur.id, currentMediaId: a.id, incomingMediaId: b.id });
      } else if (a?.rawRef && b?.rawRef && !same(a, b) && images && !linkOnly(a, images.current) && linkOnly(b, images.incoming)) {
        // A link never replaces an image: it comes in as one more photo (below).
      } else if (a?.rawRef && b?.rawRef && !same(a, b)) {
        contested = b.id;
        plan.conflicts.push({
          key: `person|${cur.id}|OBJE|0`, ownerKind: 'person', currentId: cur.id, incomingId: p.id,
          tag: 'OBJE', label: LABELS['OBJE'], current: a.rawRef, incoming: b.rawRef, currentMediaId: a.id, incomingMediaId: b.id,
        });
      }
    }
    for (const id of p.mediaIds) {
      const m = incMedia.get(id);
      if (!m || plan.mediaMatches.has(id) || plan.newMedia.includes(id)) continue;
      const hit = (cur && findSame(m, cur.mediaIds)) || findSame(m, allCurMedia);
      if (hit) plan.mediaMatches.set(id, hit);
      else if (id !== contested) plan.newMedia.push(id);
    }
  }
  for (const u of incoming.unions) {
    const curId = plan.familyMatches.get(u.id);
    const cur = curId ? curUnions.get(curId) : undefined;
    if (cur) diffFacts('family', cur, u, FAMILY_SKIP);
  }

  return plan;
}
