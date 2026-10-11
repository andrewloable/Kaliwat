import { Individual, Union, UUID } from '../model/types';

/** What B is to A ("B is A's <term>"), the chain of people linking them (A first, B
 *  last), and for blood relatives their nearest common ancestor. */
export interface Kinship { term: string; path: UUID[]; lca?: UUID }

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

/** Shortest chain of parent/child/spouse links from A to B, or null if unconnected. */
function shortestPath(
  aId: UUID,
  bId: UUID,
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
): UUID[] | null {
  const prev = new Map<UUID, UUID>([[aId, aId]]);
  const queue = [aId];
  for (let i = 0; i < queue.length && !prev.has(bId); i++) {
    const id = queue[i];
    for (const n of [...parentIds(id, unions), ...childIds(id, unions), ...spouseIds(id, unions)]) {
      if (prev.has(n) || !individuals.has(n)) continue;
      prev.set(n, id);
      queue.push(n);
    }
  }
  if (!prev.has(bId)) return null;
  const path = [bId];
  while (path[0] !== aId) path.unshift(prev.get(path[0])!);
  return path;
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

/** Nearest-common-ancestor kinship between blood relatives, or null if none. */
function bloodKinship(
  aId: UUID,
  bId: UUID,
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
): Kinship | null {
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
  if (bestLca === null) return null;

  let term = kinshipTerm(pathA.length - 1, pathB.length - 1);
  if (term === 'sibling' && sharedParentCount(aId, bId, unions) < 2) term = 'half-sibling';
  return { term, path: [...pathA, ...[...pathB].reverse().slice(1)], lca: bestLca };
}

// Plain names for the common one-marriage-away relations.
const IN_LAW: Record<string, string> = {
  "parent's spouse": 'step-parent',
  "child's spouse": 'child-in-law',
  "sibling's spouse": 'sibling-in-law',
  "spouse's parent": 'parent-in-law',
  "spouse's child": 'step-child',
  "spouse's sibling": 'sibling-in-law',
};

export function relationship(
  aId: UUID,
  bId: UUID,
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
): Kinship {
  if (!individuals.has(aId) || !individuals.has(bId))
    return { term: 'not connected', path: [] };
  if (aId === bId) return { term: 'self', path: [aId] };

  const blood = bloodKinship(aId, bId, individuals, unions);
  if (blood) return blood;

  const aSpouses = spouseIds(aId, unions);
  const bSpouses = spouseIds(bId, unions);
  if (aSpouses.includes(bId) || bSpouses.includes(aId))
    return { term: 'spouse', path: [aId, bId] };

  // One marriage away: B married A's blood relative, or B is a blood relative of A's spouse.
  for (const sp of bSpouses) {
    const k = bloodKinship(aId, sp, individuals, unions);
    if (!k) continue;
    const term = k.term.endsWith('aunt/uncle') ? `${k.term} by marriage` : IN_LAW[`${k.term}'s spouse`] ?? `${k.term}'s spouse`;
    return { term, path: [...k.path, bId] };
  }
  for (const sp of aSpouses) {
    const k = bloodKinship(sp, bId, individuals, unions);
    if (k) return { term: IN_LAW[`spouse's ${k.term}`] ?? `spouse's ${k.term}`, path: [aId, ...k.path] };
  }

  const path = shortestPath(aId, bId, individuals, unions);
  return path ? { term: 'related by marriage', path } : { term: 'not connected', path: [] };
}

// ── Relationship trace layout ───────────────────────────────────────────────

export const TRACE_W = 150;
export const TRACE_H = 64;
const TRACE_GX = 44;
const TRACE_GY = 44;

export interface TraceCard { id: UUID; x: number; y: number; partner?: boolean }
export interface TraceLink { x1: number; y1: number; x2: number; y2: number; spouse?: boolean }
export interface TraceLayout { cards: TraceCard[]; links: TraceLink[]; width: number; height: number }

/**
 * Lay a relationship path out as a small family tree: each run of parent/child
 * steps is a vertical line, a change of direction moves one column over, and a
 * spouse step sits side by side (⚭). Where two lines meet at a shared parent whose
 * partner is the other parent of both, that partner is drawn beside them, so
 * cousins hang from their grandparent couple.
 */
export function traceLayout(path: UUID[], unions: Union[]): TraceLayout {
  const famOf = (parent: UUID, child: UUID) =>
    unions.find(u => u.spouseIds.includes(parent) && u.childLinks.some(c => c.childId === child));
  const dirs = path.slice(1).map((id, i) => (famOf(id, path[i]) ? -1 : famOf(path[i], id) ? 1 : 0));

  const row = [0];
  const col = [0];
  let lastVertical = 0;
  dirs.forEach((d, i) => {
    const turn = d !== 0 && lastVertical !== 0 && d !== lastVertical;
    row.push(row[i] + d);
    col.push(d === 0 || turn ? col[i] + 1 : col[i]);
    lastVertical = d;
  });

  const partners: { id: UUID; at: number }[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    if (dirs[i - 1] === 1 && dirs[i] === -1) col[i] += 0.5; // centre a shared child under both parents
    if (dirs[i - 1] !== -1 || dirs[i] !== 1) continue; // the rest is for a peak (shared parent)
    const fam = famOf(path[i], path[i - 1]);
    const partner = fam?.spouseIds.find(s => s !== path[i]);
    if (fam && partner && fam.childLinks.some(c => c.childId === path[i + 1]) && !path.includes(partner)) {
      partners.push({ id: partner, at: i });
    } else {
      col[i] += 0.5; // centre a lone shared parent over both lines
    }
  }

  const top = Math.min(...row);
  const xy = (c: number, r: number) => ({ x: c * (TRACE_W + TRACE_GX), y: (r - top) * (TRACE_H + TRACE_GY) });
  const cards: TraceCard[] = path.map((id, i) => ({ id, ...xy(col[i], row[i]) }));
  for (const p of partners) cards.push({ id: p.id, partner: true, ...xy(col[p.at] + 1, row[p.at]) });

  const side = (l: TraceCard, r: TraceCard): TraceLink =>
    ({ x1: l.x + TRACE_W, y1: l.y + TRACE_H / 2, x2: r.x, y2: r.y + TRACE_H / 2, spouse: true });
  const down = (x1: number, y1: number, lower: TraceCard): TraceLink =>
    ({ x1, y1, x2: lower.x + TRACE_W / 2, y2: lower.y });

  const links: TraceLink[] = [];
  dirs.forEach((d, i) => {
    const [a, b] = [cards[i], cards[i + 1]];
    if (d === 0) { links.push(a.x < b.x ? side(a, b) : side(b, a)); return; }
    const [upper, lower] = d === -1 ? [b, a] : [a, b];
    const couple = partners.find(p => cards[p.at] === upper);
    // children of a drawn couple hang from the ⚭ between them
    links.push(couple
      ? down(upper.x + TRACE_W + TRACE_GX / 2, upper.y + TRACE_H / 2, lower)
      : down(upper.x + TRACE_W / 2, upper.y + TRACE_H, lower));
  });
  for (const p of partners) links.push(side(cards[p.at], cards.find(c => c.partner && c.id === p.id)!));

  return {
    cards, links,
    width: Math.max(...cards.map(c => c.x)) + TRACE_W,
    height: Math.max(...cards.map(c => c.y)) + TRACE_H,
  };
}

/**
 * Generation number per person: 1 = the oldest known generation of their connected
 * family, +1 per step down to children. Partners share a generation, so someone who
 * married in without recorded parents takes their partner's number.
 * ponytail: first-seen wins when a marriage spans generations (e.g. uncle–niece);
 * numbers shift when an older ancestor is added, pin a home person if that matters.
 */
export function generations(individuals: Individual[], unions: Union[]): Map<UUID, number> {
  const known = new Set(individuals.map(i => i.id));
  const links = new Map<UUID, [UUID, number][]>();
  const link = (a: UUID, b: UUID, delta: number) => {
    if (a !== b && known.has(a) && known.has(b)) links.set(a, [...(links.get(a) ?? []), [b, delta]]);
  };
  for (const u of unions) {
    const kids = u.childLinks.map(c => c.childId);
    for (const s of u.spouseIds) {
      for (const t of u.spouseIds) link(s, t, 0);
      for (const k of kids) { link(s, k, 1); link(k, s, -1); }
    }
    if (!u.spouseIds.length) for (const a of kids) for (const b of kids) link(a, b, 0);
  }

  const gen = new Map<UUID, number>();
  for (const { id } of individuals) {
    if (gen.has(id)) continue;
    gen.set(id, 0);
    const group = [id];
    for (let i = 0; i < group.length; i++) {
      for (const [n, d] of links.get(group[i]) ?? []) {
        if (!gen.has(n)) { gen.set(n, gen.get(group[i])! + d); group.push(n); }
      }
    }
    const top = Math.min(...group.map(p => gen.get(p)!));
    for (const p of group) gen.set(p, gen.get(p)! - top + 1);
  }
  return gen;
}
