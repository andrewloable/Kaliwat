import { GedcomEvent } from './types';

/** Life events a person can have added in the editor (birth and death have their own fields). */
export interface LifeEventType {
  tag: string;
  label: string;
  /** Takes a short description (the GEDCOM value), e.g. an occupation or a school. */
  description?: string;
  /** "Other event": the person names it (stored as a TYPE under an EVEN record). */
  custom?: boolean;
}

export const LIFE_EVENT_TYPES: LifeEventType[] = [
  { tag: 'BAPM', label: 'Baptism' },
  { tag: 'CHR', label: 'Christening' },
  { tag: 'CONF', label: 'Confirmation' },
  { tag: 'FCOM', label: 'First communion' },
  { tag: 'EDUC', label: 'Education', description: 'School or degree' },
  { tag: 'GRAD', label: 'Graduation' },
  { tag: 'OCCU', label: 'Occupation', description: 'e.g. Teacher' },
  { tag: 'RESI', label: 'Residence' },
  { tag: 'IMMI', label: 'Immigration' },
  { tag: 'EMIG', label: 'Emigration' },
  { tag: 'NATU', label: 'Naturalization' },
  { tag: 'RETI', label: 'Retirement' },
  { tag: 'BURI', label: 'Burial' },
  { tag: 'CREM', label: 'Cremation' },
  { tag: 'EVEN', label: 'Other event', description: 'Details', custom: true },
];

/** Readable name for an event: its known label, or the TYPE of an "other" event. */
export function lifeEventLabel(ev: Pick<GedcomEvent, 'type' | 'raw'>): string {
  if (ev.type === 'EVEN') {
    return ev.raw?.children.find((c) => c.tag === 'TYPE')?.value || 'Event';
  }
  return LIFE_EVENT_TYPES.find((t) => t.tag === ev.type)?.label ?? ev.type;
}
