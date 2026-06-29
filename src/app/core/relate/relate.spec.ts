import { describe, it, expect } from 'vitest';
import { relationship } from './relate';
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
  it('in-law (parent of spouse)', () => expect(rel('P1', 'SPOUSE')).toBe('in-law'));

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
