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
  spouse?: boolean;       // person → partner link (drawn with a ⚭ marker)
  vertical?: boolean;     // generations run top→bottom; draw the curve downward
}

export interface LayoutData {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

// `person` is unset for a partnerless family slot (children hang straight off the
// parent); `spouse` marks a partner card inserted between a person and their children.
interface Datum { id: string; person?: Individual; spouse?: boolean; children?: Datum[] }

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
  depth: number, seen = new Set<UUID>(), withSpouses = false,
): Datum | null {
  if (seen.has(id)) return null;
  seen.add(id);
  const person = individuals.get(id);
  if (!person) return null;
  if (depth === 0) return { id, person };
  if (withSpouses) {
    // One slot per family: the partner's card, with that family's children under it.
    const families = person.unions.flatMap(ur => {
      const u = unions.get(ur.unionId);
      if (!u) return [];
      const kids = u.childLinks
        .map(c => descendantDatum(c.childId, individuals, unions, depth - 1, seen, true))
        .filter((x): x is Datum => x !== null);
      const partner = individuals.get(u.spouseIds.find(sid => sid !== id) ?? '');
      if (!partner && !kids.length) return [];
      return [{
        id: `${u.id}-${partner?.id ?? 'none'}`, person: partner, spouse: !!partner,
        children: kids.length ? kids : undefined,
      }];
    });
    return { id, person, children: families.length ? families : undefined };
  }
  const childIds = person.unions.flatMap(ur => {
    const u = unions.get(ur.unionId);
    return u ? u.childLinks.map(c => c.childId) : [];
  });
  const children = childIds
    .map(cid => descendantDatum(cid, individuals, unions, depth - 1, seen))
    .filter((x): x is Datum => x !== null);
  return { id, person, children: children.length ? children : undefined };
}

/** Flip a layout built left→right into top→bottom (generations become rows). */
function flipToVertical(nodes: LayoutNode[], edges: LayoutEdge[]): void {
  for (const n of nodes) [n.x, n.y] = [n.y, n.x];
  for (const e of edges) {
    [e.x1, e.y1] = [e.y1, e.x1];
    [e.x2, e.y2] = [e.y2, e.x2];
    e.vertical = true;
  }
}

/**
 * One tree (ancestors or descendants). Laid out left→right by default; `vertical`
 * lays it out top→bottom instead, by swapping the card axes and flipping at the end.
 */
export function buildLayout(
  focusId: UUID,
  mode: 'pedigree' | 'descendants',
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
  maxDepth = 4,
  withSpouses = false,
  vertical = false,
): LayoutData {
  const rootDatum = mode === 'pedigree'
    ? ancestorDatum(focusId, individuals, unions, maxDepth)
    : descendantDatum(focusId, individuals, unions, maxDepth, new Set(), withSpouses);

  if (!rootDatum) return { nodes: [], edges: [] };

  // Card size along the sibling and generation axes of the local (left→right) layout.
  const CW = vertical ? CARD_H : CARD_W;
  const CH = vertical ? CARD_W : CARD_H;
  const root = hierarchy<Datum>(rootDatum, d => d.children);
  // nodeSize: [vertical spacing, horizontal spacing]
  const layout = tree<Datum>().nodeSize([CH + V_GAP, CW + H_GAP]);
  const pointed: HierarchyPointNode<Datum> = layout(root);

  const all = pointed.descendants().filter(n => n.data.person);
  const minX = Math.min(...all.map(n => n.x));

  const nodes: LayoutNode[] = all.map(n => ({
    id: n.data.id,
    person: n.data.person!,
    x: n.y,             // d3 y (depth column) → SVG left x
    y: n.x - minX,      // d3 x (sibling row) → SVG top y, shifted >= 0
    depth: n.depth,
    isFocus: n.data.id === focusId,
  }));

  // Link each card to its nearest visible ancestor (skipping partnerless family slots).
  const edges: LayoutEdge[] = all.flatMap(t => {
    let s = t.parent;
    while (s && !s.data.person) s = s.parent;
    if (!s) return [];
    return [{
      id: `${s.data.id}-${t.data.id}`,
      sourceId: s.data.id,
      targetId: t.data.id,
      x1: s.y + CW,
      y1: s.x - minX + CH / 2,
      x2: t.y,
      y2: t.x - minX + CH / 2,
      ...(t.data.spouse ? { spouse: true } : {}),
    }];
  });

  if (vertical) {
    flipToVertical(nodes, edges);
    if (mode === 'pedigree') raiseAncestors(nodes, edges);
  }
  return { nodes, edges };
}

