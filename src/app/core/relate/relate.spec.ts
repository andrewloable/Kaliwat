import { describe, it, expect } from 'vitest';
import { relationship, generations, traceLayout, withUnrecordedParents } from './relate';
import { Individual, Union, UUID } from '../model/types';

function mkI(id: UUID): Individual {
  return { id, sourceXref: id, names: [{ full: id }], sex: 'U', events: [], unions: [], mediaIds: [], notes: [], rawRef: undefined as never };
}
function mkU(id: UUID, spouses: UUID[], children: UUID[]): Union {
  return {
    id, sourceXref: id, spouseIds: spouses,
    childLinks: children.map(c => ({ childId: c, pedi: undefined, status: undefined, citations: [], notes: [] })),
    events: [], rawRef: undefined as never,
  };
}

/**
 * Tree structure used in tests:
 *
 *   GREAT_GP + GREAT_GP2
 *         ├─ GP1 + GP2                   ← U_GGP
 *         │    ├─ P1 + P2    ← U_GP12
 *         │    │    ├─ ME            ← U_P1P2
 *         │    │    └─ SIB
 *         │    └─ UNCLE              ← U_GP12
 *         │         └─ COUSIN        ← U_UNCLE_CH  (1st cousin of ME)
 *         │              └─ COUSIN_REMOVED  ← U_COUSIN (1st cousin once removed)
 *         └─ GREAT_UNCLE              ← U_GGP
 *              └─ GU_CHILD            ← U_GU
 *                   └─ SECOND_COUSIN  ← U_COUSIN2 (2nd cousin of ME)
 *
 *   P1 + OTHER_PARENT → HALF_SIB      ← U_HALF
 *   GP3 + GP4 → P2                    ← U_GP34
 *   ME + SPOUSE → CHILD → GRANDCHILD  ← U_ME_SP, U_CHILD
 */

const indis = new Map<UUID, Individual>([
  ['GREAT_GP', mkI('GREAT_GP')],
  ['GREAT_GP2', mkI('GREAT_GP2')],
  ['GP1', mkI('GP1')],
  ['GP2', mkI('GP2')],
  ['GP3', mkI('GP3')],
  ['GP4', mkI('GP4')],
  ['P1', mkI('P1')],
  ['P2', mkI('P2')],
  ['ME', mkI('ME')],
  ['SIB', mkI('SIB')],
  ['OTHER_PARENT', mkI('OTHER_PARENT')],
  ['HALF_SIB', mkI('HALF_SIB')],
  ['UNCLE', mkI('UNCLE')],
  ['COUSIN', mkI('COUSIN')],
  ['COUSIN_REMOVED', mkI('COUSIN_REMOVED')],
  ['GREAT_UNCLE', mkI('GREAT_UNCLE')],
  ['GU_CHILD', mkI('GU_CHILD')],
  ['SECOND_COUSIN', mkI('SECOND_COUSIN')],
  ['SPOUSE', mkI('SPOUSE')],
  ['CHILD', mkI('CHILD')],
  ['GRANDCHILD', mkI('GRANDCHILD')],
  ['UNRELATED', mkI('UNRELATED')],
]);

const unions = new Map<UUID, Union>([
  ['U_GGP',      mkU('U_GGP',      ['GREAT_GP', 'GREAT_GP2'], ['GP1', 'GREAT_UNCLE'])],
  ['U_GP12',     mkU('U_GP12',     ['GP1', 'GP2'],            ['P1', 'UNCLE'])],
  ['U_GP34',     mkU('U_GP34',     ['GP3', 'GP4'],            ['P2'])],
  ['U_P1P2',     mkU('U_P1P2',     ['P1', 'P2'],              ['ME', 'SIB'])],
  ['U_HALF',     mkU('U_HALF',     ['P1', 'OTHER_PARENT'],    ['HALF_SIB'])],
  ['U_UNCLE_CH', mkU('U_UNCLE_CH', ['UNCLE'],                 ['COUSIN'])],
  ['U_COUSIN',   mkU('U_COUSIN',   ['COUSIN'],                ['COUSIN_REMOVED'])],
  ['U_GU',       mkU('U_GU',       ['GREAT_UNCLE'],           ['GU_CHILD'])],
  ['U_COUSIN2',  mkU('U_COUSIN2',  ['GU_CHILD'],              ['SECOND_COUSIN'])],
  ['U_ME_SP',    mkU('U_ME_SP',    ['ME', 'SPOUSE'],          ['CHILD'])],
  ['U_CHILD',    mkU('U_CHILD',    ['CHILD'],                 ['GRANDCHILD'])],
]);

function rel(a: UUID, b: UUID) { return relationship(a, b, indis, unions).term; }

