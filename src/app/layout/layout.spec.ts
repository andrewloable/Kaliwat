import { describe, it, expect } from 'vitest';
import { buildLayout, CARD_W, CARD_H } from './pedigree-layout';
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
