import { Individual, UUID } from '../model/types';

export interface DuplicateEvidence {
  nameMatch: 'exact' | 'partial' | 'initial' | 'none';
  birthYearDelta: number | null; // null if either year is missing
  deathYearDelta: number | null;
  sharedParents: number;
  sharedSpouses: number;
}

export interface DuplicateCandidate {
  aId: UUID;
  bId: UUID;
  confidence: number; // 0–1
  evidence: DuplicateEvidence;
}

const MIN_CONFIDENCE = 0.4;

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function extractYear(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const m = dateStr.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function givenName(indi: Individual): string {
  const full = indi.names[0]?.full ?? '';
  // GEDCOM full = "Given /Surname/"
  return full.replace(/\/[^/]*\//, '').trim().split(/\s+/)[0] ?? '';
}

function surname(indi: Individual): string {
  const full = indi.names[0]?.full ?? '';
  const m = full.match(/\/([^/]*)\//) ?? full.match(/\s+(\S+)$/);
  return m ? m[1].trim() : '';
}

function nameScore(a: Individual, b: Individual): { score: number; kind: DuplicateEvidence['nameMatch'] } {
  const agiven = normalizeName(givenName(a));
  const bgiven = normalizeName(givenName(b));
  const asur = normalizeName(surname(a));
  const bsur = normalizeName(surname(b));

  // Surname must have some overlap
  if (asur && bsur && asur !== bsur) {
    // Allow one to be an initial of the other
    if (asur[0] !== bsur[0]) return { score: 0, kind: 'none' };
  }

  if (agiven === bgiven && agiven.length > 1)
    return { score: 1, kind: 'exact' };

  // Initial match: one is a single char that is the first char of the other
  if (
    (agiven.length === 1 && bgiven.startsWith(agiven)) ||
    (bgiven.length === 1 && agiven.startsWith(bgiven))
  ) return { score: 0.6, kind: 'initial' };

  // Prefix match (one starts with the other, e.g. "liz"/"elizabeth" — basic)
  if (agiven.length > 2 && bgiven.startsWith(agiven.slice(0, 3)))
    return { score: 0.5, kind: 'partial' };
  if (bgiven.length > 2 && agiven.startsWith(bgiven.slice(0, 3)))
    return { score: 0.5, kind: 'partial' };

  return { score: 0, kind: 'none' };
}

function yearScore(delta: number | null): number {
  if (delta === null) return 0;
  if (delta === 0) return 1;
  if (delta <= 1) return 0.7;
  if (delta <= 3) return 0.4;
  return 0;
}

function birthYear(indi: Individual): number | null {
  const e = indi.events.find(ev => ev.type === 'BIRT');
  return extractYear(e?.date);
}

function deathYear(indi: Individual): number | null {
  const e = indi.events.find(ev => ev.type === 'DEAT');
  return extractYear(e?.date);
}

export interface FindDuplicatesOptions {
  individuals: Map<UUID, Individual>;
  /** parentIds: set of parent IDs per individual ID (pre-computed for perf) */
  parentSets?: Map<UUID, Set<UUID>>;
  /** spouseIds: set of spouse IDs per individual ID */
  spouseSets?: Map<UUID, Set<UUID>>;
}

export function findDuplicates(
  individuals: Map<UUID, Individual>,
  parentSets: Map<UUID, Set<UUID>> = new Map(),
  spouseSets: Map<UUID, Set<UUID>> = new Map(),
): DuplicateCandidate[] {
  const ids = [...individuals.keys()];
  const results: DuplicateCandidate[] = [];

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = individuals.get(ids[i])!;
      const b = individuals.get(ids[j])!;

      const { score: ns, kind: nameMatch } = nameScore(a, b);
      if (ns === 0) continue; // different surnames → skip immediately

      const bYearA = birthYear(a);
      const bYearB = birthYear(b);
      const dYearA = deathYear(a);
      const dYearB = deathYear(b);

      const bDelta = bYearA !== null && bYearB !== null ? Math.abs(bYearA - bYearB) : null;
      const dDelta = dYearA !== null && dYearB !== null ? Math.abs(dYearA - dYearB) : null;

      // If both birth years known and differ by >5 → not a dup
      if (bDelta !== null && bDelta > 5) continue;

      const bs = yearScore(bDelta);
      const ds = yearScore(dDelta);

      const apars = parentSets.get(ids[i]) ?? new Set<UUID>();
      const bpars = parentSets.get(ids[j]) ?? new Set<UUID>();
      let sharedParents = 0;
      for (const p of apars) if (bpars.has(p)) sharedParents++;

      const aspouses = spouseSets.get(ids[i]) ?? new Set<UUID>();
      const bspouses = spouseSets.get(ids[j]) ?? new Set<UUID>();
      let sharedSpouses = 0;
      for (const s of aspouses) if (bspouses.has(s)) sharedSpouses++;

      // Confidence weights: name (0.5) + birth year (0.3) + death year (0.1) + kin (0.1)
      const kinBonus = Math.min(1, sharedParents * 0.5 + sharedSpouses * 0.3);
      const confidence = ns * 0.5 + bs * 0.3 + ds * 0.1 + kinBonus * 0.1;

      if (confidence < MIN_CONFIDENCE) continue;

      results.push({
        aId: ids[i], bId: ids[j], confidence,
        evidence: { nameMatch, birthYearDelta: bDelta, deathYearDelta: dDelta, sharedParents, sharedSpouses },
      });
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
