import { describe, it, expect, beforeAll } from 'vitest';
import { planMerge, sideOf, MergeSide, MergePlan } from './merge-plan';
import { applyMerge, Choice, MergeResult } from './merge-apply';
import { parseGedcomBytes } from '../../gedcom/parser/gedcom-parser';
import { normalizeAst, individualFacts } from '../../gedcom/normalize/normalizer';
import { serializeAst } from '../../gedcom/serialize/gedcom-serializer';
import type { GedcomNode, Individual } from '../model/types';

async function read(path: string): Promise<string> {
  // @ts-expect-error node built-in: the project has no node types, the test runner still provides it
  const fs = await import('node:fs');
  return fs.readFileSync(path, 'utf8');
}
function fromText(text: string): MergeSide {
  const ast = parseGedcomBytes(new TextEncoder().encode(text)).ast as GedcomNode[];
  return sideOf(normalizeAst(ast).model, ast);
}
const person = (people: Individual[], name: string) => people.find((p) => p.names[0]?.full === name)!;
const child = (n: GedcomNode | undefined, tag: string) => n?.children.find((c) => c.tag === tag);

describe('applyMerge on the merge fixtures', () => {
  let current: MergeSide;
  let incoming: MergeSide;
  let plan: MergePlan;
  /** Choices "A": Juan's birth from the file, the Lito/Ana marriage kept, Maria's photo from the file. */
  let choicesA: Map<string, Choice>;
  let a: MergeResult;
  beforeAll(async () => {
    current = fromText(await read('test/fixtures/merge-current.ged'));
    incoming = fromText(await read('test/fixtures/merge-incoming.ged'));
    plan = planMerge(current, incoming);
    const key = (tag: string) => plan.conflicts.find((c) => c.tag === tag)!.key;
    choicesA = new Map<string, Choice>([[key('BIRT'), 'incoming'], [key('MARR'), 'current'], [key('OBJE'), 'incoming']]);
    a = applyMerge(current, incoming, plan, choicesA);
  });

  it('adds the new people and keeps everyone', () => {
    expect(a.individuals).toHaveLength(8);
    for (const p of current.individuals) expect(a.individuals.some((q) => q.id === p.id)).toBe(true);
    expect(person(a.individuals, 'Rosa Santos')).toBeTruthy();
    expect(person(a.individuals, 'Ramon Uy')).toBeTruthy();
  });

  it('a reused person xref gets a fresh one', () => {
    expect(person(a.individuals, 'Ramon Uy').sourceXref).toMatch(/^@K[0-9A-F]{8}@$/);
    expect(person(a.individuals, 'Ramon Uy').rawRef!.xref).toBe(person(a.individuals, 'Ramon Uy').sourceXref);
    expect(person(a.individuals, 'Rosa Santos').sourceXref).toBe('@I4@');
    expect(person(a.individuals, 'Elena Diaz').sourceXref).toBe('@I7@');
  });

  it('Incoming replaces the fact', () => {
    const juan = person(a.individuals, 'Juan Santos');
    expect(juan.events.find((e) => e.type === 'BIRT')!.date).toBe('2 JAN 1950');
    expect(child(child(juan.rawRef, 'BIRT'), 'DATE')!.value).toBe('2 JAN 1950');
  });

  it('Current keeps the fact', () => {
    const f5 = a.unions.find((u) => u.sourceXref === '@F5@')!;
    expect(f5.events.find((e) => e.type === 'MARR')!.date).toBe('1990');
  });

  it('additions are appended with pointers rewritten', () => {
    const juan = person(a.individuals, 'Juan Santos');
    expect(juan.events.find((e) => e.type === 'OCCU')!.description).toBe('Farmer');
    expect(child(child(juan.rawRef, 'OCCU'), 'SOUR')!.pointer).toBe('@S1@');
  });

  it('a new source that reused an xref gets a fresh xref and its citation follows', () => {
    const titled = (t: string) => a.records.filter((r) => r.tag === 'SOUR' && child(r, 'TITL')?.value === t);
    expect(titled('Civil registry')).toHaveLength(1);
    const civil = titled('Civil registry')[0].xref!;
    expect(civil).toMatch(/^@R[0-9A-F]{8}@$/);
    expect(child(child(person(a.individuals, 'Rosa Santos').rawRef, 'BIRT'), 'SOUR')!.pointer).toBe(civil);
    expect(person(a.individuals, 'Rosa Santos').events.find((e) => e.type === 'BIRT')!.citations).toEqual([civil]);
    expect(child(a.records.find((r) => r.xref === '@S1@'), 'TITL')!.value).toBe('Parish records');
    expect(titled('Parish records')).toHaveLength(1);
  });

  it('new child link and new family', () => {
    const rosa = person(a.individuals, 'Rosa Santos'), ramon = person(a.individuals, 'Ramon Uy');
    expect(a.unions.find((u) => u.sourceXref === '@F1@')!.childLinks.map((l) => l.childId)).toContain(rosa.id);
    const fresh = a.unions.find((u) => !current.unions.some((c) => c.id === u.id))!;
    expect(fresh.spouseIds).toEqual([ramon.id, rosa.id]);
    expect(rosa.unions.map((r) => r.unionId)).toContain(fresh.id);
    expect(ramon.unions.map((r) => r.unionId)).toContain(fresh.id);
  });

  it('photo conflict, Incoming: the new photo becomes primary and the old one stays', () => {
    const before = person(current.individuals, 'Maria Reyes'), inc = person(incoming.individuals, 'Maria Reyes');
    const maria = person(a.individuals, 'Maria Reyes');
    expect(maria.mediaIds).toEqual([a.mediaIdMap.get(inc.mediaIds[0]), before.mediaIds[0]]);
    expect(a.media.map((m) => m.file)).toContain('media/maria-b.jpg');
    expect(child(child(maria.rawRef, 'OBJE'), 'FILE')!.value).toBe('media/maria-b.jpg');
    expect(maria.rawRef!.children.filter((c) => c.tag === 'OBJE')).toHaveLength(2);
  });

  it('everything Current: the current facts and profile pictures stay', () => {
    const r = applyMerge(current, incoming, plan, new Map());
    expect(person(r.individuals, 'Juan Santos').events.find((e) => e.type === 'BIRT')!.date).toBe('1 JAN 1950');
    expect(person(r.individuals, 'Maria Reyes').mediaIds[0]).toBe(person(current.individuals, 'Maria Reyes').mediaIds[0]);
    expect(r.summary.tookIncoming).toBe(0);
  });

  it('a profile picture kept Current still adds the incoming photo', () => {
    const r = applyMerge(current, incoming, plan, new Map());
    const before = person(current.individuals, 'Maria Reyes'), inc = person(incoming.individuals, 'Maria Reyes');
    const maria = person(r.individuals, 'Maria Reyes');
    expect(maria.mediaIds).toEqual([before.mediaIds[0], r.mediaIdMap.get(inc.mediaIds[0])]);
    expect(r.media.map((m) => m.file).sort()).toEqual(['media/maria-b.jpg', 'media/rosa.jpg']);
    expect(maria.rawRef!.children.filter((c) => c.tag === 'OBJE').map((o) => child(o, 'FILE')!.value)).toEqual(['media/maria-a.jpg', 'media/maria-b.jpg']);
  });

  it('untouched people are returned as the same object', () => {
    expect(person(a.individuals, 'Pedro Santos')).toBe(person(current.individuals, 'Pedro Santos'));
    expect(person(a.individuals, 'Elena Diaz')).toBe(person(current.individuals, 'Elena Diaz'));
  });

  it('inputs are not mutated', () => {
    const snapshot = (s: MergeSide) => serializeAst([...s.individuals.map((p) => p.rawRef!), ...s.unions.map((u) => u.rawRef!), ...s.records])
      + JSON.stringify([s.individuals, s.unions, s.media]);
    const before = [snapshot(current), snapshot(incoming)];
    applyMerge(current, incoming, plan, choicesA);
    expect([snapshot(current), snapshot(incoming)]).toEqual(before);
  });

  it('no duplicate xrefs', () => {
    const all = [...a.individuals.map((p) => p.sourceXref), ...a.unions.map((u) => u.sourceXref), ...a.records.map((r) => r.xref)];
    expect(new Set(all).size).toBe(all.length);
  });

  it('the merged tree is a valid file: every pointer resolves', () => {
    const head = ['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8'].join('\n') + '\n';
    const text = head + serializeAst([...a.records, ...a.individuals.map((p) => p.rawRef!), ...a.unions.map((u) => u.rawRef!)]) + '0 TRLR\n';
    const { report } = normalizeAst(parseGedcomBytes(new TextEncoder().encode(text)).ast);
    expect(report.orphanPointers).toEqual([]);
  });

  it('summary', () => {
    expect(a.summary).toEqual({ peopleAdded: 2, familiesAdded: 1, photosAdded: 2, factsAdded: 2, conflicts: 3, tookIncoming: 2, linksReplaced: 0 });
  });
});

