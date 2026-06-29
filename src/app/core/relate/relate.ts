import { Individual, Union, UUID } from '../model/types';

export type Kinship =
  | { term: string; path: UUID[] }
  | { term: 'not connected'; path: [] };

function parentIds(id: UUID, unions: Map<UUID, Union>): UUID[] {
  const out: UUID[] = [];
  for (const u of unions.values())
    if (u.childLinks.some(c => c.childId === id)) out.push(...u.spouseIds);
  return out;
}

function childIds(id: UUID, unions: Map<UUID, Union>): UUID[] {
  const out: UUID[] = [];
  for (const u of unions.values())
    if (u.spouseIds.includes(id)) out.push(...u.childLinks.map(c => c.childId));
  return out;
}

function spouseIds(id: UUID, unions: Map<UUID, Union>): UUID[] {
  const out: UUID[] = [];
  for (const u of unions.values())
    if (u.spouseIds.includes(id))
      for (const s of u.spouseIds) if (s !== id) out.push(s);
  return out;
}

function sharedParentCount(a: UUID, b: UUID, unions: Map<UUID, Union>): number {
  const ap = new Set(parentIds(a, unions));
  return parentIds(b, unions).filter(p => ap.has(p)).length;
}

/** BFS upward through parent edges only — for LCA computation. */
function bfsAncestors(
  startId: UUID,
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
  maxDepth = 25,
): Map<UUID, UUID[]> {
  const visited = new Map<UUID, UUID[]>([[startId, [startId]]]);
  const queue: [UUID, UUID[]][] = [[startId, [startId]]];
  while (queue.length) {
    const [id, path] = queue.shift()!;
    if (path.length > maxDepth) continue;
    for (const pid of parentIds(id, unions)) {
      if (visited.has(pid) || !individuals.has(pid)) continue;
      const np = [...path, pid];
      visited.set(pid, np);
      queue.push([pid, np]);
    }
  }
  return visited;
}

/** BFS in both directions (ancestors + descendants) — for in-law detection only. */
function bloodNet(
  startId: UUID,
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
): Set<UUID> {
  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const nId of [...parentIds(id, unions), ...childIds(id, unions)]) {
      if (visited.has(nId) || !individuals.has(nId)) continue;
      visited.add(nId);
      queue.push(nId);
    }
  }
  return visited;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function kinshipTerm(degA: number, degB: number): string {
  if (degA === 0 && degB === 0) return 'self';
  if (degA === 0) {
    if (degB === 1) return 'child';
    if (degB === 2) return 'grandchild';
    const g = degB - 2;
    return 'great-'.repeat(g) + 'grandchild';
  }
  if (degB === 0) {
    if (degA === 1) return 'parent';
    if (degA === 2) return 'grandparent';
    const g = degA - 2;
    return 'great-'.repeat(g) + 'grandparent';
  }
  if (degA === degB) {
    if (degA === 1) return 'sibling';
    return `${ordinal(degA - 1)} cousin`;
  }
  const [shorter, longer] = degA < degB ? [degA, degB] : [degB, degA];
  const isNieceNephewFromA = degB > degA;
  if (shorter === 1) {
    // aunt/uncle or niece/nephew
    const greats = longer - 2; // 0 = aunt/uncle, 1 = great-aunt/uncle …
    const prefix = 'great-'.repeat(greats);
    return prefix + (isNieceNephewFromA ? 'niece/nephew' : 'aunt/uncle');
  }
  // cousins removed
  const N = shorter - 1;
  const removed = longer - shorter;
  const removedStr = removed === 1 ? 'once' : removed === 2 ? 'twice' : `${removed} times`;
  return `${ordinal(N)} cousin ${removedStr} removed`;
}

export function relationship(
  aId: UUID,
  bId: UUID,
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
): Kinship {
  if (!individuals.has(aId) || !individuals.has(bId))
    return { term: 'not connected', path: [] };
  if (aId === bId) return { term: 'self', path: [aId] };

  // Ancestor-only BFS from both sides to find the nearest common ancestor.
  const fromA = bfsAncestors(aId, individuals, unions);
  const fromB = bfsAncestors(bId, individuals, unions);

  let bestLca: UUID | null = null;
  let bestTotal = Infinity;
  let pathA: UUID[] = [], pathB: UUID[] = [];

  for (const [nodeId, pA] of fromA) {
    const pB = fromB.get(nodeId);
    if (!pB) continue;
    const total = pA.length + pB.length - 2;
    if (total < bestTotal) {
      bestTotal = total; bestLca = nodeId; pathA = pA; pathB = pB;
    }
  }

  if (bestLca !== null) {
    const degA = pathA.length - 1;
    const degB = pathB.length - 1;
    let term = kinshipTerm(degA, degB);
    if (term === 'sibling') {
      const shared = sharedParentCount(aId, bId, unions);
      if (shared < 2) term = 'half-sibling';
    }
    const path = [...pathA, ...[...pathB].reverse().slice(1)];
    return { term, path };
  }

  // No blood LCA — check marriage connections.
  const aSpouses = new Set(spouseIds(aId, unions));
  const bSpouses = spouseIds(bId, unions);

  if (aSpouses.has(bId) || bSpouses.includes(aId))
    return { term: 'spouse', path: [aId, bId] };

  // In-law: one of B's spouses is blood-related to A (or vice versa).
  const netA = bloodNet(aId, individuals, unions);
  for (const sp of bSpouses) if (netA.has(sp)) return { term: 'in-law', path: [] };

  const netB = bloodNet(bId, individuals, unions);
  for (const sp of aSpouses) if (netB.has(sp)) return { term: 'in-law', path: [] };

  return { term: 'not connected', path: [] };
}