describe('relationship()', () => {
  it('self', () => expect(rel('ME', 'ME')).toBe('self'));
  it('parent', () => expect(rel('ME', 'P1')).toBe('parent'));
  it('child', () => expect(rel('P1', 'ME')).toBe('child'));
  it('grandparent', () => expect(rel('ME', 'GP1')).toBe('grandparent'));
  it('grandchild', () => expect(rel('GP1', 'ME')).toBe('grandchild'));
  it('great-grandparent', () => expect(rel('ME', 'GREAT_GP')).toBe('great-grandparent'));
  it('great-grandchild', () => expect(rel('GREAT_GP', 'ME')).toBe('great-grandchild'));
  it('grandchild via ME', () => expect(rel('ME', 'GRANDCHILD')).toBe('grandchild'));
  it('great-grandchild via ME', () => expect(rel('P1', 'GRANDCHILD')).toBe('great-grandchild'));

  it('full sibling', () => expect(rel('ME', 'SIB')).toBe('sibling'));
  it('half-sibling', () => expect(rel('ME', 'HALF_SIB')).toBe('half-sibling'));

  it('aunt/uncle', () => expect(rel('ME', 'UNCLE')).toBe('aunt/uncle'));
  it('niece/nephew', () => expect(rel('UNCLE', 'ME')).toBe('niece/nephew'));
  it('great-aunt/uncle', () => expect(rel('ME', 'GREAT_UNCLE')).toBe('great-aunt/uncle'));
  it('great-niece/nephew', () => expect(rel('GREAT_UNCLE', 'ME')).toBe('great-niece/nephew'));

  it('1st cousin', () => expect(rel('ME', 'COUSIN')).toBe('1st cousin'));
  it('1st cousin once removed', () => expect(rel('ME', 'COUSIN_REMOVED')).toBe('1st cousin once removed'));
  it('2nd cousin', () => expect(rel('ME', 'SECOND_COUSIN')).toBe('2nd cousin'));

  it('spouse', () => expect(rel('ME', 'SPOUSE')).toBe('spouse'));
  it('child-in-law (spouse of a child)', () => expect(rel('P1', 'SPOUSE')).toBe('child-in-law'));
  it('parent-in-law (parent of a spouse)', () => expect(rel('SPOUSE', 'P1')).toBe('parent-in-law'));
  it('sibling-in-law both ways', () => {
    expect(rel('SIB', 'SPOUSE')).toBe('sibling-in-law');
    expect(rel('SPOUSE', 'SIB')).toBe('sibling-in-law');
  });
  it('an aunt/uncle\'s spouse is an aunt/uncle by marriage', () => {
    const people = new Map(['ME', 'DAD', 'UNC', 'AUNT', 'GP'].map(id => [id, mkI(id)] as const));
    const fams = new Map([
      ['F1', mkU('F1', ['GP'], ['DAD', 'UNC'])], ['F2', mkU('F2', ['DAD'], ['ME'])], ['F3', mkU('F3', ['UNC', 'AUNT'], [])],
    ]);
    expect(relationship('ME', 'AUNT', people, fams).term).toBe('aunt/uncle by marriage');
  });

  it('other in-laws are described through the spouse', () => {
    expect(rel('COUSIN', 'SPOUSE')).toBe("1st cousin's spouse");
    expect(relationship('COUSIN', 'SPOUSE', indis, unions).path).toEqual(['COUSIN', 'UNCLE', 'GP1', 'P1', 'ME', 'SPOUSE']);
  });

  it('related by marriage further out, with the linking path', () => {
    // A+B → C;  C+D;  E → D  (E is D's parent: A and E are co-parents-in-law)
    const people = new Map(['A', 'B', 'C', 'D', 'E'].map(id => [id, mkI(id)] as const));
    const fams = new Map([
      ['F1', mkU('F1', ['A', 'B'], ['C'])], ['F2', mkU('F2', ['C', 'D'], [])], ['F3', mkU('F3', ['E'], ['D'])],
    ]);
    expect(relationship('A', 'E', people, fams)).toEqual({ term: 'related by marriage', path: ['A', 'C', 'D', 'E'] });
  });

  it('names the nearest common ancestor for blood relatives only', () => {
    expect(relationship('ME', 'COUSIN', indis, unions).lca).toBe('GP1');
    expect(relationship('P1', 'SPOUSE', indis, unions)).not.toHaveProperty('lca');
  });

  it('not connected', () => expect(rel('ME', 'UNRELATED')).toBe('not connected'));

  it('path starts at A for connected', () => {
    const r = relationship('ME', 'COUSIN', indis, unions);
    expect(r.path.length).toBeGreaterThan(0);
    expect(r.path[0]).toBe('ME');
  });

  it('path is empty for not-connected', () => {
    const r = relationship('ME', 'UNRELATED', indis, unions);
    expect(r.path).toHaveLength(0);
  });
});

