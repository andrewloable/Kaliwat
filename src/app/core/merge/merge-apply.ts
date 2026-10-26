import { GedcomNode, Individual, Union, MediaObject, UUID } from '../model/types';
import { individualFacts, unionEvents } from '../../gedcom/normalize/normalizer';
import { MergeSide, MergePlan, FactConflict } from './merge-plan';

export type Choice = 'current' | 'incoming';

export interface MergeSummary {
  peopleAdded: number;
  familiesAdded: number;
  photosAdded: number;
  factsAdded: number;
  conflicts: number;
  tookIncoming: number;
  linksReplaced: number;
}

export interface MergeResult {
  individuals: Individual[]; // every current person (merged where needed) + new people
  unions: Union[]; // every current union (merged where needed) + new unions
  media: MediaObject[]; // only the media to add, with their final ids
  records: GedcomNode[]; // current records + added records (rewritten)
  mediaIdMap: Map<UUID, UUID>; // incoming media id → id in the merged tree
  summary: MergeSummary;
}

// Fresh xrefs in the forms EditService makes: people @K…@, families @F…@, anything else @R…@.
const FRESH_PREFIX: Record<string, string> = { INDI: 'K', FAM: 'F' };

const clone = (n: GedcomNode): GedcomNode => ({ ...n, children: n.children.map(clone) });

/**
 * Applies a merge plan with the user's choices (a missing key means Current). Returns new objects; the inputs are
 * never changed and nothing in the current tree is removed. Every incoming record that is added gets an xref that is
 * free in the current tree, and every pointer in incoming subtrees follows it.
 */
