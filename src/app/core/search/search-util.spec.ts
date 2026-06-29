import { describe, it, expect } from 'vitest';
import { fold, matchesTerms } from './search-util';

describe('fold', () => {
  it('lowercases and strips diacritics', () => {
    expect(fold('Mañus')).toBe('manus');
    expect(fold('Raphaël')).toBe('raphael');
    expect(fold('LOABLE')).toBe('loable');
  });
});

describe('matchesTerms', () => {
  const hay = fold('Andrew Mañus Loable');

  it('matches an empty query', () => {
    expect(matchesTerms(hay, '')).toBe(true);
  });

  it('requires every term, in any order, possibly across middle names', () => {
    expect(matchesTerms(hay, fold('andrew loable'))).toBe(true);
    expect(matchesTerms(hay, fold('loable andrew'))).toBe(true);
    expect(matchesTerms(hay, fold('manus'))).toBe(true); // diacritic-insensitive
  });

  it('fails when any term is absent', () => {
    expect(matchesTerms(hay, fold('andrew smith'))).toBe(false);
  });
});
