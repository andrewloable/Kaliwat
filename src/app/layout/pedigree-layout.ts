import { hierarchy, tree } from 'd3-hierarchy';
import type { HierarchyPointNode } from 'd3-hierarchy';
import { Individual, Union, UUID } from '../core/model/types';

export const CARD_W = 194;
export const CARD_H = 86;
const H_GAP = 40;
const V_GAP = 20;

export interface LayoutNode {
  id: UUID;
  person: Individual;
  x: number; // top-left SVG x (= generation column)
  y: number; // top-left SVG y (= sibling row, shifted to >= 0)
  depth: number;
  isFocus: boolean;
}

export interface LayoutEdge {
  id: string;
  sourceId?: UUID;
  targetId?: UUID;
  x1: number; y1: number; // right edge of source card, vertical center
  x2: number; y2: number; // left edge of target card, vertical center
}

export interface LayoutData {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

interface Datum { id: UUID; person: Individual; children?: Datum[] }

function parentsOf(personId: UUID, unions: Map<UUID, Union>): UUID[] {
  for (const u of unions.values()) {
    if (u.childLinks.some(c => c.childId === personId)) return u.spouseIds;
  }
  return [];
}

function ancestorDatum(
  id: UUID, individuals: Map<UUID, Individual>, unions: Map<UUID, Union>,
  depth: number, seen = new Set<UUID>(),
): Datum | null {
  if (seen.has(id)) return null;
  seen.add(id);
  const person = individuals.get(id);
  if (!person) return null;
  if (depth === 0) return { id, person };
  const parents = parentsOf(id, unions)
    .map(pid => ancestorDatum(pid, individuals, unions, depth - 1, seen))
    .filter((x): x is Datum => x !== null);
  return { id, person, children: parents.length ? parents : undefined };
}

function descendantDatum(
  id: UUID, individuals: Map<UUID, Individual>, unions: Map<UUID, Union>,
  depth: number, seen = new Set<UUID>(),
): Datum | null {
  if (seen.has(id)) return null;
  seen.add(id);
  const person = individuals.get(id);
  if (!person) return null;
  if (depth === 0) return { id, person };
  const childIds = person.unions.flatMap(ur => {
    const u = unions.get(ur.unionId);
    return u ? u.childLinks.map(c => c.childId) : [];
  });
  const children = childIds
    .map(cid => descendantDatum(cid, individuals, unions, depth - 1, seen))
    .filter((x): x is Datum => x !== null);
  return { id, person, children: children.length ? children : undefined };
}

export function buildLayout(
  focusId: UUID,
  mode: 'pedigree' | 'descendants',
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
  maxDepth = 4,
): LayoutData {
  const rootDatum = mode === 'pedigree'
    ? ancestorDatum(focusId, individuals, unions, maxDepth)
    : descendantDatum(focusId, individuals, unions, maxDepth);

  if (!rootDatum) return { nodes: [], edges: [] };

  const root = hierarchy<Datum>(rootDatum, d => d.children);
  // nodeSize: [vertical spacing, horizontal spacing]
  const layout = tree<Datum>().nodeSize([CARD_H + V_GAP, CARD_W + H_GAP]);
  const pointed: HierarchyPointNode<Datum> = layout(root);

  const all = pointed.descendants();
  const minX = Math.min(...all.map(n => n.x));

  const nodes: LayoutNode[] = all.map(n => ({
    id: n.data.id,
    person: n.data.person,
    x: n.y,             // d3 y (depth column) → SVG left x
    y: n.x - minX,      // d3 x (sibling row) → SVG top y, shifted >= 0
    depth: n.depth,
    isFocus: n.data.id === focusId,
  }));

  const edges: LayoutEdge[] = pointed.links().map(l => ({
    id: `${l.source.data.id}-${l.target.data.id}`,
    sourceId: l.source.data.id,
    targetId: l.target.data.id,
    x1: l.source.y + CARD_W,
    y1: l.source.x - minX + CARD_H / 2,
    x2: l.target.y,
    y2: l.target.x - minX + CARD_H / 2,
  }));

  return { nodes, edges };
}

/**
 * Hourglass: the focus's complete tree — every ancestor to the left, every
 * descendant to the right, the focus in the middle. Built by laying out the
 * ancestor tree and the descendant tree separately (both rooted at the focus),
 * mirroring the ancestors to the left, aligning the two focus rows, and
 * re-deriving each connector left→right from the merged positions.
 */
export function buildCompleteLayout(
  focusId: UUID,
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
  maxDepth = 100,
): LayoutData {
  const desc = buildLayout(focusId, 'descendants', individuals, unions, maxDepth);
  const anc = buildLayout(focusId, 'pedigree', individuals, unions, maxDepth);
  if (desc.nodes.length === 0) return { nodes: [], edges: [] };

  const dFocus = desc.nodes.find(n => n.isFocus)!;
  const aFocus = anc.nodes.find(n => n.isFocus)!;
  const dy = dFocus.y - aFocus.y; // shift ancestors so the shared focus row lines up

  // Ancestors mirrored to the left of the focus (focus itself kept once, from desc).
  const merged = [
    ...desc.nodes,
    ...anc.nodes.filter(n => !n.isFocus).map(n => ({ ...n, x: -n.x, y: n.y + dy })),
  ];

  // Normalise so the whole hourglass sits at x,y >= 0.
  const minX = Math.min(...merged.map(n => n.x));
  const minY = Math.min(...merged.map(n => n.y));
  const nodes: LayoutNode[] = merged.map(n => ({ ...n, x: n.x - minX, y: n.y - minY }));

  const pos = new Map(nodes.map(n => [n.id, n]));
  const edges: LayoutEdge[] = [];
  const seenEdge = new Set<string>();
  for (const e of [...desc.edges, ...anc.edges]) {
    if (!e.sourceId || !e.targetId || seenEdge.has(e.id)) continue;
    const a = pos.get(e.sourceId);
    const b = pos.get(e.targetId);
    if (!a || !b) continue;
    seenEdge.add(e.id);
    const [L, R] = a.x <= b.x ? [a, b] : [b, a];
    edges.push({
      id: e.id, sourceId: e.sourceId, targetId: e.targetId,
      x1: L.x + CARD_W, y1: L.y + CARD_H / 2,
      x2: R.x, y2: R.y + CARD_H / 2,
    });
  }

  return { nodes, edges };
}
