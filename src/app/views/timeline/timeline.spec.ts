import { describe, it, expect } from 'vitest';
import { buildTimeline, parseSortKey } from './timeline';
import { Individual, Union, UUID } from '../../core/model/types';

function mkI(id: UUID, full: string, events: Individual['events'] = []): Individual {
  return { id, sourceXref: id, names: [{ full }], sex: 'U', events, unions: [], mediaIds: [], notes: [], rawRef: undefined as never };
}
function ev(type: string, date?: string, place?: string): Individual['events'][0] {
  return { type, date, place, citations: [], notes: [] };
}
function mkU(id: UUID, spouses: UUID[], children: UUID[], events: Individual['events'] = []): Union {
  return { id, sourceXref: id, spouseIds: spouses, childLinks: children.map(c => ({ childId: c, pedi: undefined, status: undefined, citations: [], notes: [] })), events, rawRef: undefined as never };
}

describe('parseSortKey()', () => {
  it('full date', () => expect(parseSortKey('15 JUN 1940')).toBe(1940 * 10000 + 6 * 100 + 15));
  it('year only', () => expect(parseSortKey('1940')).toBe(1940 * 10000));
  it('ABT prefix', () => expect(parseSortKey('ABT 1890')).toBe(1890 * 10000));
  it('BEF strips to year', () => expect(parseSortKey('BEF 1900')).toBe(1900 * 10000));
  it('missing → Infinity', () => expect(parseSortKey(undefined)).toBe(Infinity));
  it('empty → Infinity', () => expect(parseSortKey('')).toBe(Infinity));
});

describe('buildTimeline()', () => {
  const ana = mkI('ANA', 'Ana /García/', [
    ev('BIRT', '1 JAN 1960', 'Madrid'),
    ev('DEAT', '1 JAN 2050'),
  ]);
  const bob = mkI('BOB', 'Bob /Smith/', []);
  const child = mkI('CHILD', 'Carlos /García/', [ev('BIRT', '15 MAR 1985')]);
  const union = mkU('U1', ['ANA', 'BOB'], ['CHILD'], [ev('MARR', '1 JUN 1984', 'Barcelona')]);

  const indis = new Map<UUID, Individual>([['ANA', ana], ['BOB', bob], ['CHILD', child]]);
  const unions = new Map<UUID, Union>([['U1', union]]);

  it('returns entries in chronological order', () => {
    const entries = buildTimeline('ANA', indis, unions);
    const years = entries.map(e => parseSortKey(e.date));
    for (let i = 1; i < years.length; i++) {
      expect(years[i]).toBeGreaterThanOrEqual(years[i - 1]);
    }
  });

  it('includes birth, marriage, child birth, death', () => {
    const entries = buildTimeline('ANA', indis, unions);
    const kinds = entries.map(e => e.kind);
    expect(kinds).toContain('birth');
    expect(kinds).toContain('marriage');
    expect(kinds).toContain('child-birth');
    expect(kinds).toContain('death');
  });

  it('marriage label includes spouse name', () => {
    const entries = buildTimeline('ANA', indis, unions);
    const marr = entries.find(e => e.kind === 'marriage');
    expect(marr?.label).toContain('Bob');
  });

  it('child-birth label includes child name', () => {
    const entries = buildTimeline('ANA', indis, unions);
    const cb = entries.find(e => e.kind === 'child-birth');
    expect(cb?.label).toContain('Carlos');
  });

  it('ABT date renders without error and places correctly', () => {
    const abt = mkI('X', 'X /X/', [ev('BIRT', 'ABT 1890'), ev('DEAT', '1920')]);
    const entries = buildTimeline('X', new Map([['X', abt]]), new Map());
    expect(entries[0].kind).toBe('birth');
    expect(entries[1].kind).toBe('death');
  });

  it('missing date entry included with date="" and sortKey=Infinity', () => {
    const noDate = mkI('Y', 'Y /Y/', [ev('BIRT', undefined), ev('DEAT', '1980')]);
    const entries = buildTimeline('Y', new Map([['Y', noDate]]), new Map());
    // death should come before undated birth (Infinity sorts last)
    expect(entries[0].kind).toBe('death');
    expect(entries[1].kind).toBe('birth');
  });

  it('returns empty for unknown personId', () => {
    expect(buildTimeline('NOBODY', indis, unions)).toHaveLength(0);
  });

  it('place field populated when available', () => {
    const entries = buildTimeline('ANA', indis, unions);
    const birt = entries.find(e => e.kind === 'birth');
    expect(birt?.place).toBe('Madrid');
  });
});
