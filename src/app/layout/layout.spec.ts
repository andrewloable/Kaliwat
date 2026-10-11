import { describe, it, expect } from 'vitest';
import { buildLayout, buildCompleteLayout, CARD_W, CARD_H } from './pedigree-layout';
import { Individual, Union, UUID } from '../core/model/types';

function makeIndi(id: UUID, given: string, unions: UUID[] = []): Individual {
  return {
    id, names: [{ full: given + ' Test', given, surname: 'Test' }],
    events: [], unions: unions.map(u => ({ unionId: u })),
    mediaIds: [], notes: [],
  };
}

function makeUnion(id: UUID, spouseIds: UUID[], childIds: UUID[]): Union {
  return {
    id, spouseIds, events: [],
    childLinks: childIds.map(cid => ({ childId: cid, citations: [], notes: [] })),
  };
}

describe('pedigree-layout', () => {
  it('returns empty layout for unknown focusId', () => {
    const result = buildLayout('missing', 'pedigree', new Map(), new Map());
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('pedigree: focus+2 parents → 3 nodes, 2 edges, no overlaps', () => {
    const father = makeIndi('F', 'Father');
    const mother = makeIndi('M', 'Mother');
    const child = makeIndi('C', 'Child');
    const union: Union = {
      id: 'U1', spouseIds: ['F', 'M'], events: [],
      childLinks: [{ childId: 'C', citations: [], notes: [] }],
    };
    const individuals = new Map([['F', father], ['M', mother], ['C', child]]);
    const unions = new Map([['U1', union]]);

    const layout = buildLayout('C', 'pedigree', individuals, unions);

    expect(layout.nodes).toHaveLength(3);
    expect(layout.edges).toHaveLength(2);

    // No two nodes overlap (positions are distinct)
    const positions = layout.nodes.map(n => `${n.x},${n.y}`);
    expect(new Set(positions).size).toBe(3);
  });

  it('descendants: focus+2 children → 3 nodes, 2 edges', () => {
    const parent = makeIndi('P', 'Parent', ['U2']);
    const child1 = makeIndi('D1', 'Child1');
    const child2 = makeIndi('D2', 'Child2');
    const union = makeUnion('U2', ['P'], ['D1', 'D2']);

    const individuals = new Map([['P', parent], ['D1', child1], ['D2', child2]]);
    const unions = new Map([['U2', union]]);

    const layout = buildLayout('P', 'descendants', individuals, unions);

    expect(layout.nodes).toHaveLength(3);
    expect(layout.edges).toHaveLength(2);

    // Siblings are at different y positions
    const childNodes = layout.nodes.filter(n => n.id !== 'P');
    expect(childNodes[0].y).not.toBe(childNodes[1].y);
  });

  it('nodes stay within card bounds (y >= 0)', () => {
    const individuals = new Map([
      ['A', makeIndi('A', 'Alice', ['U1'])],
      ['B', makeIndi('B', 'Bob')],
      ['C', makeIndi('C', 'Carol')],
    ]);
    const unions = new Map([['U1', makeUnion('U1', ['A'], ['B', 'C'])]]);

    const layout = buildLayout('A', 'descendants', individuals, unions);
    for (const n of layout.nodes) {
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeGreaterThanOrEqual(0);
    }
  });

  it('complete: ancestors left, focus middle, descendants right — all generations present', () => {
    // grandparent → parent → focus → child → grandchild
    const gp = makeIndi('GP', 'Gramps', ['UA']);
    const parent = makeIndi('PA', 'Parent', ['UB']);
    const focus = makeIndi('FO', 'Focus', ['UC']);
    const child = makeIndi('CH', 'Child', ['UD']);
    const grandchild = makeIndi('GC', 'Grandchild');
    const individuals = new Map([
      ['GP', gp], ['PA', parent], ['FO', focus], ['CH', child], ['GC', grandchild],
    ]);
    const unions = new Map([
      ['UA', makeUnion('UA', ['GP'], ['PA'])],
      ['UB', makeUnion('UB', ['PA'], ['FO'])],
      ['UC', makeUnion('UC', ['FO'], ['CH'])],
      ['UD', makeUnion('UD', ['CH'], ['GC'])],
    ]);

    const layout = buildCompleteLayout('FO', individuals, unions);

    // every generation appears exactly once, focus included once
    expect(layout.nodes.map(n => n.id).sort()).toEqual(['CH', 'FO', 'GC', 'GP', 'PA']);
    expect(layout.edges).toHaveLength(4);

    const x = (id: string) => layout.nodes.find(n => n.id === id)!.x;
    // ancestors sit left of the focus, descendants right of it
    expect(x('GP')).toBeLessThan(x('PA'));
    expect(x('PA')).toBeLessThan(x('FO'));
    expect(x('FO')).toBeLessThan(x('CH'));
    expect(x('CH')).toBeLessThan(x('GC'));
    expect(Math.min(...layout.nodes.map(n => n.x))).toBeGreaterThanOrEqual(0);
  });

  it('complete: each partner gets a card with that family\'s children under it', () => {
    // FO+S1 → K1,K2;  FO+S2 → K3;  FO alone → K4
    const people = ['S1', 'S2', 'K1', 'K2', 'K3', 'K4'].map(id => makeIndi(id, id));
    const individuals = new Map([['FO', makeIndi('FO', 'Focus', ['U1', 'U2', 'U3'])], ...people.map(p => [p.id, p] as const)]);
    const unions = new Map([
      ['U1', makeUnion('U1', ['FO', 'S1'], ['K1', 'K2'])],
      ['U2', makeUnion('U2', ['FO', 'S2'], ['K3'])],
      ['U3', makeUnion('U3', ['FO'], ['K4'])],
    ]);

    const layout = buildCompleteLayout('FO', individuals, unions);
    const node = (pid: string) => layout.nodes.find(n => n.person.id === pid)!;
    const parentOf = (pid: string) => {
      const e = layout.edges.find(e => e.targetId === node(pid).id)!;
      return layout.nodes.find(n => n.id === e.sourceId)!.person.id;
    };

    expect(layout.nodes.map(n => n.person.id).sort()).toEqual(['FO', 'K1', 'K2', 'K3', 'K4', 'S1', 'S2']);
    expect(layout.edges.filter(e => e.spouse).map(e => parentOf(layout.nodes.find(n => n.id === e.targetId)!.person.id)))
      .toEqual(['FO', 'FO']);
    expect(['K1', 'K2', 'K3', 'K4'].map(parentOf)).toEqual(['S1', 'S1', 'S2', 'FO']);
    expect(node('S1').x).toBe(node('S2').x);
    expect(node('S1').x).toBeGreaterThan(node('FO').x);
    expect(node('K1').x).toBeGreaterThan(node('S1').x);
    expect(node('K4').x).toBe(node('K1').x); // partnerless family keeps its generation column

    // the plain Descendants view is unchanged: no partner cards
    const desc = buildLayout('FO', 'descendants', individuals, unions);
    expect(desc.nodes.map(n => n.id).sort()).toEqual(['FO', 'K1', 'K2', 'K3', 'K4']);
  });

  it('avoids infinite loop on circular reference (same person in two generations)', () => {
    // Person A is a parent AND appears as a child (GEDCOM inconsistency)
    const a = makeIndi('A', 'Alice', ['U1']);
    const b = makeIndi('B', 'Bob');
    // U1 lists A as parent AND child
    const union = makeUnion('U1', ['A', 'B'], ['A']);

    const individuals = new Map([['A', a], ['B', b]]);
    const unions = new Map([['U1', union]]);

    // Should not infinite-loop; seen set prevents revisiting
    const layout = buildLayout('A', 'descendants', individuals, unions, 3);
    expect(layout.nodes.length).toBeGreaterThan(0);
  });
});
