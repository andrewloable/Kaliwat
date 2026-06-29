/** Lowercase + strip diacritics so "manus" matches "Mañus", "raphael" → "Raphaël". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * True when every whitespace-separated term of `foldedQuery` appears in
 * `foldedHaystack` (any order). Both inputs must already be folded. So
 * "andrew loable" matches "andrew mañus loable" across the middle name.
 */
export function matchesTerms(foldedHaystack: string, foldedQuery: string): boolean {
  if (!foldedQuery) return true;
  return foldedQuery.split(/\s+/).every((t) => foldedHaystack.includes(t));
}
