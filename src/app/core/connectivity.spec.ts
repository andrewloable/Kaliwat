/**
 * Every feature that decides whether two people are connected must agree. Compare (relationship) once said
 * "aren't connected" for siblings whose family named no parent, while the unconnected-people check (orphanGroups)
 * and the tree view treated them as one tree. These tests check every pair of people in small trees that cover
 * the awkward shapes, the trees left behind by real edits (trim, delete), and a sample of the bundled real tree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { relationship } from './relate/relate';
import { orphanGroups, EditService } from './edit/edit.service';
import { TreeStore } from './tree-store/tree.store';
import { PersistenceService } from './db/persistence.service';
import { parseGedcomBytes } from '../gedcom/parser/gedcom-parser';
import { normalizeAst } from '../gedcom/normalize/normalizer';
import type { Individual, Union } from './model/types';

const person = (id: string): Individual => ({ id, names: [{ full: id }], events: [], unions: [], mediaIds: [], notes: [] });
const fam = (id: string, parents: string[], children: string[] = []): Union => ({
  id, spouseIds: parents, events: [], childLinks: children.map((childId) => ({ childId, citations: [], notes: [] })),
});
const tree = (ids: string, unions: Union[]) => ({ individuals: ids.split(' ').map(person), unions });

function allPairs(individuals: Individual[]): [string, string][] {
  const ids = individuals.map((i) => i.id);
  return ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b] as [string, string]));
}

/** Pairs on which Compare and the unconnected-people check disagree (empty when they agree). */
function disagreements(individuals: Individual[], unions: Union[], pairs = allPairs(individuals)): string[] {
  const people = new Map(individuals.map((i) => [i.id, i]));
  const families = new Map(unions.map((u) => [u.id, u]));
  const group = new Map<string, number>(); // 0 = the main tree (not listed by orphanGroups)
  orphanGroups(individuals, unions).forEach((g, n) => g.forEach((id) => group.set(id, n + 1)));
  return pairs
    .map(([a, b]) => {
      const sameTree = (group.get(a) ?? 0) === (group.get(b) ?? 0);
      const term = relationship(a, b, people, families).term;
      return sameTree === (term !== 'not connected') ? null : `${a}–${b}: check says ${sameTree ? 'connected' : 'separate'}, Compare says "${term}"`;
    })
    .filter((x): x is string => x !== null);
}

describe('connectivity: Compare and the unconnected-people check agree', () => {
  const shapes: Record<string, { individuals: Individual[]; unions: Union[] }> = {
    'an ordinary family over three generations': tree('G H D E M X', [fam('F', ['G', 'H'], ['D', 'E']), fam('DM', ['D', 'M'], ['X'])]),
    'a family that names no parent': tree('A B S C', [fam('F', [], ['A', 'B']), fam('AS', ['A', 'S'], ['C'])]),
    'a family whose parent is not in the tree': tree('A B', [fam('F', ['GONE'], ['A', 'B'])]),
    'a single parent': tree('P A B', [fam('F', ['P'], ['A', 'B'])]),
    'half-siblings from two marriages': tree('P Q R A B', [fam('PQ', ['P', 'Q'], ['A']), fam('PR', ['P', 'R'], ['B'])]),
    'a chain of marriages only': tree('A B C D', [fam('AB', ['A', 'B']), fam('BC', ['B', 'C']), fam('CD', ['C', 'D'])]),
    'two separate trees': tree('A B C D E F', [fam('AB', ['A', 'B'], ['C']), fam('DE', ['D', 'E'], ['F'])]),
    'a lone person beside a tree': tree('A B C L', [fam('AB', ['A', 'B'], ['C'])]),
    'a cousin marriage loop': tree('G H D E M A X C', [
      fam('F', ['G', 'H'], ['D', 'E']), fam('DM', ['D', 'M'], ['X']), fam('EA', ['E', 'A'], ['C']), fam('XC', ['X', 'C']),
    ]),
    'cousins through a family that names no parent': tree('A B C D', [fam('F', [], ['A', 'B']), fam('FA', ['A'], ['C']), fam('FB', ['B'], ['D'])]),
  };
  for (const [name, t] of Object.entries(shapes)) {
    it(`every pair: ${name}`, () => expect(disagreements(t.individuals, t.unions)).toEqual([]));
  }
});

describe('connectivity after real edits', () => {
  let store: TreeStore;
  let edit: EditService;
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: PersistenceService, useValue: { scheduleWrite: vi.fn(), estimateQuota: vi.fn(async () => null) } }],
    });
    store = TestBed.inject(TreeStore);
    edit = TestBed.inject(EditService);
    store.setTreeId('connectivity');
    // G+H -> D, E;  D+M -> X;  E+A -> C;  plus the parents' own parents P+Q -> G.
    const t = tree('P Q G H D E M A X C', [
      fam('PQ', ['P', 'Q'], ['G']), fam('GH', ['G', 'H'], ['D', 'E']), fam('DM', ['D', 'M'], ['X']), fam('EA', ['E', 'A'], ['C']),
    ]);
    store.setIndividuals(t.individuals.map((i) => ({ ...i, unions: t.unions.filter((u) => [...u.spouseIds, ...u.childLinks.map((c) => c.childId)].includes(i.id)).map((u) => ({ unionId: u.id })) })));
    store.setUnions(t.unions);
  });

  it('after deleting both parents (their children keep a family with no parent)', () => {
    edit.deletePeople(['G', 'H']);
    expect(store.unions().some((u) => u.spouseIds.length === 0 && u.childLinks.length >= 2)).toBe(true);
    expect(disagreements(store.individuals(), store.unions())).toEqual([]);
  });

  it('after trimming ancestors', () => {
    edit.trim('D', 'ancestors');
    expect(disagreements(store.individuals(), store.unions())).toEqual([]);
  });

  it('after trimming descendants', () => {
    edit.trim('G', 'descendants');
    expect(disagreements(store.individuals(), store.unions())).toEqual([]);
  });
});

describe('connectivity on the bundled real tree', () => {
  // ponytail: a spread of ~150 pairs, not all 1.5M; relationship() rescans every family per step (~25ms a pair).
  it('Compare and the check agree on a spread of pairs from test/fixtures/sample-anon.ged', { timeout: 30_000 }, async () => {
    // @ts-expect-error node built-in: the project has no node types, the test runner still provides it
    const fs = await import('node:fs');
    const bytes = new Uint8Array(fs.readFileSync('test/fixtures/sample-anon.ged'));
    const { model } = normalizeAst(parseGedcomBytes(bytes).ast);
    const individuals = [...model.individuals.values()];
    const unions = [...model.unions.values()];
    const n = individuals.length;
    const id = (i: number) => individuals[((i % n) + n) % n].id;
    const pairs: [string, string][] = [];
    for (let i = 0; i < n; i += 25) pairs.push([id(i), id(i * 7 + 1)], [id(i), id(i * 13 + 5)]);
    // Every unconnected person against a few people of the main tree (these must come out as "not connected").
    const orphans = orphanGroups(individuals, unions).flat();
    const main = individuals.filter((p) => !orphans.includes(p.id)).slice(0, 5).map((p) => p.id);
    for (const o of orphans) for (const m of main) pairs.push([o, m]);
    expect(pairs.length).toBeGreaterThan(100);
    expect(disagreements(individuals, unions, pairs)).toEqual([]);
  });
});
