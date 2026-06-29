import { describe, it, expect } from 'vitest';
import { findDuplicates } from './dedupe';
import { Individual, UUID } from '../model/types';

function mkI(id: UUID, fullName: string, birt?: string, deat?: string): Individual {
  const events = [
    ...(birt ? [{ type: 'BIRT' as const, date: birt, place: undefined, citations: [], notes: [], rawRef: undefined as never }] : []),
    ...(deat ? [{ type: 'DEAT' as const, date: deat, place: undefined, citations: [], notes: [], rawRef: undefined as never }] : []),
  ];
  return { id, sourceXref: id, names: [{ full: fullName }], sex: 'U', events, unions: [], mediaIds: [], notes: [], rawRef: undefined as never };
}

function mapOf(...indis: Individual[]): Map<UUID, Individual> {
  return new Map(indis.map(i => [i.id, i]));
}

describe('findDuplicates()', () => {
  it('exact name + same birth year → high confidence', () => {
    const m = mapOf(
      mkI('A', 'Juan /García/', '15 JUN 1940'),
      mkI('B', 'Juan /García/', '15 JUN 1940'),
    );
    const res = findDuplicates(m);
    expect(res.length).toBe(1);
    expect(res[0].confidence).toBeGreaterThanOrEqual(0.8);
    expect(res[0].evidence.nameMatch).toBe('exact');
    expect(res[0].evidence.birthYearDelta).toBe(0);
  });

  it('same name + birth year ±1 → medium confidence', () => {
    const m = mapOf(
      mkI('A', 'María /López/', '1 JAN 1965'),
      mkI('B', 'María /López/', '1 JAN 1966'),
    );
    const res = findDuplicates(m);
    expect(res.length).toBe(1);
    expect(res[0].confidence).toBeGreaterThan(0.55);
    expect(res[0].evidence.birthYearDelta).toBe(1);
  });

  it('initial vs full given name → flagged', () => {
    const m = mapOf(
      mkI('A', 'J /García/', '1 JAN 1940'),
      mkI('B', 'Juan /García/', '1 JAN 1940'),
    );
    const res = findDuplicates(m);
    expect(res.length).toBe(1);
    expect(res[0].evidence.nameMatch).toBe('initial');
    expect(res[0].confidence).toBeGreaterThan(MIN_CONFIDENCE_FLOOR);
  });

  it('birth year diff > 5 → not flagged even with same name', () => {
    const m = mapOf(
      mkI('A', 'Pedro /Martínez/', '1 JAN 1900'),
      mkI('B', 'Pedro /Martínez/', '1 JAN 1910'),
    );
    const res = findDuplicates(m);
    expect(res.length).toBe(0);
  });

  it('completely different surnames → not flagged', () => {
    const m = mapOf(
      mkI('A', 'Ana /García/', '1 JAN 1950'),
      mkI('B', 'Ana /López/', '1 JAN 1950'),
    );
    const res = findDuplicates(m);
    expect(res.length).toBe(0);
  });

  it('no name overlap at all → not flagged', () => {
    const m = mapOf(
      mkI('A', 'Carlos /Reyes/', '1 JAN 1960'),
      mkI('B', 'Luisa /Morales/', '1 JAN 1960'),
    );
    const res = findDuplicates(m);
    expect(res.length).toBe(0);
  });

  it('shared parents boost confidence', () => {
    const noParents = findDuplicates(
      mapOf(mkI('A', 'Ana /G/', '1 JAN 1950'), mkI('B', 'Ana /G/', '1 JAN 1950')),
    );
    const withParents = findDuplicates(
      mapOf(mkI('A', 'Ana /G/', '1 JAN 1950'), mkI('B', 'Ana /G/', '1 JAN 1950')),
      new Map([['A', new Set(['P1', 'P2'])], ['B', new Set(['P1', 'P2'])]]),
    );
    expect(withParents[0].confidence).toBeGreaterThan(noParents[0].confidence);
    expect(withParents[0].evidence.sharedParents).toBe(2);
  });

  it('results are ranked by confidence descending', () => {
    const m = mapOf(
      mkI('A', 'Juan /García/', '1 JAN 1940'),
      mkI('B', 'Juan /García/', '1 JAN 1940'),  // exact dup
      mkI('C', 'J /García/', '1 JAN 1940'),     // initial match
    );
    const res = findDuplicates(m);
    expect(res.length).toBeGreaterThan(1);
    for (let i = 1; i < res.length; i++) {
      expect(res[i - 1].confidence).toBeGreaterThanOrEqual(res[i].confidence);
    }
  });

  it('returns evidence fields', () => {
    const m = mapOf(
      mkI('A', 'Rosa /Pérez/', '1 JAN 1970', '1 JAN 2020'),
      mkI('B', 'Rosa /Pérez/', '1 JAN 1970', '1 JAN 2020'),
    );
    const [r] = findDuplicates(m);
    expect(r.evidence.nameMatch).toBe('exact');
    expect(r.evidence.birthYearDelta).toBe(0);
    expect(r.evidence.deathYearDelta).toBe(0);
  });
});

// Referenced in test but not exported — define locally
const MIN_CONFIDENCE_FLOOR = 0.4;
