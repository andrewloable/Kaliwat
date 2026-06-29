/**
 * Family DAG layout (union-node approach, hand-rolled).
 * Spike decision: d3-dag Sugiyama not used — it doesn't model union-between-spouses
 * naturally. Hand-rolled row layout gives full DESIGN.md control.
 *
 * Visual structure (DESIGN.md tree-multi mockup):
 *
 *   Row -1:  [ParentA] [⚭] [ParentB]          ← focus's parents
 *   Row  0:  [SpouseA] [⚭] [FOCUS] [⚭] [SpouseB]  ← focus + all unions
 *   Row +1:  [C1][C2]        [C3][C4]          ← per-union children
 *
 * Edges: person → union node → person (spouses); union node → children (down)
 * Never: spouse → child directly.
 */
import { Individual, Union, UUID } from '../core/model/types';
import { CARD_W, CARD_H } from './pedigree-layout';

const UNION_R = 14;        // union dot radius (px)
const H_GAP = 40;          // horizontal gap between cards
const V_GAP = 60;          // vertical gap between rows
const ROW_H = CARD_H + V_GAP;

export type DagNodeType = 'person' | 'union';

export interface DagNode {
  id: string;
  type: DagNodeType;
  person?: Individual;   // set when type === 'person'
  unionId?: UUID;        // set when type === 'union'
  x: number;            // top-left for person, center-x for union
  y: number;            // top-left for person, center-y for union
  isFocus: boolean;
}

export interface DagEdge {
  id: string;
  x1: number; y1: number;
  x2: number; y2: number;
}

export interface DagLayout {
  nodes: DagNode[];
  edges: DagEdge[];
}

interface Slot {
  type: 'person' | 'union' | 'gap';
  id?: string;
  person?: Individual;
  unionId?: UUID;
  isFocus?: boolean;
  width: number;
}

/** Center-x of a card slot (top-left x + half width). */
function cardCx(slots: Slot[], idx: number): number {
  let x = 0;
  for (let i = 0; i < idx; i++) x += slots[i].width + H_GAP;
  return x + slots[idx].width / 2;
}

/** Top-left x of a slot. */
function slotX(slots: Slot[], idx: number): number {
  let x = 0;
  for (let i = 0; i < idx; i++) x += slots[i].width + H_GAP;
  return x;
}

/** Total width of a slot row. */
function rowWidth(slots: Slot[]): number {
  if (!slots.length) return 0;
  return slots.reduce((sum, s) => sum + s.width, 0) + H_GAP * (slots.length - 1);
}

/**
 * Build the family DAG layout for focusId.
 *
 * Rows:
 *  - parents row (row -1): focus's parents + union node
 *  - focus row (row 0): spouses + union nodes flanking the focus person
 *  - children rows (row +1): per-union children groups, centered under their union node
 *
 * All x coordinates are relative to the focus person's left edge (x=0 at focus).
 * After building, we shift to make everything non-negative.
 */
