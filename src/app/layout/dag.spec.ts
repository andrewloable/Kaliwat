import { describe, it, expect } from 'vitest';
import { buildDagLayout, DagNode } from './dag-layout';
import { CARD_W, CARD_H } from './pedigree-layout';
import { Individual, Union, UUID } from '../core/model/types';

function mkIndi(id: UUID, given: string): Individual {
  return {
    id, sourceXref: `@${id}@`, names: [{ full: given }], sex: 'U',
    events: [], unions: [], mediaIds: [], notes: [], rawRef: undefined as never,
  };
}

function mkUnion(id: UUID, spouseIds: UUID[], childIds: UUID[]): Union {
  return {
    id, sourceXref: `@${id}@`, spouseIds,
    childLinks: childIds.map(cid => ({ childId: cid, pedi: undefined, status: undefined, citations: [], notes: [] })),
    events: [], rawRef: undefined as never,
  };
}

describe('buildDagLayout', () => {
  it('returns empty layout for unknown focusId', () => {
    const layout = buildDagLayout('unknown', new Map(), new Map());
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
  });

  it('focus only (no unions, no parents) renders single node', () => {
    const indis = new Map([['F', mkIndi('F', 'Focus')]]);
    const layout = buildDagLayout('F', indis, new Map());
    const personNodes = layout.nodes.filter(n => n.type === 'person');
    expect(personNodes).toHaveLength(1);
    expect(personNodes[0].isFocus).toBe(true);
    expect(personNodes[0].person!.names[0].full).toBe('Focus');
  });

  it('single union with 2 children: 1 union node, 2 child person nodes', () => {
    const indis = new Map([
      ['F', mkIndi('F', 'Focus')],
      ['S', mkIndi('S', 'Spouse')],
      ['C1', mkIndi('C1', 'Child1')],
      ['C2', mkIndi('C2', 'Child2')],
    ]);
    const u1 = mkUnion('U1', ['F', 'S'], ['C1', 'C2']);
    indis.get('F')!.unions = [{ unionId: 'U1' }];
    indis.get('S')!.unions = [{ unionId: 'U1' }];
    const unions = new Map([['U1', u1]]);

    const layout = buildDagLayout('F', indis, unions);
    const unionNodes = layout.nodes.filter(n => n.type === 'union');
    const personNodes = layout.nodes.filter(n => n.type === 'person');

    expect(unionNodes).toHaveLength(1);
    // Focus + Spouse on row 0, C1 + C2 on row 1 = 4 person nodes
    expect(personNodes).toHaveLength(4);
    const focusNode = personNodes.find(n => n.isFocus);
    expect(focusNode).toBeDefined();
    // Children must be to the right of the focus (generations run left→right)
    const c1 = personNodes.find(n => n.person!.names[0].full === 'Child1');
    const c2 = personNodes.find(n => n.person!.names[0].full === 'Child2');
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c1!.x).toBeGreaterThan(focusNode!.x);
    expect(c2!.x).toBeGreaterThan(focusNode!.x);
    expectNoOverlap(layout.nodes);
  });

  it('vertical option keeps children below the focus', () => {
    const indis = new Map([
      ['F', mkIndi('F', 'Focus')], ['C1', mkIndi('C1', 'Child1')],
    ]);
    indis.get('F')!.unions = [{ unionId: 'U1' }];
    const layout = buildDagLayout('F', indis, new Map([['U1', mkUnion('U1', ['F'], ['C1'])]]), false);
    const [f, c] = ['F', 'C1'].map(id => layout.nodes.find(n => n.person?.id === id)!);
    expect(c.y).toBeGreaterThan(f.y);
    expect(layout.edges.every(e => !e.horizontal)).toBe(true);
  });

  it('children hang from the female spouse card, not the union dot', () => {
    const indis = new Map([
      ['F', { ...mkIndi('F', 'Husband'), sex: 'M' as const }],
      ['S', { ...mkIndi('S', 'Wife'), sex: 'F' as const }],
      ['C1', mkIndi('C1', 'Child1')],
    ]);
    indis.get('F')!.unions = [{ unionId: 'U1' }];
    indis.get('S')!.unions = [{ unionId: 'U1' }];
    const layout = buildDagLayout('F', indis, new Map([['U1', mkUnion('U1', ['F', 'S'], ['C1'])]]));
    const wife = layout.nodes.find(n => n.person?.id === 'S')!;
    const edge = layout.edges.find(e => e.id.endsWith('child-C1'))!;
    // horizontal: the child edge leaves the wife's right edge, at her vertical centre
    expect(edge.x1).toBeCloseTo(wife.x + CARD_W);
    expect(edge.y1).toBeCloseTo(wife.y + CARD_H / 2);
  });

  it('the focus person is linked to the female parent card, not the parents\' dot', () => {
    const indis = new Map([
      ['C', mkIndi('C', 'Child')],
      ['M', { ...mkIndi('M', 'Father'), sex: 'M' as const }],
      ['W', { ...mkIndi('W', 'Mother'), sex: 'F' as const }],
    ]);
    indis.get('C')!.unions = [];
    const layout = buildDagLayout('C', indis, new Map([['U1', mkUnion('U1', ['M', 'W'], ['C'])]]));
    const mother = layout.nodes.find(n => n.person?.id === 'W')!;
    const focus = layout.nodes.find(n => n.isFocus)!;
    const edge = layout.edges.find(e => e.id === 'edge-female-parent-to-focus')!;
    expect(edge).toBeDefined();
    // horizontal: from the mother's right edge at her centre, into the focus person's left edge
    expect(edge.x1).toBeCloseTo(mother.x + CARD_W);
    expect(edge.y1).toBeCloseTo(mother.y + CARD_H / 2);
    expect(edge.x2).toBeCloseTo(focus.x);
    expect(edge.y2).toBeCloseTo(focus.y + CARD_H / 2);
  });

  it('children hang from the union dot when no spouse is female', () => {
    const indis = new Map([['F', mkIndi('F', 'A')], ['S', mkIndi('S', 'B')], ['C1', mkIndi('C1', 'Child1')]]);
    indis.get('F')!.unions = [{ unionId: 'U1' }];
    indis.get('S')!.unions = [{ unionId: 'U1' }];
    const layout = buildDagLayout('F', indis, new Map([['U1', mkUnion('U1', ['F', 'S'], ['C1'])]]));
    const union = layout.nodes.find(n => n.type === 'union')!;
    const edge = layout.edges.find(e => e.id.endsWith('child-C1'))!;
    // horizontal: the child edge leaves the dot's right side (UNION_R past its centre)
    expect(edge.x1).toBeCloseTo(union.x + 14);
    expect(edge.y1).toBeCloseTo(union.y);
  });

  it('horizontal edges are flagged so they curve sideways', () => {
    const indis = new Map([['F', mkIndi('F', 'Focus')], ['S', mkIndi('S', 'Spouse')]]);
    indis.get('F')!.unions = [{ unionId: 'U1' }];
    indis.get('S')!.unions = [{ unionId: 'U1' }];
    const layout = buildDagLayout('F', indis, new Map([['U1', mkUnion('U1', ['F', 'S'], [])]]));
    expect(layout.edges.length).toBeGreaterThan(0);
    expect(layout.edges.every(e => e.horizontal)).toBe(true);
  });

  it('multi-spouse: 2 unions → 2 union nodes with disjoint child sets', () => {
    const indis = new Map([
      ['F', mkIndi('F', 'Focus')],
      ['S1', mkIndi('S1', 'Spouse1')],
      ['S2', mkIndi('S2', 'Spouse2')],
      ['C1', mkIndi('C1', 'ChildA')],
      ['C2', mkIndi('C2', 'ChildB')],
      ['C3', mkIndi('C3', 'ChildC')],
    ]);
    const u1 = mkUnion('U1', ['F', 'S1'], ['C1', 'C2']);
    const u2 = mkUnion('U2', ['F', 'S2'], ['C3']);
    indis.get('F')!.unions = [{ unionId: 'U1' }, { unionId: 'U2' }];
    indis.get('S1')!.unions = [{ unionId: 'U1' }];
    indis.get('S2')!.unions = [{ unionId: 'U2' }];
    const unions = new Map([['U1', u1], ['U2', u2]]);

    const layout = buildDagLayout('F', indis, unions);
    const unionNodes = layout.nodes.filter(n => n.type === 'union');
    expect(unionNodes).toHaveLength(2);

    // Each union node should have exactly its own children (no overlap)
    const u1Node = unionNodes.find(n => n.unionId === 'U1')!;
    const u2Node = unionNodes.find(n => n.unionId === 'U2')!;
    expect(u1Node).toBeDefined();
    expect(u2Node).toBeDefined();

    // Children from different unions must have different x ranges (disjoint)
    const childrenU1 = layout.nodes.filter(n =>
      n.type === 'person' && (n.person!.names[0].full === 'ChildA' || n.person!.names[0].full === 'ChildB'),
    );
    const childrenU2 = layout.nodes.filter(n =>
      n.type === 'person' && n.person!.names[0].full === 'ChildC',
    );
    expect(childrenU1).toHaveLength(2);
    expect(childrenU2).toHaveLength(1);

    // Centered differently across the sibling axis (y when generations run left→right)
    expect(u1Node.y).not.toBe(u2Node.y);
    expectNoOverlap(layout.nodes);
  });

  it('consanguinity (shared ancestor) does not crash or duplicate on same row', () => {
    // Same person appears as BOTH parents (edge case: self-marriage or data error)
    const indis = new Map([
      ['F', mkIndi('F', 'Focus')],
      ['S', mkIndi('S', 'Shared')],
      ['C', mkIndi('C', 'Child')],
    ]);
    const u1 = mkUnion('U1', ['F', 'S'], ['C']);
    // Also S is a parent of F (circular/consanguinity)
    const u2 = mkUnion('U2', ['S', 'S'], ['F']);
    indis.get('F')!.unions = [{ unionId: 'U1' }];
    indis.get('S')!.unions = [{ unionId: 'U1' }, { unionId: 'U2' }];
    const unions = new Map([['U1', u1], ['U2', u2]]);

    // Must not throw
    expect(() => buildDagLayout('F', indis, unions)).not.toThrow();
    const layout = buildDagLayout('F', indis, unions);
    expect(layout.nodes.length).toBeGreaterThan(0);
  });

  it('all coordinates are non-negative after normalization', () => {
    const indis = new Map([
      ['F', mkIndi('F', 'Focus')],
      ['P1', mkIndi('P1', 'Parent1')],
      ['P2', mkIndi('P2', 'Parent2')],
      ['S', mkIndi('S', 'Spouse')],
      ['C', mkIndi('C', 'Child')],
    ]);
    const parentUnion = mkUnion('PU', ['P1', 'P2'], ['F']);
    const childUnion = mkUnion('CU', ['F', 'S'], ['C']);
    indis.get('F')!.unions = [{ unionId: 'CU' }];
    indis.get('S')!.unions = [{ unionId: 'CU' }];
    const unions = new Map([['PU', parentUnion], ['CU', childUnion]]);

    const layout = buildDagLayout('F', indis, unions);
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
    }
  });
});

/** No two person cards may overlap, using the real card size (CARD_W × CARD_H). */
function expectNoOverlap(nodes: DagNode[]): void {
  const boxes = nodes.filter(n => n.type === 'person');
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const apart = a.x + CARD_W <= b.x || b.x + CARD_W <= a.x || a.y + CARD_H <= b.y || b.y + CARD_H <= a.y;
      expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
    }
  }
}
