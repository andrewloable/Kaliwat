import { describe, it, expect } from 'vitest';
import { birthdaysInWindow } from './anniversaries';
import { Individual, UUID } from '../model/types';

function mkI(id: UUID, birt?: string): Individual {
  return {
    id, sourceXref: id, names: [{ full: `${id} /Test/` }], sex: 'U',
    events: birt ? [{ type: 'BIRT', date: birt, place: undefined, citations: [], notes: [] }] : [],
    unions: [], mediaIds: [], notes: [], rawRef: undefined as never,
  };
}

const TODAY = { year: 2026, month: 6, day: 29 }; // fixed: 29 JUN 2026

describe('birthdaysInWindow()', () => {
  it('includes person with exact birthday today', () => {
    const m = new Map<UUID, Individual>([['A', mkI('A', '29 JUN 1950')]]);
    const res = birthdaysInWindow(m, TODAY);
    expect(res.map(r => r.id)).toContain('A');
    expect(res[0].daysUntil).toBe(0);
  });

  it('includes person with birthday within window', () => {
    const m = new Map<UUID, Individual>([['A', mkI('A', '4 JUL 1940')]]);
    const res = birthdaysInWindow(m, TODAY, 7);
    expect(res.map(r => r.id)).toContain('A');
    expect(res[0].daysUntil).toBe(5);
  });

  it('excludes person with birthday outside window', () => {
    const m = new Map<UUID, Individual>([['A', mkI('A', '1 JAN 1900')]]);
    const res = birthdaysInWindow(m, TODAY, 7);
    expect(res.map(r => r.id)).not.toContain('A');
  });

  it('excludes year-only date (no month/day)', () => {
    const m = new Map<UUID, Individual>([['A', mkI('A', '1950')]]);
    const res = birthdaysInWindow(m, TODAY);
    expect(res).toHaveLength(0);
  });

  it('handles ABT prefix (strips and uses date)', () => {
    const m = new Map<UUID, Individual>([['A', mkI('A', 'ABT 29 JUN 1940')]]);
    const res = birthdaysInWindow(m, TODAY);
    expect(res.map(r => r.id)).toContain('A');
  });

  it('Feb 29 in non-leap year falls back to Feb 28', () => {
    // 2026 is not a leap year; birthday = 29 FEB → treated as 28 FEB
    // TODAY is 29 JUN, so 28 FEB is 243 days away — NOT in 7-day window
    const m = new Map<UUID, Individual>([['A', mkI('A', '29 FEB 1980')]]);
    const nonLeapToday = { year: 2026, month: 2, day: 28 };
    const res = birthdaysInWindow(m, nonLeapToday);
    expect(res.map(r => r.id)).toContain('A');
    expect(res[0].daysUntil).toBe(0); // Feb 29 → Feb 28 in 2026
  });

  it('wouldBe is computed for known birth year', () => {
    const m = new Map<UUID, Individual>([['A', mkI('A', '29 JUN 1950')]]);
    const [r] = birthdaysInWindow(m, TODAY);
    expect(r.wouldBe).toBe(76); // 2026 - 1950
  });

  it('wouldBe is null when no birth year', () => {
    // Partial date with only month/day — create manually
    const indi: Individual = {
      id: 'A', sourceXref: 'A', names: [{ full: 'A /Test/' }], sex: 'U',
      events: [{ type: 'BIRT', date: '29 JUN', citations: [], notes: [] }],
      unions: [], mediaIds: [], notes: [], rawRef: undefined as never,
    };
    const m = new Map<UUID, Individual>([['A', indi]]);
    const [r] = birthdaysInWindow(m, TODAY);
    expect(r?.wouldBe).toBeNull();
  });

  it('results sorted by daysUntil ascending', () => {
    const m = new Map<UUID, Individual>([
      ['A', mkI('A', '4 JUL 1940')],  // 5 days
      ['B', mkI('B', '29 JUN 1950')], // 0 days
    ]);
    const res = birthdaysInWindow(m, TODAY, 7);
    expect(res[0].id).toBe('B');
    expect(res[1].id).toBe('A');
  });

  it('skips people with no birth event', () => {
    const m = new Map<UUID, Individual>([['A', mkI('A')]]);
    expect(birthdaysInWindow(m, TODAY)).toHaveLength(0);
  });
});
