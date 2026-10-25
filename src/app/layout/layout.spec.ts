import { describe, it, expect } from 'vitest';
import { buildLayout, buildCompleteLayout, CARD_W, CARD_H, LayoutNode, COMPACT_INDENT } from './pedigree-layout';
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

  it('vertical: descendants run downward and no cards overlap', () => {
    const focus = makeIndi('FO', 'Focus', ['UC']);
    const kids = ['K1', 'K2', 'K3'].map(id => makeIndi(id, id));
    const individuals = new Map([['FO', focus], ...kids.map(k => [k.id, k] as const)]);
    const unions = new Map([['UC', makeUnion('UC', ['FO'], kids.map(k => k.id))]]);

    const layout = buildLayout('FO', 'descendants', individuals, unions, 4, false, true);
    const y = (id: string) => layout.nodes.find(n => n.id === id)!.y;
    for (const k of kids) expect(y(k.id)).toBeGreaterThan(y('FO'));
    expectNoOverlap(layout.nodes);
    expect(layout.edges.every(e => e.vertical)).toBe(true);
  });

  it('vertical ancestors: parents sit above the focus person', () => {
    const individuals = new Map([
      ['GP', makeIndi('GP', 'Grandparent', ['UA'])], ['PA', makeIndi('PA', 'Parent', ['UB'])], ['FO', makeIndi('FO', 'Focus')],
    ]);
    const unions = new Map([['UA', makeUnion('UA', ['GP'], ['PA'])], ['UB', makeUnion('UB', ['PA'], ['FO'])]]);
    const layout = buildLayout('FO', 'pedigree', individuals, unions, 4, false, true);
    const y = (id: string) => layout.nodes.find(n => n.id === id)!.y;
    expect(y('PA')).toBeLessThan(y('FO'));
    expect(y('GP')).toBeLessThan(y('PA'));
    expect(Math.min(...layout.nodes.map(n => n.y))).toBeGreaterThanOrEqual(0);
    expectNoOverlap(layout.nodes);
    // the edge runs from the parent's bottom edge down to the focus person's top edge
    const e = layout.edges.find(e => [e.sourceId, e.targetId].sort().join() === 'FO,PA')!;
    expect(e.y1).toBeCloseTo(y('PA') + CARD_H);
    expect(e.y2).toBeCloseTo(y('FO'));
  });

  it('vertical complete: ancestors sit above the focus, descendants below, no overlaps', () => {
    const individuals = new Map([
      ['GP', makeIndi('GP', 'Grandparent', ['UA'])], ['PA', makeIndi('PA', 'Parent', ['UB'])],
      ['FO', makeIndi('FO', 'Focus', ['UC'])], ['CH', makeIndi('CH', 'Child')],
    ]);
    const unions = new Map([
      ['UA', makeUnion('UA', ['GP'], ['PA'])],
      ['UB', makeUnion('UB', ['PA'], ['FO'])],
      ['UC', makeUnion('UC', ['FO'], ['CH'])],
    ]);
    const layout = buildCompleteLayout('FO', individuals, unions, 100, true);
    const y = (id: string) => layout.nodes.find(n => n.id === id)!.y;
    expect(y('GP')).toBeLessThan(y('PA'));
    expect(y('PA')).toBeLessThan(y('FO'));
    expect(y('FO')).toBeLessThan(y('CH'));
    expect(Math.min(...layout.nodes.map(n => n.y))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...layout.nodes.map(n => n.x))).toBeGreaterThanOrEqual(0);
    expectNoOverlap(layout.nodes);
  });

  describe('compact', () => {
    // one couple with 12 children, each child with one grandchild
    const kids = Array.from({ length: 12 }, (_, i) => `K${i}`);
    const individuals = new Map<UUID, Individual>([
      ['FO', makeIndi('FO', 'Focus', ['UC'])],
      ...kids.map(k => [k, makeIndi(k, k, [`U${k}`])] as const),
      ...kids.map(k => [`G${k}`, makeIndi(`G${k}`, `G${k}`)] as const),
    ]);
    const unions = new Map<UUID, Union>([
      ['UC', makeUnion('UC', ['FO'], kids)],
      ...kids.map(k => [`U${k}`, makeUnion(`U${k}`, [k], [`G${k}`])] as const),
    ]);
    const height = (l: { nodes: LayoutNode[] }) => Math.max(...l.nodes.map(n => n.y)) + CARD_H;

    it('a family\'s children sit side by side in one row', () => {
      const compact = buildLayout('FO', 'descendants', individuals, unions, 4, false, false, true);
      const kidNodes = kids.map(k => compact.nodes.find(n => n.id === k)!);
      expect(new Set(kidNodes.map(n => n.y)).size).toBe(1);   // one row
      expect(new Set(kidNodes.map(n => n.x)).size).toBe(kids.length); // each its own column
    });

    it('is shorter than the normal left→right layout of the same tree', () => {
      const normal = buildLayout('FO', 'descendants', individuals, unions);
      const compact = buildLayout('FO', 'descendants', individuals, unions, 4, false, false, true);
      expect(height(compact)).toBeLessThan(height(normal) * 0.6);
    });

    it('has no overlapping cards and every link leaves the parent\'s bottom edge', () => {
      const compact = buildLayout('FO', 'descendants', individuals, unions, 4, false, false, true);
      expectNoOverlap(compact.nodes);
      const parent = compact.nodes.find(n => n.id === 'FO')!;
      const kidEdges = compact.edges.filter(e => e.sourceId === 'FO');
      expect(kidEdges).toHaveLength(kids.length);
      for (const e of kidEdges) expect(e.y1).toBeCloseTo(parent.y + CARD_H);
    });

    it('first three generations are rows, top to bottom; deeper ones stack beneath, indented', () => {
      // FO → K → G → GG → GGG
      const ind = new Map([['FO', makeIndi('FO', 'FO', ['U1'])], ['K', makeIndi('K', 'K', ['U2'])],
        ['G', makeIndi('G', 'G', ['U3'])], ['GG', makeIndi('GG', 'GG', ['U4'])], ['GGG', makeIndi('GGG', 'GGG')]]);
      const un = new Map([['U1', makeUnion('U1', ['FO'], ['K'])], ['U2', makeUnion('U2', ['K'], ['G'])],
        ['U3', makeUnion('U3', ['G'], ['GG'])], ['U4', makeUnion('U4', ['GG'], ['GGG'])]]);
      const layout = buildLayout('FO', 'descendants', ind, un, 4, false, false, 3);
      const n = (id: string) => layout.nodes.find(x => x.id === id)!;
      // generations 1–3 (FO, K, G) are rows: each one further down
      expect(n('K').y).toBeGreaterThan(n('FO').y);
      expect(n('G').y).toBeGreaterThan(n('K').y);
      // generation 4 (GG) is stacked under G, indented, not further right
      expect(n('GG').x).toBeCloseTo(n('G').x + COMPACT_INDENT);
      expect(n('GG').y).toBeGreaterThan(n('G').y + CARD_H - 1);
      // generation 5 (GGG) stacks under GG, indented again
      expect(n('GGG').x).toBeCloseTo(n('GG').x + COMPACT_INDENT);
      expect(n('GGG').y).toBeGreaterThan(n('GG').y + CARD_H - 1);
      expectNoOverlap(layout.nodes);
    });

    it('a Gen 2 person\'s children sit side by side in a row, and their children stack beneath them', () => {
      // GP (Gen 1) → FO (Gen 2) → three children (Gen 3) → one grandchild each (Gen 4)
      const ids = ['GP', 'FO', 'A', 'B', 'C', 'A1', 'B1', 'C1'];
      const ind = new Map<UUID, Individual>(ids.map(id => [id, makeIndi(id, id)] as const));
      ind.get('GP')!.unions = [{ unionId: 'U0' }];
      ind.get('FO')!.unions = [{ unionId: 'U1' }];
      ['A', 'B', 'C'].forEach(k => { ind.get(k)!.unions = [{ unionId: `U${k}` }]; });
      const un = new Map<UUID, Union>([
        ['U0', makeUnion('U0', ['GP'], ['FO'])],
        ['U1', makeUnion('U1', ['FO'], ['A', 'B', 'C'])],
        ['UA', makeUnion('UA', ['A'], ['A1'])], ['UB', makeUnion('UB', ['B'], ['B1'])], ['UC', makeUnion('UC', ['C'], ['C1'])],
      ]);
      const layout = buildLayout('GP', 'descendants', ind, un, 4, false, false, 3);
      const n = (id: string) => layout.nodes.find(x => x.id === id)!;
      // the three children are side by side in one row, under FO
      expect(new Set(['A', 'B', 'C'].map(k => n(k).y)).size).toBe(1);
      expect(new Set(['A', 'B', 'C'].map(k => n(k).x)).size).toBe(3);
      expect(n('A').y).toBeGreaterThan(n('FO').y);
      // their Gen 4 children stack beneath them, indented
      expect(n('A1').x).toBeCloseTo(n('A').x + COMPACT_INDENT);
      expect(n('A1').y).toBeGreaterThan(n('A').y + CARD_H - 1);
      expectNoOverlap(layout.nodes);
    });

    it('by default the first 4 generations are rows and generation 5 onward cascades', () => {
      // FO (1) → K (2) → G (3) → GG (4) → GGG (5)
      const ind = new Map([['FO', makeIndi('FO', 'FO', ['U1'])], ['K', makeIndi('K', 'K', ['U2'])],
        ['G', makeIndi('G', 'G', ['U3'])], ['GG', makeIndi('GG', 'GG', ['U4'])], ['GGG', makeIndi('GGG', 'GGG')]]);
      const un = new Map([['U1', makeUnion('U1', ['FO'], ['K'])], ['U2', makeUnion('U2', ['K'], ['G'])],
        ['U3', makeUnion('U3', ['G'], ['GG'])], ['U4', makeUnion('U4', ['GG'], ['GGG'])]]);
      const layout = buildLayout('FO', 'descendants', ind, un, 4, false, false, true);
      const n = (id: string) => layout.nodes.find(x => x.id === id)!;
      expect(n('GG').y).toBeGreaterThan(n('G').y);          // generation 4 is a row below G
      expect(n('GG').x).toBeCloseTo(n('G').x);               // centred under G, not indented
      expect(n('GGG').x).toBeCloseTo(n('GG').x + COMPACT_INDENT); // generation 5 cascades
      expect(n('GGG').y).toBeGreaterThan(n('GG').y + CARD_H - 1);
    });

    it('the rows setting moves where the cascade starts', () => {
      const layout = buildLayout('FO', 'descendants', new Map([['FO', makeIndi('FO', 'FO', ['U1'])], ['K', makeIndi('K', 'K', ['U2'])],
        ['G', makeIndi('G', 'G', ['U3'])]]), new Map([['U1', makeUnion('U1', ['FO'], ['K'])], ['U2', makeUnion('U2', ['K'], ['G'])],
        ['U3', makeUnion('U3', ['G'], [])]]), 4, false, false, 2);
      const n = (id: string) => layout.nodes.find(x => x.id === id)!;
      // with 2 rows, K (generation 2) is the last row; G (generation 3) cascades beneath it
      expect(n('G').x).toBeCloseTo(n('K').x + COMPACT_INDENT);
    });

    it('partners sit beside their person in the same row; each family hangs beneath its partner', () => {
      // FO (Gen 1) married to Q (Gen 1); their child K (Gen 2) is under Q, and FO's child M is under FO
      const ind = new Map([['FO', { ...makeIndi('FO', 'FO', ['UF', 'UQ']), sex: 'M' as const }], ['Q', { ...makeIndi('Q', 'Q', ['UQ']), sex: 'F' as const }],
        ['K', makeIndi('K', 'K')], ['M', makeIndi('M', 'M')]]);
      const un = new Map([['UQ', makeUnion('UQ', ['FO', 'Q'], ['K'])], ['UF', makeUnion('UF', ['FO'], ['M'])]]);
      const layout = buildLayout('FO', 'descendants', ind, un, 4, true, false, true);
      const fo = layout.nodes.find(x => x.person?.id === 'FO')!;
      const q = layout.nodes.find(x => x.person?.id === 'Q')!;
      const k = layout.nodes.find(x => x.person?.id === 'K')!;
      expect(q.y).toBeCloseTo(fo.y);          // same row
      expect(q.x).toBeGreaterThan(fo.x);      // beside, to the right
      expect(k.y).toBeGreaterThan(q.y);       // their child is in the row beneath
      expect(k.x).toBeCloseTo(q.x);           // straight under the partner
      expect(layout.edges.find(e => e.spouse)).toBeDefined();
      expectNoOverlap(layout.nodes);
    });

    it('children hang from the female parent, or from each partner when there are several spouses', () => {
      const person = (id: string, sex: 'M' | 'F', unions: string[] = []) => ({ ...makeIndi(id, id, unions), sex });
      const sources = (root: string, people: Individual[], fams: Union[]) => {
        const ind = new Map(people.map(p => [p.id, p] as const));
        const un = new Map(fams.map(u => [u.id, u] as const));
        const l = buildLayout(root, 'descendants', ind, un, 4, true, false, true);
        // partner cards carry a family id ('U1-W'); the person is the part after the last dash
        return l.edges.filter(e => (e.targetId ?? '').startsWith('K')).map(e => (e.sourceId ?? '').split('-').pop()!);
      };
      // one husband, one wife: children from the wife (female)
      expect(sources('H', [person('H', 'M', ['U1']), person('W', 'F', ['U1']), person('K1', 'M')],
        [makeUnion('U1', ['H', 'W'], ['K1'])])).toEqual(['W']);
      // a man with two wives: each wife's children from that wife
      const two = sources('H', [person('H', 'M', ['U1', 'U2']), person('W1', 'F', ['U1']), person('W2', 'F', ['U2']),
        person('K1', 'M'), person('K2', 'M')], [makeUnion('U1', ['H', 'W1'], ['K1']), makeUnion('U2', ['H', 'W2'], ['K2'])]);
      expect(two.sort()).toEqual(['W1', 'W2']);
      // a woman with two husbands: each husband's children from that husband
      const twoH = sources('W', [person('W', 'F', ['U1', 'U2']), person('H1', 'M', ['U1']), person('H2', 'M', ['U2']),
        person('K1', 'M'), person('K2', 'M')], [makeUnion('U1', ['H1', 'W'], ['K1']), makeUnion('U2', ['H2', 'W'], ['K2'])]);
      expect(twoH.sort()).toEqual(['H1', 'H2']);
    });

    it('in a cascade, each wife\'s children cascade beneath that wife, not beneath the husband', () => {
      const person = (id: string, sex: 'M' | 'F', unions: string[] = []) => ({ ...makeIndi(id, id, unions), sex });
      const ind = new Map<string, Individual>([['H', person('H', 'M', ['U1', 'U2'])], ['W1', person('W1', 'F', ['U1'])],
        ['W2', person('W2', 'F', ['U2'])], ['K1', makeIndi('K1', 'K1')], ['K2', makeIndi('K2', 'K2')]]);
      const un = new Map<string, Union>([['U1', makeUnion('U1', ['H', 'W1'], ['K1'])], ['U2', makeUnion('U2', ['H', 'W2'], ['K2'])]]);
      // one row only, so the children cascade
      const layout = buildLayout('H', 'descendants', ind, un, 4, true, false, 1);
      const at = (id: string) => layout.nodes.find(n => n.person?.id === id)!;
      const w1 = at('W1'), w2 = at('W2'), k1 = at('K1'), k2 = at('K2');
      expect(k1.x).toBeGreaterThan(w1.x);
      expect(k1.x).toBeLessThan(w1.x + CARD_W);     // starts under wife 1
      expect(k2.x).toBeGreaterThan(w2.x);
      expect(k2.x).toBeLessThan(w2.x + CARD_W);     // starts under wife 2
      expect(k2.x).toBeGreaterThan(k1.x);
      expectNoOverlap(layout.nodes);
    });

    it('a cascade link runs down a spine beside the parent, never through the child cards', () => {
      const layout = buildLayout('FO', 'descendants', new Map([['FO', makeIndi('FO', 'FO', ['U1'])], ['K', makeIndi('K', 'K', ['U2'])],
        ['G', makeIndi('G', 'G', ['U3'])], ['GG', makeIndi('GG', 'GG', ['U4'])], ['GGG', makeIndi('GGG', 'GGG')]]),
        new Map([['U1', makeUnion('U1', ['FO'], ['K'])], ['U2', makeUnion('U2', ['K'], ['G'])],
          ['U3', makeUnion('U3', ['G'], ['GG'])], ['U4', makeUnion('U4', ['GG'], ['GGG'])]]), 4, false, false, 3);
      const gg = layout.nodes.find(n => n.id === 'GG')!;
      const ladder = layout.edges.find(e => e.targetId === 'GGG')!;
      expect(ladder.ladder).toBe(true);
      expect(ladder.x1).toBeGreaterThan(gg.x - 1);          // spine starts inside the parent's card
      expect(ladder.x1).toBeLessThan(gg.x + COMPACT_INDENT); // ...and runs left of the child cards
      expect(ladder.x2).toBeCloseTo(layout.nodes.find(n => n.id === 'GGG')!.x);
    });

    it('siblings that cascade stay together in one column, with no overlaps', () => {
      // G has 40 children, each with no descendants: far too tall for one column
      const kids = Array.from({ length: 40 }, (_, i) => `C${i}`);
      const ind = new Map<UUID, Individual>([['FO', makeIndi('FO', 'FO', ['U1'])], ['K', makeIndi('K', 'K', ['U2'])],
        ['G', makeIndi('G', 'G', ['U3'])], ...kids.map(k => [k, makeIndi(k, k)] as const)]);
      const un = new Map<UUID, Union>([['U1', makeUnion('U1', ['FO'], ['K'])], ['U2', makeUnion('U2', ['K'], ['G'])],
        ['U3', makeUnion('U3', ['G'], kids)]]);
      const layout = buildLayout('FO', 'descendants', ind, un, 4, false, false, 3);
      const columns = new Set(kids.map(k => layout.nodes.find(n => n.id === k)!.x));
      expect(columns.size).toBe(1); // all forty in one column
      expectNoOverlap(layout.nodes);
    });

    it('complete compact: ancestors above the focus, descendants below, no overlaps', () => {
      const ind = new Map(individuals);
      ind.set('PA', makeIndi('PA', 'Parent', ['UP']));
      ind.set('GP', makeIndi('GP', 'Grandparent'));
      const un = new Map(unions);
      un.set('UP', makeUnion('UP', ['PA'], ['FO']));
      un.set('UG', makeUnion('UG', ['GP'], ['PA']));
      const layout = buildCompleteLayout('FO', ind, un, 100, false, true);
      const y = (id: string) => layout.nodes.find(n => n.id === id)!.y;
      expect(y('GP')).toBeLessThan(y('PA'));
      expect(y('PA')).toBeLessThan(y('FO'));
      expect(y('FO')).toBeLessThan(y('K0'));
      expectNoOverlap(layout.nodes);
    });
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

/** No two cards may overlap, using the real card size (CARD_W × CARD_H). */
function expectNoOverlap(nodes: LayoutNode[]): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const apart = a.x + CARD_W <= b.x || b.x + CARD_W <= a.x || a.y + CARD_H <= b.y || b.y + CARD_H <= a.y;
      expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
    }
  }
}
