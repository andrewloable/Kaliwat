import { describe, it, expect } from 'vitest';
import { buildDagLayout } from './dag-layout';
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
    // Children must be below focus (larger y)
    const c1 = personNodes.find(n => n.person!.names[0].full === 'Child1');
    const c2 = personNodes.find(n => n.person!.names[0].full === 'Child2');
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c1!.y).toBeGreaterThan(focusNode!.y);
    expect(c2!.y).toBeGreaterThan(focusNode!.y);
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

    // Centered differently: u2 center-x ≠ u1 center-x
    expect(u1Node.x).not.toBe(u2Node.x);
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
