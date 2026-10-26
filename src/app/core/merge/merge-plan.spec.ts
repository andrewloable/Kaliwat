import { describe, it, expect, beforeAll } from 'vitest';
import { planMerge, sideOf, MergeSide } from './merge-plan';
import { parseGedcomBytes } from '../../gedcom/parser/gedcom-parser';
import { normalizeAst } from '../../gedcom/normalize/normalizer';
import type { GedcomNode } from '../model/types';

async function load(path: string): Promise<MergeSide> {
  // @ts-expect-error node built-in: the project has no node types, the test runner still provides it
  const fs = await import('node:fs');
  return fromText(fs.readFileSync(path, 'utf8'));
}
function fromText(text: string): MergeSide {
  const ast = parseGedcomBytes(new TextEncoder().encode(text)).ast as GedcomNode[];
  return sideOf(normalizeAst(ast).model, ast);
}
const person = (s: MergeSide, name: string) => s.individuals.find((p) => p.names[0]?.full === name)!;
const family = (s: MergeSide, xref: string) => s.unions.find((u) => u.sourceXref === xref)!;

describe('planMerge on the merge fixtures', () => {
  let current: MergeSide;
  let incoming: MergeSide;
  beforeAll(async () => {
    current = await load('test/fixtures/merge-current.ged');
    incoming = await load('test/fixtures/merge-incoming.ged');
  });
  const plan = () => planMerge(current, incoming);

  it('matches people by _UID, Kaliwat xref, and xref plus name', () => {
    const p = plan();
    expect(p.personMatches.size).toBe(5);
    const rule = (name: string) => p.matchedBy.get(person(incoming, name).id);
    expect([rule('Juan Santos'), rule('Maria Reyes'), rule('Pedro Santos')]).toEqual(['uid', 'uid', 'uid']);
    expect(rule('Ana Santos')).toBe('kaliwat-xref');
    expect(rule('Lito Cruz')).toBe('xref-name');
    expect(p.personMatches.get(person(incoming, 'Juan Santos').id)).toBe(person(current, 'Juan Santos').id);
  });

  it('a reused xref with a different name is a new person', () => {
    const ramon = person(incoming, 'Ramon Uy');
    expect(ramon.sourceXref).toBe('@I7@');
    expect(plan().newPeople).toContain(ramon.id);
    expect(plan().personMatches.has(ramon.id)).toBe(false);
  });

  it('new people', () => {
    const names = plan().newPeople.map((id) => incoming.individuals.find((p) => p.id === id)!.names[0].full);
    expect(names).toEqual(['Rosa Santos', 'Ramon Uy']);
  });

  it('families match by _UID and by spouse set', () => {
    const p = plan();
    expect(p.familyMatches.get(family(incoming, '@F1@').id)).toBe(family(current, '@F1@').id);
    expect(p.familyMatches.get(family(incoming, '@F6@').id)).toBe(family(current, '@F5@').id);
    expect(p.newFamilies).toEqual([family(incoming, '@F7@').id]);
  });

  it('a new child of an existing family', () => {
    expect(plan().newChildLinks).toEqual([{ currentFamilyId: family(current, '@F1@').id, incomingChildId: person(incoming, 'Rosa Santos').id }]);
    expect(plan().newSpouseLinks).toEqual([]);
  });

  it('facts only in the incoming file are additions', () => {
    const adds = plan().factAdditions.map((a) => [a.currentId, a.node.tag]);
    expect(adds).toEqual([[person(current, 'Juan Santos').id, 'OCCU'], [person(current, 'Ana Santos').id, 'DEAT']]);
  });

  it('bookkeeping tags are ignored', () => {
    const p = plan();
    expect([...p.conflicts.map((c) => c.tag), ...p.factAdditions.map((a) => a.node.tag)]).not.toContain('_UPD');
  });

  it('different facts on both sides are conflicts', () => {
    const p = plan();
    const seen = p.conflicts.map((c) => [c.currentId, c.tag, c.label]);
    expect(seen).toEqual(expect.arrayContaining([
      [person(current, 'Juan Santos').id, 'BIRT', 'Birth'],
      [family(current, '@F5@').id, 'MARR', 'Marriage'],
      [person(current, 'Maria Reyes').id, 'OBJE', 'Profile picture'],
    ]));
    expect(p.conflicts).toHaveLength(3);
    expect(new Set(p.conflicts.map((c) => c.key)).size).toBe(3);
  });

  it('the same source cited under another xref is not a conflict', () => {
    const maria = person(current, 'Maria Reyes').id;
    expect(plan().conflicts.filter((c) => c.currentId === maria && c.tag === 'BIRT')).toEqual([]);
  });

  it('the same _PHOTO_RIN is the same photo', () => {
    const p = plan();
    const pedroIn = person(incoming, 'Pedro Santos'), pedroCur = person(current, 'Pedro Santos');
    expect(p.mediaMatches.get(pedroIn.mediaIds[0])).toBe(pedroCur.mediaIds[0]);
    expect(p.conflicts.filter((c) => c.currentId === pedroCur.id)).toEqual([]);
    expect(p.newMedia).toEqual([person(incoming, 'Rosa Santos').mediaIds[0]]);
  });

  it('equal content hashes make two photos the same', () => {
    const a = person(current, 'Maria Reyes').mediaIds[0], b = person(incoming, 'Maria Reyes').mediaIds[0];
    const p = planMerge(current, incoming, { current: new Map([[a, 'h']]), incoming: new Map([[b, 'h']]) });
    expect(p.conflicts.map((c) => c.tag)).not.toContain('OBJE');
    expect(p.conflicts).toHaveLength(2);
    expect(p.mediaMatches.get(b)).toBe(a);
  });

  it('records: identical sources match, a reused xref with other content is new', () => {
    const p = plan();
    expect(p.recordMatches.get('@S2@')).toBe('@S1@');
    expect(p.newRecords).toEqual(['@S1@']);
  });

  it('does not change its inputs', () => {
    const snapshot = (s: MergeSide) => JSON.stringify([s.individuals, s.unions, s.media, s.records]);
    const before = [snapshot(current), snapshot(incoming)];
    plan();
    expect([snapshot(current), snapshot(incoming)]).toEqual(before);
  });
});

