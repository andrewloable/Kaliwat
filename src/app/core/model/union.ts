import { Individual, Union, UUID } from './types';

export interface UnionWithChildren {
  union: Union;
  childIds: UUID[];
}

export function getUnionsWithChildren(
  individual: Individual,
  unionMap: Map<UUID, Union>,
): UnionWithChildren[] {
  return individual.unions
    .map((ref) => {
      const union = unionMap.get(ref.unionId);
      if (!union) return null;
      return { union, childIds: union.childLinks.map((c) => c.childId) };
    })
    .filter((u): u is UnionWithChildren => u !== null);
}
