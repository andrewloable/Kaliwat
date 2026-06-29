import { Individual, UUID } from '../model/types';

export interface BirthdayMatch {
  id: UUID;
  individual: Individual;
  displayName: string;
  birthDate: string;     // raw date string from model
  daysUntil: number;
  wouldBe: number | null; // birth year known → age if alive; null = unknown
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** Parse a GEDCOM date and return { month, day, year } — any may be null. */
function parseGedcomDate(s: string): { month: number | null; day: number | null; year: number | null } {
  const upper = s.toUpperCase().trim().replace(/^(ABT|CAL|EST|BEF|AFT)\s*/, '');
  const yearM = upper.match(/\b(\d{4})\b/);
  const monthM = upper.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/);
  const dayM = upper.match(/^(\d{1,2})\s/);
  return {
    year: yearM ? parseInt(yearM[1], 10) : null,
    month: monthM ? MONTHS[monthM[1]] : null,
    day: dayM ? parseInt(dayM[1], 10) : null,
  };
}

function displayName(indi: Individual): string {
  const full = indi.names[0]?.full ?? '';
  return full.replace(/\/([^/]*)\//, '$1').trim() || '(unknown)';
}

/**
 * Days from `from` to the next occurrence of (month, day).
 * Returns 0 if (month, day) matches today, up to 365.
 * Handles Feb 29 by treating it as Feb 28 in non-leap years.
 */
function daysUntilAnniversary(
  month: number,
  day: number,
  from: { year: number; month: number; day: number },
): number {
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);

  // Try this year's anniversary
  for (let yearOffset = 0; yearOffset <= 1; yearOffset++) {
    const targetYear = from.year + yearOffset;
    // Feb 29 → use Feb 28 in non-leap years
    let targetDay = day;
    if (month === 2 && day === 29 && !isLeapYear(targetYear)) targetDay = 28;
    const targetMs = Date.UTC(targetYear, month - 1, targetDay);
    const diff = Math.round((targetMs - fromMs) / 86_400_000);
    if (diff >= 0) return diff;
  }
  return 365;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Pure function — `today` is passed in (no internal Date.now()).
 * Returns individuals whose birthday falls within [today, today+windowDays].
 * Sorted by daysUntil ascending.
 */
export function birthdaysInWindow(
  individuals: Map<UUID, Individual>,
  today: { year: number; month: number; day: number },
  windowDays = 7,
): BirthdayMatch[] {
  const results: BirthdayMatch[] = [];

  for (const [id, indi] of individuals) {
    const birtEv = indi.events.find(ev => ev.type === 'BIRT');
    if (!birtEv?.date) continue;
    const { month, day, year } = parseGedcomDate(birtEv.date);
    if (!month || !day) continue; // year-only or no date → skip

    const daysUntil = daysUntilAnniversary(month, day, today);
    if (daysUntil > windowDays) continue;

    const wouldBe = year ? today.year - year + (daysUntil === 0 ? 0 : 1) : null;

    results.push({ id, individual: indi, displayName: displayName(indi), birthDate: birtEv.date, daysUntil, wouldBe });
  }

  return results.sort((a, b) => a.daysUntil - b.daysUntil);
}