export function buildDagLayout(
  focusId: UUID,
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
): DagLayout {
  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

  const focus = individuals.get(focusId);
  if (!focus) return { nodes, edges };

  // Circular-reference guard (same person in multiple spots is OK — just render twice)
  const seen = new Set<string>();

  function makePerson(id: UUID, isFocus: boolean, x: number, y: number): DagNode | null {
    const person = individuals.get(id);
    if (!person) return null;
    const nodeKey = `${id}-${Math.round(y / ROW_H)}`;
    if (seen.has(nodeKey)) return null; // same person on same row already placed
    seen.add(nodeKey);
    return { id: `person-${id}-${Math.round(y)}`, type: 'person', person, isFocus, x, y };
  }

  // ── Row 0: focus + unions (spouses flanking) ─────────────────────────────────
  // Build the focus-row slot array: [spouse, union, FOCUS, union, spouse, ...]
  // For each union of the focus person, interleave: other spouses on left/right.

  const focusUnions = focus.unions.map(ur => unions.get(ur.unionId)).filter(Boolean) as Union[];

  // Gather spouses (other members of each union that isn't the focus)
  const unionSpouses: { union: Union; spouse: Individual | null }[] = focusUnions.map(u => {
    const spouseId = u.spouseIds.find(id => id !== focusId);
    return { union: u, spouse: spouseId ? (individuals.get(spouseId) ?? null) : null };
  });

  // Focus person slot at index 0 (relative placement)
  // We'll place: [leftGroup] FOCUS [rightGroup]
  // Split unions into left and right halves
  const leftUnions = unionSpouses.slice(0, Math.floor(unionSpouses.length / 2));
  const rightUnions = unionSpouses.slice(Math.floor(unionSpouses.length / 2));

  // Build row-0 slots
  const row0Slots: Slot[] = [];
  for (const { union, spouse } of leftUnions) {
    if (spouse) row0Slots.push({ type: 'person', id: spouse.id, person: spouse, width: CARD_W });
    row0Slots.push({ type: 'union', id: union.id, unionId: union.id, width: UNION_R * 2 });
  }
  const focusSlotIdx = row0Slots.length;
  row0Slots.push({ type: 'person', id: focusId, person: focus, isFocus: true, width: CARD_W });
  for (const { union, spouse } of rightUnions) {
    row0Slots.push({ type: 'union', id: union.id, unionId: union.id, width: UNION_R * 2 });
    if (spouse) row0Slots.push({ type: 'person', id: spouse.id, person: spouse, width: CARD_W });
  }

  // Focus x reference (top-left of focus card)
  const focusX0 = slotX(row0Slots, focusSlotIdx);
  const ROW0_Y = 0;

  // Render row-0 nodes
  for (let i = 0; i < row0Slots.length; i++) {
    const slot = row0Slots[i];
    const x = slotX(row0Slots, i) - focusX0;
    if (slot.type === 'person') {
      const n = makePerson(slot.id!, slot.isFocus ?? false, x, ROW0_Y);
      if (n) nodes.push(n);
    } else if (slot.type === 'union') {
      const cx = cardCx(row0Slots, i) - focusX0;
      nodes.push({
        id: `union-${slot.unionId}-row0`,
        type: 'union',
        unionId: slot.unionId,
        x: cx, y: ROW0_Y + CARD_H / 2,
        isFocus: false,
      });
    }
  }

  // Edges: spouse → union node, focus → union node (all on row 0)
  for (let i = 0; i < row0Slots.length; i++) {
    const slot = row0Slots[i];
    if (slot.type !== 'union') continue;
    const unionCx = cardCx(row0Slots, i) - focusX0;
    const unionCy = ROW0_Y + CARD_H / 2;

    // Find adjacent person slots (left and right)
    const leftPersonIdx = i - 1;
    const rightPersonIdx = i + 1;
    for (const pi of [leftPersonIdx, rightPersonIdx]) {
      if (pi < 0 || pi >= row0Slots.length) continue;
      const ps = row0Slots[pi];
      if (ps.type !== 'person') continue;
      const personCx = cardCx(row0Slots, pi) - focusX0;
      const fromLeft = pi < i;
      edges.push({
        id: `edge-row0-${ps.id}-to-union-${slot.unionId}`,
        x1: fromLeft ? personCx + CARD_W / 2 : personCx - CARD_W / 2,
        y1: unionCy,
        x2: fromLeft ? unionCx - UNION_R : unionCx + UNION_R,
        y2: unionCy,
      });
    }
  }

  // ── Row +1: children per union ───────────────────────────────────────────────
  const unionChildGroups: { union: Union; unionCx: number; children: Individual[] }[] = [];

  for (let i = 0; i < row0Slots.length; i++) {
    const slot = row0Slots[i];
    if (slot.type !== 'union') continue;
    const union = unions.get(slot.unionId!);
    if (!union) continue;
    const children = union.childLinks
      .map(c => individuals.get(c.childId))
      .filter(Boolean) as Individual[];
    if (!children.length) continue;
    const unionCx = cardCx(row0Slots, i) - focusX0;
    unionChildGroups.push({ union, unionCx, children });
  }

  // Layout children: each group centered under its union node, groups spaced by gap
  const CHILD_Y = ROW0_Y + ROW_H;

  for (const { union, unionCx, children } of unionChildGroups) {
    const groupWidth = children.length * CARD_W + (children.length - 1) * H_GAP;
    const groupStartX = unionCx - groupWidth / 2;
    const unionCy = ROW0_Y + CARD_H / 2;

    for (let ci = 0; ci < children.length; ci++) {
      const child = children[ci];
      const cx = groupStartX + ci * (CARD_W + H_GAP);
      const n = makePerson(child.id, false, cx, CHILD_Y);
      if (n) nodes.push(n);

      const childCx = cx + CARD_W / 2;
      // edge: union node → child
      edges.push({
        id: `edge-union-${union.id}-child-${child.id}`,
        x1: unionCx,
        y1: unionCy + UNION_R,
        x2: childCx,
        y2: CHILD_Y,
      });
    }
  }

  // ── Row -1: parents of focus ──────────────────────────────────────────────────
  // Find the union where focus is a child
  const parentUnion = [...unions.values()].find(u =>
    u.childLinks.some(c => c.childId === focusId),
  );

  if (parentUnion) {
    const PARENT_Y = ROW0_Y - ROW_H;
    const parents = parentUnion.spouseIds
      .map(id => individuals.get(id))
      .filter(Boolean) as Individual[];

    // Place parents centered above the focus person
    const parentsWidth = parents.length * CARD_W + (parents.length > 1 ? H_GAP + UNION_R * 2 + H_GAP : 0);
    let px = -parentsWidth / 2;

    let parentUnionCx: number | null = null;

    for (let pi = 0; pi < parents.length; pi++) {
      const pNode = makePerson(parents[pi].id, false, px, PARENT_Y);
      if (pNode) nodes.push(pNode);

      if (pi < parents.length - 1) {
        // union node between parents
        const cx = px + CARD_W + H_GAP / 2;
        parentUnionCx = cx;
        nodes.push({
          id: `union-${parentUnion.id}-parents`,
          type: 'union',
          unionId: parentUnion.id,
          x: cx, y: PARENT_Y + CARD_H / 2,
          isFocus: false,
        });
        // Edges: parent → parent-union
        edges.push({
          id: `edge-parent-${parents[pi].id}-to-punion`,
          x1: px + CARD_W,
          y1: PARENT_Y + CARD_H / 2,
          x2: cx - UNION_R,
          y2: PARENT_Y + CARD_H / 2,
        });
        px = cx + UNION_R + H_GAP / 2;
      } else if (pi > 0) {
        edges.push({
          id: `edge-parent-${parents[pi].id}-to-punion`,
          x1: px,
          y1: PARENT_Y + CARD_H / 2,
          x2: (parentUnionCx ?? 0) + UNION_R,
          y2: PARENT_Y + CARD_H / 2,
        });
      }

      if (pi < parents.length - 1) px += CARD_W + H_GAP;
    }

    // Edge: parent-union → focus
    if (parentUnionCx !== null) {
      edges.push({
        id: `edge-punion-to-focus`,
        x1: parentUnionCx,
        y1: PARENT_Y + CARD_H / 2 + UNION_R,
        x2: CARD_W / 2, // center of focus card
        y2: ROW0_Y,
      });
    } else if (parents.length === 1) {
      // Single parent: direct edge
      edges.push({
        id: `edge-parent-to-focus`,
        x1: parents.length ? -parentsWidth / 2 + CARD_W / 2 : 0,
        y1: PARENT_Y + CARD_H,
        x2: CARD_W / 2,
        y2: ROW0_Y,
      });
    }
  }

  // ── Normalize: shift all x/y so min x/y >= 0 ────────────────────────────────
  const personNodes = nodes.filter(n => n.type === 'person');
  const minX = personNodes.length ? Math.min(...personNodes.map(n => n.x)) : 0;
  const minY = Math.min(...nodes.map(n => n.type === 'person' ? n.y : n.y - UNION_R), 0);
  const ox = -minX + H_GAP;
  const oy = -minY + V_GAP;

  for (const n of nodes) {
    n.x += ox;
    n.y += oy;
  }
  for (const e of edges) {
    e.x1 += ox; e.y1 += oy;
    e.x2 += ox; e.y2 += oy;
  }

  return { nodes, edges };
}