describe('generations()', () => {
  // GF+GM → DAD;  DAD+MOM (married in, no parents) → ME, SIS;  ME+WIFE → KID;  LONE alone
  const ids = ['GF', 'GM', 'DAD', 'MOM', 'ME', 'SIS', 'WIFE', 'KID', 'LONE'];
  const unions = [
    mkU('U1', ['GF', 'GM'], ['DAD']),
    mkU('U2', ['DAD', 'MOM'], ['ME', 'SIS']),
    mkU('U3', ['ME', 'WIFE'], ['KID']),
  ];

  it('numbers generations from the oldest known one, partners sharing a number', () => {
    const g = generations(ids.map(mkI), unions);
    expect(ids.map(id => g.get(id))).toEqual([1, 1, 2, 2, 3, 3, 3, 4, 1]);
  });

  it('gives the same answer whoever is listed first', () => {
    const g = generations([...ids].reverse().map(mkI), unions);
    expect(g.get('GF')).toBe(1);
    expect(g.get('KID')).toBe(4);
    expect(g.get('WIFE')).toBe(3);
  });

  it('puts siblings in a parentless family on the same generation', () => {
    const g = generations(['A', 'B'].map(mkI), [mkU('U', [], ['A', 'B'])]);
    expect([g.get('A'), g.get('B')]).toEqual([1, 1]);
  });
});

describe('traceLayout()', () => {
  const all = [...unions.values()];
  const at = (t: ReturnType<typeof traceLayout>, id: string) => t.cards.find(c => c.id === id)!;

  it('hangs 1st cousins from their grandparent couple', () => {
    const t = traceLayout(relationship('ME', 'COUSIN', indis, unions).path, all);
    expect(t.cards.map(c => c.id).sort()).toEqual(['COUSIN', 'GP1', 'GP2', 'ME', 'P1', 'UNCLE']);
    expect(at(t, 'GP2').partner).toBe(true);
    expect([at(t, 'GP1').y, at(t, 'GP2').y]).toEqual([0, 0]);
    expect(at(t, 'ME').x).toBe(at(t, 'GP1').x);       // A's line under one grandparent
    expect(at(t, 'COUSIN').x).toBe(at(t, 'GP2').x);   // B's line under the other
    expect(at(t, 'P1').y).toBe(at(t, 'UNCLE').y);
    expect(at(t, 'ME').y).toBeGreaterThan(at(t, 'P1').y);
    expect(t.links.filter(l => l.spouse)).toHaveLength(1);
  });

  it('centres a lone shared parent over half-siblings', () => {
    const t = traceLayout(['ME', 'P1', 'HALF_SIB'], all);
    expect(t.cards).toHaveLength(3);
    expect(at(t, 'P1').x).toBe((at(t, 'ME').x + at(t, 'HALF_SIB').x) / 2);
  });

  it('draws a straight line for direct ancestors and a side link for spouses', () => {
    const line = traceLayout(['ME', 'P1', 'GP1'], all);
    expect(new Set(line.cards.map(c => c.x)).size).toBe(1);
    expect(at(line, 'GP1').y).toBe(0);
    const pair = traceLayout(['ME', 'SPOUSE'], all);
    expect(at(pair, 'SPOUSE').y).toBe(at(pair, 'ME').y);
    expect(at(pair, 'SPOUSE').x).toBeGreaterThan(at(pair, 'ME').x);
    expect(pair.links).toEqual([expect.objectContaining({ spouse: true })]);
  });
});

describe('families whose parents are not recorded', () => {
  const p = (id: string): Individual => ({ id, names: [{ full: id }], events: [], unions: [], mediaIds: [], notes: [] });
  const kid = (childId: string) => ({ childId, citations: [], notes: [] });
  // A and B are children of family F, which names no parent; A's child C and B's child D are cousins.
  const people = new Map(['A', 'B', 'C', 'D', 'X'].map((id) => [id, p(id)]));
  const unions = new Map<string, Union>([
    ['F', { id: 'F', spouseIds: [], events: [], childLinks: [kid('A'), kid('B')] }],
    ['FA', { id: 'FA', spouseIds: ['A'], events: [], childLinks: [kid('C')] }],
    ['FB', { id: 'FB', spouseIds: ['B'], events: [], childLinks: [kid('D')] }],
  ]);

  it('children of the same family are siblings', () => {
    expect(relationship('A', 'B', people, unions).term).toBe('sibling');
  });

  it('their children are cousins', () => {
    expect(relationship('C', 'D', people, unions).term).toBe('1st cousin');
  });

  it('a family whose recorded parent is not in the tree still links its children', () => {
    const u = new Map<string, Union>([['G', { id: 'G', spouseIds: ['MISSING'], events: [], childLinks: [kid('A'), kid('B')] }]]);
    expect(relationship('A', 'B', people, u).term).toBe('sibling');
  });

  it('the chain goes through a "parents not recorded" placeholder that the trace can draw', () => {
    const r = relationship('A', 'B', people, unions);
    expect(r.path).toHaveLength(3);
    const aug = withUnrecordedParents(people, unions);
    expect(aug.individuals.get(r.path[1])?.names[0].full).toBe('Parents not recorded');
    expect(traceLayout(r.path, [...aug.unions.values()]).cards).toHaveLength(3);
    expect(people.has(r.path[1])).toBe(false); // the inputs are not changed
  });
});
