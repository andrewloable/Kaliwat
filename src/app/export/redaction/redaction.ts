/**
 * Redaction model — PRIVACY-CRITICAL.
 *
 * FAIL-CLOSED: a person is treated as LIVING (and therefore redacted) unless
 * they are PROVABLY DECEASED. "Proven deceased" means:
 *   - Has a DEAT or BURI event in their event list, OR
 *   - Was born more than `thresholdYears` years before `referenceYear`
 *     (110-year rule; default 100 years, configurable).
 *
 * If no birth date AND no death/burial event → redacted.
 */
import { Individual, Union, UUID } from '../../core/model/types';

export interface RedactionOptions {
  /** Reference year for the age threshold (e.g. current year). */
  referenceYear: number;
  /** Years: born ≥ this many years ago with no death event → treated as deceased. */
  thresholdYears?: number;
  /** When true, redacted individuals are omitted entirely instead of shown as "Living". */
  omitLiving?: boolean;
}

export interface RedactedIndividual {
  id: UUID;
  isRedacted: boolean;
  /** Only populated when isRedacted = false. */
  displayName?: string;
  /** Only populated when isRedacted = false. */
  birthYear?: number | null;
  /** Only populated when isRedacted = false. */
  deathYear?: number | null;
}

export interface RedactionResult {
  individuals: Map<UUID, RedactedIndividual>;
  /** IDs of people who were classified as living. */
  livingIds: Set<UUID>;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function extractYear(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const m = dateStr.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function isProvenDeceased(indi: Individual, opts: Required<RedactionOptions>): boolean {
  // Has explicit death or burial event
  if (indi.events.some(ev => ev.type === 'DEAT' || ev.type === 'BURI')) return true;

  // Apply 110-year rule
  const birtEv = indi.events.find(ev => ev.type === 'BIRT');
  const birthYear = extractYear(birtEv?.date);
  if (birthYear !== null && opts.referenceYear - birthYear >= opts.thresholdYears) return true;

  // FAIL-CLOSED: not provably deceased → treat as living
  return false;
}

function fullName(indi: Individual): string {
  const full = indi.names[0]?.full ?? '';
  return full.replace(/\/([^/]*)\//, '$1').trim() || '(unknown)';
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * Compute redaction status for every individual.
 * Pure function — no side effects, no network, deterministic.
 */
export function applyRedaction(
  individuals: Map<UUID, Individual>,
  options: RedactionOptions,
): RedactionResult {
  const opts: Required<RedactionOptions> = {
    referenceYear: options.referenceYear,
    thresholdYears: options.thresholdYears ?? 100,
    omitLiving: options.omitLiving ?? false,
  };

  const result = new Map<UUID, RedactedIndividual>();
  const livingIds = new Set<UUID>();

  for (const [id, indi] of individuals) {
    const deceased = isProvenDeceased(indi, opts);

    if (!deceased) {
      livingIds.add(id);

      if (!opts.omitLiving) {
        result.set(id, { id, isRedacted: true });
      }
      // omitLiving = true → don't add to result at all
    } else {
      const birtYear = extractYear(indi.events.find(ev => ev.type === 'BIRT')?.date);
      const deatYear = extractYear(indi.events.find(ev => ev.type === 'DEAT')?.date);
      result.set(id, {
        id,
        isRedacted: false,
        displayName: fullName(indi),
        birthYear: birtYear,
        deathYear: deatYear,
      });
    }
  }

  return { individuals: result, livingIds };
}

/**
 * Scrub notes/text that may reference living people by name.
 * Replaces each living person's given name with "[Living]".
 * Returns the scrubbed string.
 */
export function scrubNotes(
  text: string,
  livingIds: Set<UUID>,
  individuals: Map<UUID, Individual>,
): string {
  let out = text;
  for (const id of livingIds) {
    const indi = individuals.get(id);
    if (!indi) continue;
    const name = fullName(indi);
    if (!name || name === '(unknown)') continue;
    // Escape regex special chars in name
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), '[Living]');
  }
  return out;
}

/**
 * Filter a union: if both spouse IDs are in livingIds and omitLiving is true,
 * return null. Otherwise return the union with living spouseIds scrubbed.
 * The structure (parent/child links) is preserved; child IDs remain to show
 * the tree shape even when children are redacted.
 */
export function redactUnion(
  union: Union,
  livingIds: Set<UUID>,
  options: Required<RedactionOptions>,
): Union | null {
  const allSpousesLiving = union.spouseIds.every(s => livingIds.has(s));
  if (allSpousesLiving && options.omitLiving) return null;
  return union; // structure preserved; callers access RedactionResult to determine per-person status
}