describe('planMerge guards', () => {
  const file = (...lines: string[]) => fromText(['0 HEAD', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8', ...lines, '0 TRLR'].join('\n'));

  it('matches one-to-one: a second person with the same _UID is new, with a warning', () => {
    const current = file('0 @I1@ INDI', '1 NAME Juan /Santos/', '1 _UID 0000000000000000000000000000000A');
    const incoming = file(
      '0 @I1@ INDI', '1 NAME Juan /Santos/', '1 _UID 0000000000000000000000000000000A',
      '0 @I2@ INDI', '1 NAME Juan /Santos/', '1 _UID 0000000000000000000000000000000A',
    );
    const p = planMerge(current, incoming);
    expect(p.personMatches.size).toBe(1);
    expect(p.newPeople).toHaveLength(1);
    expect(p.warnings).toHaveLength(1);
  });

  it('a weaker match does not take a person a later _UID match needs', () => {
    const current = file('0 @I1@ INDI', '1 NAME Juan /Santos/', '1 _UID 0000000000000000000000000000000A');
    const incoming = file('0 @I1@ INDI', '1 NAME Juan /Santos/', '0 @I2@ INDI', '1 NAME Juan /Santos/', '1 _UID 0000000000000000000000000000000A');
    const p = planMerge(current, incoming);
    expect(p.matchedBy.get(incoming.individuals[1].id)).toBe('uid');
    expect(p.newPeople).toEqual([incoming.individuals[0].id]);
    expect(p.warnings).toEqual([]);
  });

  it('a weaker family match does not take a family a later _UID match needs', () => {
    const people = ['0 @I1@ INDI', '1 NAME Juan /Santos/', '1 _UID 0000000000000000000000000000000A', '0 @I2@ INDI', '1 NAME Maria /Reyes/', '1 _UID 0000000000000000000000000000000B'];
    const current = file(...people, '0 @F1@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 _UID 000000000000000000000000000000F1');
    const incoming = file(...people,
      '0 @F8@ FAM', '1 HUSB @I1@', '1 WIFE @I2@',
      '0 @F9@ FAM', '1 HUSB @I1@', '1 WIFE @I2@', '1 _UID 000000000000000000000000000000F1');
    const p = planMerge(current, incoming);
    expect(p.familyMatches.get(family(incoming, '@F9@').id)).toBe(family(current, '@F1@').id);
    expect(p.newFamilies).toEqual([family(incoming, '@F8@').id]);
  });

  it('never matches by xref when both _UIDs are known and differ', () => {
    const current = file('0 @I1@ INDI', '1 NAME Juan /Santos/', '1 _UID 0000000000000000000000000000000A');
    const incoming = file('0 @I1@ INDI', '1 NAME Juan /Santos/', '1 _UID 0000000000000000000000000000000B');
    expect(planMerge(current, incoming).newPeople).toHaveLength(1);
  });

  it('duplicate sources in the tree do not turn the same citation into a difference', () => {
    const uid = '1 _UID 0000000000000000000000000000000A';
    const current = file('0 @I1@ INDI', '1 NAME Juan /Santos/', uid, '1 BIRT', '2 SOUR @S2@', '0 @S1@ SOUR', '1 TITL Parish', '0 @S2@ SOUR', '1 TITL Parish');
    const incoming = file('0 @I1@ INDI', '1 NAME Juan /Santos/', uid, '1 BIRT', '2 SOUR @S7@', '0 @S7@ SOUR', '1 TITL Parish');
    const p = planMerge(current, incoming);
    expect(p.conflicts).toEqual([]);
    expect(p.recordMatches.get('@S7@')).toBe('@S1@');
  });

  it('an image replaces a profile picture that is only a link', () => {
    const uid = '1 _UID 0000000000000000000000000000000A';
    const current = file('0 @I1@ INDI', '1 NAME Juan /Santos/', uid, '1 OBJE', '2 FILE https://x.test/a.jpg');
    const incoming = file('0 @I1@ INDI', '1 NAME Juan /Santos/', uid, '1 OBJE', '2 FILE media/b.jpg');
    const [cur, inc] = [current.individuals[0].mediaIds[0], incoming.individuals[0].mediaIds[0]];
    const p = planMerge(current, incoming, undefined, { current: new Set(), incoming: new Set([inc]) });
    expect(p.conflicts).toEqual([]);
    expect(p.photoOverwrites).toEqual([{ currentId: current.individuals[0].id, currentMediaId: cur, incomingMediaId: inc }]);
    expect(p.newMedia).toEqual([]);
  });

  it('a link never replaces an image', () => {
    const uid = '1 _UID 0000000000000000000000000000000A';
    const current = file('0 @I1@ INDI', '1 NAME Juan /Santos/', uid, '1 OBJE', '2 FILE media/a.jpg');
    const incoming = file('0 @I1@ INDI', '1 NAME Juan /Santos/', uid, '1 OBJE', '2 FILE https://x.test/b.jpg');
    const p = planMerge(current, incoming, undefined, { current: new Set([current.individuals[0].mediaIds[0]]), incoming: new Set() });
    expect(p.conflicts).toEqual([]);
    expect(p.photoOverwrites).toEqual([]);
    expect(p.newMedia).toEqual([incoming.individuals[0].mediaIds[0]]);
  });

  it('reads a _UID with dashes and a checksum as the plain 32 hex digits', () => {
    const current = file('0 @I1@ INDI', '1 NAME Juan /Santos/', '1 _UID 00000000000000000000000000000ABC');
    const incoming = file('0 @X9@ INDI', '1 NAME Juan /Santos/', '1 _UID 00000000-0000-0000-0000-000000000abc1234');
    expect(planMerge(current, incoming).matchedBy.get(incoming.individuals[0].id)).toBe('uid');
  });
});

describe('planMerge on the bundled real tree', () => {
  it('merging a tree with itself changes nothing', { timeout: 30_000 }, async () => {
    const a = await load('test/fixtures/sample-anon.ged');
    const b = await load('test/fixtures/sample-anon.ged');
    const p = planMerge(a, b);
    expect(p.personMatches.size).toBe(1771);
    expect(p.familyMatches.size).toBe(512);
    expect([p.newPeople, p.newFamilies, p.factAdditions, p.conflicts, p.newMedia, p.newRecords, p.newChildLinks, p.newSpouseLinks])
      .toEqual([[], [], [], [], [], [], [], []]);
  });
});