describe('applyMerge photos already in the tree', () => {
  const file = (...lines: string[]) => fromText(['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8', ...lines, '0 TRLR'].join('\n'));
  const photo = (f: string) => ['1 OBJE', '2 FORM jpg', `2 FILE ${f}`];
  const uid = '1 _UID 0000000000000000000000000000000A';

  it('Incoming primary that is already the person\'s second photo moves first, without a copy', () => {
    const current = file('0 @I1@ INDI', '1 NAME Maria /Reyes/', uid, ...photo('media/a.jpg'), ...photo('media/b.jpg'));
    const incoming = file('0 @I1@ INDI', '1 NAME Maria /Reyes/', uid, ...photo('media/b.jpg'), ...photo('media/a.jpg'));
    const plan = planMerge(current, incoming);
    expect(plan.conflicts.map((c) => c.tag)).toEqual(['OBJE']);
    const r = applyMerge(current, incoming, plan, new Map([[plan.conflicts[0].key, 'incoming' as Choice]]));
    const [a, b] = current.individuals[0].mediaIds;
    expect(r.individuals[0].mediaIds).toEqual([b, a]);
    expect(r.media).toEqual([]);
    expect(r.individuals[0].rawRef!.children.filter((c) => c.tag === 'OBJE').map((o) => child(o, 'FILE')!.value)).toEqual(['media/b.jpg', 'media/a.jpg']);
  });

  it('the incoming image takes the place of a profile picture that is only a link', () => {
    const current = file('0 @I1@ INDI', '1 NAME Maria /Reyes/', uid, '1 OBJE', '2 FILE https://x.test/a.jpg', ...photo('media/c.jpg'));
    const incoming = file('0 @I1@ INDI', '1 NAME Maria /Reyes/', uid, ...photo('media/b.jpg'));
    const [link, other] = current.individuals[0].mediaIds, inc = incoming.individuals[0].mediaIds[0];
    const plan = planMerge(current, incoming, undefined, { current: new Set([other]), incoming: new Set([inc]) });
    const r = applyMerge(current, incoming, plan, new Map());
    expect(r.individuals[0].mediaIds).toEqual([inc, other]);
    expect(r.individuals[0].mediaIds).not.toContain(link);
    expect(r.individuals[0].rawRef!.children.filter((c) => c.tag === 'OBJE').map((o) => child(o, 'FILE')!.value)).toEqual(['media/b.jpg', 'media/c.jpg']);
    expect(r.summary.linksReplaced).toBe(1);
    expect(r.media.map((m) => m.file)).toEqual(['media/b.jpg']);
  });

  it('a photo another person already has is linked, not copied', () => {
    const current = file('0 @I1@ INDI', '1 NAME Juan /Santos/', uid, ...photo('media/p.jpg'), '0 @I2@ INDI', '1 NAME Pedro /Santos/', '1 _UID 0000000000000000000000000000000B');
    const incoming = file('0 @I2@ INDI', '1 NAME Pedro /Santos/', '1 _UID 0000000000000000000000000000000B', ...photo('media/p.jpg'));
    const r = applyMerge(current, incoming, planMerge(current, incoming), new Map());
    expect(person(r.individuals, 'Pedro Santos').mediaIds).toEqual(person(current.individuals, 'Juan Santos').mediaIds);
    expect(r.media).toEqual([]);
  });
});

describe('individualFacts', () => {
  it('matches the normalizer on the bundled real tree', async () => {
    const ast = parseGedcomBytes(new TextEncoder().encode(await read('test/fixtures/sample-anon.ged'))).ast as GedcomNode[];
    for (const i of normalizeAst(ast).model.individuals.values()) {
      expect(individualFacts(i.rawRef!)).toEqual({ names: i.names, sex: i.sex, events: i.events, notes: i.notes });
    }
  });
});