/**
 * Top→bottom ancestors read upward, as in a pedigree chart: the focus person sits
 * at the bottom and their parents above them (matches the Full tree's layout).
 */
function raiseAncestors(nodes: LayoutNode[], edges: LayoutEdge[]): void {
  const maxY = Math.max(...nodes.map(n => n.y));
  for (const n of nodes) n.y = maxY - n.y;
  const pos = new Map(nodes.map(n => [n.id, n]));
  for (const e of edges) {
    const a = pos.get(e.sourceId!), b = pos.get(e.targetId!);
    if (!a || !b) continue;
    const [upper, lower] = a.y <= b.y ? [a, b] : [b, a];
    Object.assign(e, {
      x1: upper.x + CARD_W / 2, y1: upper.y + CARD_H,
      x2: lower.x + CARD_W / 2, y2: lower.y,
    });
  }
}

/**
 * Hourglass: the focus's complete tree — every ancestor on one side, every
 * descendant on the other, the focus in the middle (left/right, or top/bottom when
 * `vertical`). On the descendant side each partner gets a card (⚭ link) with that
 * family's children under it, so children of different partners stay apart. Built by
 * laying out the ancestor tree and the descendant tree separately (both rooted at
 * the focus), mirroring the ancestors across the focus, aligning the two focus
 * lines, and re-deriving each connector from the merged positions.
 */
export function buildCompleteLayout(
  focusId: UUID,
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
  maxDepth = 100,
  vertical = false,
): LayoutData {
  const desc = buildLayout(focusId, 'descendants', individuals, unions, maxDepth, true, vertical);
  const anc = buildLayout(focusId, 'pedigree', individuals, unions, maxDepth, false, vertical);
  if (desc.nodes.length === 0) return { nodes: [], edges: [] };

  const dFocus = desc.nodes.find(n => n.isFocus)!;
  const aFocus = anc.nodes.find(n => n.isFocus)!;
  const dx = dFocus.x - aFocus.x;
  const dy = dFocus.y - aFocus.y; // shift ancestors so the shared focus line lines up

  // Ancestors placed on the far side of the focus (focus itself kept once, from desc).
  // Horizontal: mirror across x. Vertical: the ancestor tree already sits above the
  // focus (see raiseAncestors), so only shift it into line.
  const mirror = (n: LayoutNode): LayoutNode => vertical
    ? { ...n, x: n.x + dx, y: n.y + dy }
    : { ...n, x: -n.x, y: n.y + dy };
  const merged = [...desc.nodes, ...anc.nodes.filter(n => !n.isFocus).map(mirror)];

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
    const [L, R] = (vertical ? a.y <= b.y : a.x <= b.x) ? [a, b] : [b, a];
    const geom = vertical
      ? { x1: L.x + CARD_W / 2, y1: L.y + CARD_H, x2: R.x + CARD_W / 2, y2: R.y, vertical: true }
      : { x1: L.x + CARD_W, y1: L.y + CARD_H / 2, x2: R.x, y2: R.y + CARD_H / 2 };
    edges.push({
      id: e.id, sourceId: e.sourceId, targetId: e.targetId, ...geom,
      ...(e.spouse ? { spouse: true } : {}),
    });
  }

  return { nodes, edges };
}
