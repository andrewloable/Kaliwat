import type { Individual, Union } from '../model/types';

export type RelativeKind = 'parent' | 'spouse' | 'sibling' | 'child';

type Sex = 'M' | 'F' | 'U';
const opposite = (s?: string): Sex => (s === 'M' ? 'F' : s === 'F' ? 'M' : 'U');

/**
 * Prefill for a new relative of `anchor`.
 * Surname: child → father's (the anchor if male, else the male partner of the chosen/only
 * family, else the anchor's own); sibling → the anchor's; spouse/parent → none.
 * Sex: spouse → opposite of the anchor; parent → opposite of the one parent already
 * recorded; otherwise unknown.
 */
export function relativeDefaults(
  kind: RelativeKind,
  anchor: Individual,
  individuals: Individual[],
  unions: Union[],
  childUnionId?: string,
): { surname: string; sex: Sex } {
  const own = anchor.names[0]?.surname ?? '';
  if (kind === 'sibling') return { surname: own, sex: 'U' };
  if (kind === 'spouse') return { surname: '', sex: opposite(anchor.sex) };
  if (kind === 'parent') {
    const family = unions.find((u) => u.childLinks.some((c) => c.childId === anchor.id));
    const only = family?.spouseIds.length === 1 ? individuals.find((i) => i.id === family.spouseIds[0]) : undefined;
    return { surname: '', sex: opposite(only?.sex) };
  }
  if (anchor.sex === 'M') return { surname: own, sex: 'U' };
  const mine = unions.filter((u) => u.spouseIds.includes(anchor.id));
  const family = childUnionId ? mine.find((u) => u.id === childUnionId) : mine.length === 1 ? mine[0] : undefined;
  const father = family?.spouseIds.filter((id) => id !== anchor.id)
    .map((id) => individuals.find((i) => i.id === id)).find((i) => i?.sex === 'M');
  return { surname: father?.names[0]?.surname ?? own, sex: 'U' };
}
