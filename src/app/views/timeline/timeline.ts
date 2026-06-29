import { Component, input, computed, inject } from '@angular/core';
import { Individual, Union, UUID } from '../../core/model/types';
import { TreeStore } from '../../core/tree-store/tree.store';

export interface TimelineEntry {
  sortKey: number;     // numeric sort key derived from date
  date: string;        // raw date string (may be partial / ABT / missing)
  label: string;       // human-readable event label
  place?: string;
  kind: 'birth' | 'death' | 'marriage' | 'child-birth' | 'other';
  relatedId?: UUID;    // spouse or child ID for derived entries
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** Convert a GEDCOM date string to a numeric sort key. Missing = Infinity. */
export function parseSortKey(dateStr: string | undefined): number {
  if (!dateStr) return Infinity;
  const s = dateStr.toUpperCase().trim();

  // Strip qualifiers: ABT, CAL, EST, BEF, AFT, FROM, TO, BET, AND, …
  const stripped = s.replace(/^(ABT|CAL|EST|CIRCA|BEF|AFT|FROM|TO|BET|AND)\s*/i, '');
  const yearMatch = stripped.match(/\b(\d{4})\b/);
  if (!yearMatch) return Infinity;

  const year = parseInt(yearMatch[1], 10);
  const monthMatch = stripped.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/);
  const month = monthMatch ? MONTHS[monthMatch[1]] : 0;
  const dayMatch = stripped.match(/^(\d{1,2})\s/);
  const day = dayMatch ? parseInt(dayMatch[1], 10) : 0;

  return year * 10000 + month * 100 + day;
}

function displayName(indi: Individual | undefined): string {
  if (!indi) return '(unknown)';
  const full = indi.names[0]?.full ?? '';
  return full.replace(/\/([^/]*)\//, '$1').trim() || '(unknown)';
}

/** Build sorted timeline entries for a focus person. Pure function. */
export function buildTimeline(
  personId: UUID,
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
): TimelineEntry[] {
  const person = individuals.get(personId);
  if (!person) return [];

  const entries: TimelineEntry[] = [];

  // Direct personal events
  for (const ev of person.events) {
    let kind: TimelineEntry['kind'] = 'other';
    let label = ev.type;
    if (ev.type === 'BIRT') { kind = 'birth'; label = 'Born'; }
    else if (ev.type === 'DEAT') { kind = 'death'; label = 'Died'; }
    entries.push({ sortKey: parseSortKey(ev.date), date: ev.date ?? '', label, place: ev.place, kind });
  }

  // Union-derived events
  for (const u of unions.values()) {
    if (!u.spouseIds.includes(personId)) continue;
    const spouseId = u.spouseIds.find(s => s !== personId);
    const spouse = spouseId ? individuals.get(spouseId) : undefined;
    const spouseName = displayName(spouse);

    // Marriage events on the union
    for (const ev of u.events) {
      if (ev.type === 'MARR') {
        entries.push({
          sortKey: parseSortKey(ev.date),
          date: ev.date ?? '',
          label: `Married ${spouseName}`,
          place: ev.place,
          kind: 'marriage',
          relatedId: spouseId,
        });
      }
    }

    // Children's births
    for (const cl of u.childLinks) {
      const child = individuals.get(cl.childId);
      const birtEv = child?.events.find(ev => ev.type === 'BIRT');
      entries.push({
        sortKey: parseSortKey(birtEv?.date),
        date: birtEv?.date ?? '',
        label: `Born ${displayName(child)}`,
        place: birtEv?.place,
        kind: 'child-birth',
        relatedId: cl.childId,
      });
    }
  }

  return entries.sort((a, b) => a.sortKey - b.sortKey);
}

@Component({
  selector: 'app-timeline',
  standalone: true,
  template: `
    <div class="timeline-shell">
      @if (entries().length === 0) {
        <p class="timeline-empty">No events recorded.</p>
      } @else {
        <ol class="timeline-list" aria-label="Life timeline">
          @for (entry of entries(); track entry.sortKey + entry.label) {
            <li class="timeline-entry timeline-entry--{{ entry.kind }}">
              <span class="timeline-date">{{ entry.date || '(date unknown)' }}</span>
              <span class="timeline-label">{{ entry.label }}</span>
              @if (entry.place) {
                <span class="timeline-place">{{ entry.place }}</span>
              }
            </li>
          }
        </ol>
      }
    </div>
  `,
  styles: [`
    .timeline-shell { padding: 1rem; }
    .timeline-list {
      list-style: none; margin: 0; padding: 0;
      border-left: 1px solid var(--line);
    }
    .timeline-entry {
      display: grid;
      grid-template-columns: 10rem 1fr;
      gap: 0.25rem 0.75rem;
      padding: 0.5rem 0 0.5rem 1rem;
      position: relative;
    }
    .timeline-entry::before {
      content: '';
      position: absolute;
      left: -4px; top: 50%;
      width: 7px; height: 7px;
      border-radius: 50%;
      background: var(--accent);
      transform: translateY(-50%);
    }
    @media (prefers-reduced-motion: no-preference) {
      .timeline-entry { transition: background 0.15s; }
      .timeline-entry:hover { background: var(--paper-2); }
    }
    .timeline-date {
      font-family: var(--font-serif);
      font-size: 0.85rem;
      color: var(--ink-soft);
    }
    .timeline-label { font-family: var(--font-serif); }
    .timeline-place {
      grid-column: 2;
      font-size: 0.8rem;
      color: var(--ink-soft);
    }
    .timeline-empty { color: var(--ink-soft); font-style: italic; }
  `],
})
export class TimelineComponent {
  readonly personId = input.required<UUID>();
  private readonly store = inject(TreeStore);

  protected readonly entries = computed(() => {
    const indisMap = new Map(this.store.individuals().map(i => [i.id, i]));
    const unionsMap = new Map(this.store.unions().map(u => [u.id, u]));
    return buildTimeline(this.personId(), indisMap, unionsMap);
  });
}