export function applyMerge(current: MergeSide, incoming: MergeSide, plan: MergePlan, choices: Map<string, Choice>): MergeResult {
  const takesIncoming = (c: FactConflict) => choices.get(c.key) === 'incoming';
  const curPeople = new Map(current.individuals.map((p) => [p.id, p]));
  const curUnions = new Map(current.unions.map((u) => [u.id, u]));
  const curMedia = new Map(current.media.map((m) => [m.id, m]));
  const incPeople = new Map(incoming.individuals.map((p) => [p.id, p]));
  const incUnions = new Map(incoming.unions.map((u) => [u.id, u]));
  const incMedia = new Map(incoming.media.map((m) => [m.id, m]));
  const incRecords = new Map(incoming.records.filter((r) => r.xref).map((r) => [r.xref!, r]));

  // Final xrefs: matched records keep the current xref; added ones keep theirs unless the current tree uses it.
  const taken = new Set<string>();
  for (const x of [...current.individuals, ...current.unions, ...current.media].map((r) => r.sourceXref)) if (x) taken.add(x);
  for (const r of current.records) if (r.xref) taken.add(r.xref);
  const xrefs = new Map(plan.recordMatches);
  for (const [inc, cur] of plan.personMatches) {
    const from = incPeople.get(inc)?.sourceXref, to = curPeople.get(cur)?.sourceXref;
    if (from && to) xrefs.set(from, to);
  }
  for (const [inc, cur] of plan.familyMatches) {
    const from = incUnions.get(inc)?.sourceXref, to = curUnions.get(cur)?.sourceXref;
    if (from && to) xrefs.set(from, to);
  }
  // A media record whose photo is already in the tree points at the current one instead of being added again.
  const skipRecords = new Set<string>();
  for (const [inc, cur] of plan.mediaMatches) {
    const from = incMedia.get(inc)?.sourceXref, to = curMedia.get(cur)?.sourceXref;
    if (from && to && !xrefs.has(from)) {
      xrefs.set(from, to);
      skipRecords.add(from);
    }
  }
  const assign = (xref: string | undefined, tag: string) => {
    if (!xref || xrefs.has(xref)) return;
    let final = xref;
    while (taken.has(final)) final = `@${FRESH_PREFIX[tag] ?? 'R'}${crypto.randomUUID().slice(0, 8).toUpperCase()}@`;
    taken.add(final);
    xrefs.set(xref, final);
  };
  for (const id of plan.newPeople) assign(incPeople.get(id)?.sourceXref, 'INDI');
  for (const id of plan.newFamilies) assign(incUnions.get(id)?.sourceXref, 'FAM');
  for (const x of plan.newRecords) assign(x, incRecords.get(x)?.tag ?? '');

  const mapXref = (x: string) => xrefs.get(x) ?? x;
  const rewrite = (n: GedcomNode): GedcomNode => ({
    ...n, xref: n.xref && mapXref(n.xref), pointer: n.pointer && mapXref(n.pointer), children: n.children.map(rewrite),
  });
  const personId = (incomingId: UUID) => plan.personMatches.get(incomingId) ?? incomingId;

  // Media: matched photos use the current id; added ones keep their incoming id.
  const mediaIdMap = new Map(plan.mediaMatches);
  const added = new Map<UUID, MediaObject>();
  const addMedia = (id: UUID): UUID => {
    const known = mediaIdMap.get(id);
    if (known) return known;
    const m = incMedia.get(id)!;
    added.set(id, { ...m, sourceXref: m.sourceXref && mapXref(m.sourceXref), rawRef: m.rawRef && rewrite(m.rawRef) });
    mediaIdMap.set(id, id);
    return id;
  };
  /** The person's own OBJE line for a photo: the inline block, or the pointer to an OBJE record. */
  const objeLine = (raw: GedcomNode | undefined, m: MediaObject | undefined) =>
    raw?.children.find((c) => c.tag === 'OBJE' && (c === m?.rawRef || (!!c.pointer && c.pointer === m?.sourceXref)));
  /** An OBJE line for a current photo that this person does not have yet. */
  const lineFor = (m: MediaObject): GedcomNode =>
    m.sourceXref ? { level: 1, tag: 'OBJE', pointer: m.sourceXref, children: [] } : clone(m.rawRef ?? { level: 1, tag: 'OBJE', children: [] });

  const byOwner = <T extends { currentId: UUID }>(items: T[]) => {
    const out = new Map<UUID, T[]>();
    for (const i of items) out.set(i.currentId, [...(out.get(i.currentId) ?? []), i]);
    return out;
  };
  const conflictsOf = byOwner(plan.conflicts);
  const additionsOf = byOwner(plan.factAdditions);

  /** The current record's raw subtree with the additions and the Incoming choices applied (null when unchanged). */
  const mergedRaw = (raw: GedcomNode, id: UUID): GedcomNode | null => {
    const adds = additionsOf.get(id) ?? [];
    const swaps = (conflictsOf.get(id) ?? []).filter((c) => c.tag !== 'OBJE' && takesIncoming(c));
    if (!adds.length && !swaps.length) return null;
    const out = clone(raw);
    for (const c of swaps) {
      const i = raw.children.indexOf(c.current);
      if (i >= 0) out.children[i] = rewrite(c.incoming);
    }
    for (const a of adds) out.children.push(rewrite(a.node));
    return out;
  };

  const snoteText = new Map<string, string>();
  const records = [
    ...current.records,
    ...plan.newRecords.filter((x) => incRecords.has(x) && !skipRecords.has(x)).map((x) => rewrite(incRecords.get(x)!)),
  ];
  for (const r of records) if (r.tag === 'SNOTE' && r.xref) snoteText.set(r.xref, r.value ?? '');

  // People already in the tree.
  const incomingOf = new Map([...plan.personMatches].map(([inc, cur]) => [cur, incPeople.get(inc)!]));
  const people: Individual[] = current.individuals.map((cur) => {
    const inc = incomingOf.get(cur.id);
    // ponytail: every record has a rawRef (the normalizer and EditService always set one); without it only photos merge.
    let raw = cur.rawRef ? mergedRaw(cur.rawRef, cur.id) : null;
    let mediaIds = cur.mediaIds;
    const ensureRaw = () => (raw ??= cur.rawRef ? clone(cur.rawRef) : { level: 0, tag: 'INDI', xref: cur.sourceXref, children: [] });

    /** Adds a photo after the person's photos (a current photo another person has, or an added one). */
    const append = (target: UUID, id: UUID) => {
      if (mediaIds.includes(target)) return;
      mediaIds = [...mediaIds, target];
      ensureRaw().children.push(curMedia.has(target)
        ? lineFor(curMedia.get(target)!)
        : rewrite(objeLine(inc?.rawRef, incMedia.get(id)) ?? lineFor(incMedia.get(id)!)));
    };

    for (const id of inc?.mediaIds ?? []) {
      const photo = plan.conflicts.find((c) => c.tag === 'OBJE' && c.currentId === cur.id && c.incomingMediaId === id);
      const overwrite = plan.photoOverwrites.find((o) => o.currentId === cur.id && o.incomingMediaId === id);
      if (overwrite) {
        // The image takes the place of the profile picture that was only a web link; the link leaves this person.
        const target = addMedia(id);
        const link = curMedia.get(overwrite.currentMediaId);
        const own = curMedia.has(target) ? objeLine(cur.rawRef, curMedia.get(target)) : undefined;
        const node = curMedia.has(target)
          ? clone(own ?? lineFor(curMedia.get(target)!))
          : rewrite(objeLine(inc?.rawRef, incMedia.get(id)) ?? lineFor(incMedia.get(id)!));
        const drop = new Set([objeLine(cur.rawRef, link), own].filter((n) => !!n).map((n) => cur.rawRef!.children.indexOf(n!)));
        const r = ensureRaw();
        r.children = r.children.filter((_, i) => !drop.has(i));
        const first = r.children.findIndex((c) => c.tag === 'OBJE');
        r.children.splice(first < 0 ? r.children.length : first, 0, node);
        mediaIds = [target, ...mediaIds.filter((m) => m !== target && m !== overwrite.currentMediaId)];
      } else if (photo && !takesIncoming(photo)) {
        // Profile picture kept: the incoming photo still comes in, after the person's photos (new photos are always added).
        append(addMedia(id), id);
      } else if (photo) {
        // Incoming photo first; the current one stays as the next photo (nothing is deleted).
        const target = addMedia(id);
        const node = curMedia.has(target)
          ? (objeLine(cur.rawRef, curMedia.get(target)) ?? lineFor(curMedia.get(target)!))
          : rewrite(objeLine(inc?.rawRef, incMedia.get(id)) ?? lineFor(incMedia.get(id)!));
        const r = ensureRaw();
        const old = cur.rawRef?.children.indexOf(node) ?? -1;
        if (old >= 0) r.children.splice(old, 1);
        const first = r.children.findIndex((c) => c.tag === 'OBJE');
        r.children.splice(first < 0 ? r.children.length : first, 0, old >= 0 ? clone(node) : node);
        mediaIds = [target, ...mediaIds.filter((m) => m !== target)];
      } else if (plan.newMedia.includes(id)) {
        append(addMedia(id), id);
      } else {
        // The same photo is already in the tree, maybe on another person (MyHeritage shares photos).
        const target = plan.mediaMatches.get(id);
        if (target) append(target, id);
      }
    }
    if (!raw) return cur;
    return { ...cur, ...(cur.rawRef ? individualFacts(raw, snoteText) : {}), rawRef: raw, mediaIds };
  });

  // New people.
  for (const id of plan.newPeople) {
    const inc = incPeople.get(id)!;
    const raw = inc.rawRef ? rewrite(inc.rawRef) : undefined;
    people.push({
      ...inc,
      ...(raw ? individualFacts(raw, snoteText) : {}),
      sourceXref: inc.sourceXref && mapXref(inc.sourceXref),
      rawRef: raw,
      mediaIds: inc.mediaIds.map(addMedia),
      unions: [],
    });
  }

  // Families already in the tree.
  const linkFor = (incUnion: Union | undefined, childId: UUID) => {
    const l = incUnion?.childLinks.find((c) => c.childId === childId);
    return { pedi: l?.pedi, status: l?.status, citations: (l?.citations ?? []).map(mapXref), notes: l?.notes ?? [], childId: personId(childId) };
  };
  const incomingUnionOf = new Map([...plan.familyMatches].map(([inc, cur]) => [cur, incUnions.get(inc)!]));
  const unions: Union[] = current.unions.map((cur) => {
    const kids = plan.newChildLinks.filter((l) => l.currentFamilyId === cur.id);
    const spouses = plan.newSpouseLinks.filter((l) => l.currentFamilyId === cur.id);
    const raw = cur.rawRef ? mergedRaw(cur.rawRef, cur.id) : null;
    if (!raw && !kids.length && !spouses.length) return cur;
    const inc = incomingUnionOf.get(cur.id);
    return {
      ...cur,
      ...(raw ? { rawRef: raw, events: unionEvents(raw) } : {}),
      spouseIds: [...cur.spouseIds, ...spouses.map((s) => personId(s.incomingSpouseId))],
      childLinks: [...cur.childLinks, ...kids.map((k) => linkFor(inc, k.incomingChildId))],
    };
  });

  // New families.
  for (const id of plan.newFamilies) {
    const inc = incUnions.get(id)!;
    const raw = inc.rawRef ? rewrite(inc.rawRef) : undefined;
    unions.push({
      ...inc,
      sourceXref: inc.sourceXref && mapXref(inc.sourceXref),
      rawRef: raw,
      events: raw ? unionEvents(raw) : inc.events,
      spouseIds: inc.spouseIds.map(personId),
      childLinks: inc.childLinks.map((l) => linkFor(inc, l.childId)),
    });
  }

  // Individual.unions lists the families where the person is a spouse (as the normalizer builds it).
  const spouseOf = new Map<UUID, UUID[]>();
  for (const u of unions) for (const s of u.spouseIds) spouseOf.set(s, [...(spouseOf.get(s) ?? []), u.id]);
  const individuals = people.map((p) => {
    const ids = spouseOf.get(p.id) ?? [];
    const kept = p.unions.map((r) => r.unionId).filter((u) => ids.includes(u));
    const next = [...kept, ...ids.filter((u) => !kept.includes(u))];
    return next.length === p.unions.length && next.every((u, i) => u === p.unions[i].unionId)
      ? p
      : { ...p, unions: next.map((unionId) => ({ unionId })) };
  });

  return {
    individuals,
    unions,
    media: [...added.values()],
    records,
    mediaIdMap,
    summary: {
      peopleAdded: plan.newPeople.length,
      familiesAdded: plan.newFamilies.length,
      photosAdded: added.size,
      factsAdded: plan.factAdditions.length,
      conflicts: plan.conflicts.length,
      tookIncoming: plan.conflicts.filter(takesIncoming).length,
      linksReplaced: plan.photoOverwrites.length,
    },
  };
}
