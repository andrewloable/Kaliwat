/**
 * Adversarial tests for the redaction model.
 * PRIVACY-CRITICAL: these tests must all pass before any publish feature ships.
 */
import { describe, it, expect } from 'vitest';
import { applyRedaction, scrubNotes } from './redaction';
import { Individual, UUID } from '../../core/model/types';

function mkI(id: UUID, events: Individual['events'] = [], notes: string[] = []): Individual {
  return {
    id, sourceXref: id, names: [{ full: `${id} /Test/` }], sex: 'U',
    events, unions: [], mediaIds: [], notes, rawRef: undefined as never,
  };
}
function ev(type: string, date?: string): Individual['events'][0] {
  return { type, date, citations: [], notes: [] };
}

const REFERENCE_YEAR = 2026;
const BASE_OPTS = { referenceYear: REFERENCE_YEAR };

describe('applyRedaction() — fail-closed defaults', () => {
  it('no dates, no death event → redacted (fail-closed)', () => {
    const m = new Map<UUID, Individual>([['A', mkI('A')]]);
    const { individuals, livingIds } = applyRedaction(m, BASE_OPTS);
    expect(livingIds.has('A')).toBe(true);
    expect(individuals.get('A')?.isRedacted).toBe(true);
  });

  it('has death event → shown (not redacted)', () => {
    const m = new Map([['A', mkI('A', [ev('DEAT', '1 JAN 1990')])]]);
    const { individuals, livingIds } = applyRedaction(m, BASE_OPTS);
    expect(livingIds.has('A')).toBe(false);
    expect(individuals.get('A')?.isRedacted).toBe(false);
  });

  it('has burial event → shown', () => {
    const m = new Map([['A', mkI('A', [ev('BURI', '5 MAY 2000')])]]);
    const { individuals } = applyRedaction(m, BASE_OPTS);
    expect(individuals.get('A')?.isRedacted).toBe(false);
  });

  it('born 1850 no death event → shown (110-year rule, threshold 100)', () => {
    const m = new Map([['A', mkI('A', [ev('BIRT', '1 JAN 1850')])]]);
    const { individuals } = applyRedaction(m, BASE_OPTS);
    expect(individuals.get('A')?.isRedacted).toBe(false);
  });

  it('born 1940 no death event → redacted (not 100+ years ago)', () => {
    const m = new Map([['A', mkI('A', [ev('BIRT', '1 JAN 1940')])]]);
    const { individuals } = applyRedaction(m, BASE_OPTS);
    expect(individuals.get('A')?.isRedacted).toBe(true);
  });

  it('born exactly at threshold → shown (>= not >)', () => {
    // referenceYear=2026, threshold=100 → born in 1926 = exactly 100 years
    const m = new Map([['A', mkI('A', [ev('BIRT', '1 JAN 1926')])]]);
    const { individuals } = applyRedaction(m, BASE_OPTS);
    expect(individuals.get('A')?.isRedacted).toBe(false);
  });

  it('custom threshold respected', () => {
    // threshold=50 → born 1940 (86 years ago) → shown
    const m = new Map([['A', mkI('A', [ev('BIRT', '1 JAN 1940')])]]);
    const { individuals } = applyRedaction(m, { referenceYear: 2026, thresholdYears: 50 });
    expect(individuals.get('A')?.isRedacted).toBe(false);
  });
});

describe('applyRedaction() — redacted node has zero PII', () => {
  it('redacted node has no displayName', () => {
    const m = new Map([['A', mkI('A')]]);
    const { individuals } = applyRedaction(m, BASE_OPTS);
    const node = individuals.get('A');
    expect(node?.displayName).toBeUndefined();
  });

  it('redacted node has no birthYear or deathYear', () => {
    const m = new Map([['A', mkI('A', [ev('BIRT', '1 JAN 1990')])]]);
    const { individuals } = applyRedaction(m, BASE_OPTS);
    const node = individuals.get('A');
    expect(node?.birthYear).toBeUndefined();
    expect(node?.deathYear).toBeUndefined();
  });

  it('shown node has correct displayName', () => {
    const indi = mkI('A', [ev('DEAT', '1 JAN 1990')]);
    indi.names = [{ full: 'María /García/' }];
    const m = new Map([['A', indi]]);
    const { individuals } = applyRedaction(m, BASE_OPTS);
    expect(individuals.get('A')?.displayName).toBe('María García');
  });

  it('shown node has birthYear and deathYear', () => {
    const m = new Map([['A', mkI('A', [ev('BIRT', '1 JAN 1920'), ev('DEAT', '1 JAN 2000')])]]);
    const { individuals } = applyRedaction(m, BASE_OPTS);
    const node = individuals.get('A');
    expect(node?.birthYear).toBe(1920);
    expect(node?.deathYear).toBe(2000);
  });
});

describe('applyRedaction() — omitLiving option', () => {
  it('omitLiving=true removes living from output entirely', () => {
    const m = new Map([
      ['LIVING', mkI('LIVING')],
      ['DEAD', mkI('DEAD', [ev('DEAT', '1 JAN 1990')])],
    ]);
    const { individuals } = applyRedaction(m, { ...BASE_OPTS, omitLiving: true });
    expect(individuals.has('LIVING')).toBe(false);
    expect(individuals.has('DEAD')).toBe(true);
  });

  it('omitLiving=false keeps living as "Living" placeholder', () => {
    const m = new Map([['A', mkI('A')]]);
    const { individuals } = applyRedaction(m, { ...BASE_OPTS, omitLiving: false });
    expect(individuals.has('A')).toBe(true);
    expect(individuals.get('A')?.isRedacted).toBe(true);
  });
});

describe('scrubNotes()', () => {
  it('replaces living person name in notes with [Living]', () => {
    const indi = mkI('A');
    indi.names = [{ full: 'Ana /García/' }];
    const living = new Set<UUID>(['A']);
    const m = new Map([['A', indi]]);
    const result = scrubNotes('Mentioned Ana García in the document.', living, m);
    expect(result).not.toContain('Ana García');
    expect(result).toContain('[Living]');
  });

  it('does not scrub deceased persons', () => {
    const indi = mkI('A');
    indi.names = [{ full: 'Pedro /López/' }];
    const living = new Set<UUID>(); // not living
    const m = new Map([['A', indi]]);
    const result = scrubNotes('Pedro López born 1920.', living, m);
    expect(result).toContain('Pedro López');
  });

  it('returns text unchanged when no living ids', () => {
    const text = 'Some family history text.';
    expect(scrubNotes(text, new Set(), new Map())).toBe(text);
  });
});
