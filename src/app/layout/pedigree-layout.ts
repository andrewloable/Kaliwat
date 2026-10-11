import { hierarchy, tree } from 'd3-hierarchy';
import type { HierarchyPointNode } from 'd3-hierarchy';
import { Individual, Union, UUID } from '../core/model/types';
import { generations } from '../core/relate/relate';

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
  elbow?: boolean;        // drawn as straight segments (down, across, down) rather than a curve
  sideBySide?: boolean;   // partners in the same row: a straight line across
  ladder?: boolean;       // a cascade link: down a spine beside the parent, then straight into the child
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
  compact: boolean | number = false,
  stackRoot = true,
): LayoutData {
  const rootDatum = mode === 'pedigree'
    ? ancestorDatum(focusId, individuals, unions, maxDepth)
    : descendantDatum(focusId, individuals, unions, maxDepth, new Set(), withSpouses);

  if (!rootDatum) return { nodes: [], edges: [] };
  if (compact) {
    const gen = generations([...individuals.values()], [...unions.values()]);
    const l = packTree(rootDatum, focusId, gen, stackRoot, rowGenerationsOf(compact));
    if (mode === 'pedigree') raiseAncestors(l.nodes, l.edges); // ancestors above the focus
    return l;
  }

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

/** Ladder geometry: from the spine beside the parent, straight into the child's left side. */
function ladderGeom(parentLeft: number, parentTop: number, childLeft: number, childTop: number) {
  return {
    x1: parentLeft + LADDER_INSET, y1: parentTop + CARD_H,
    x2: childLeft, y2: childTop + CARD_H / 2,
  };
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
    if (e.ladder) { Object.assign(e, ladderGeom(a.x, a.y, b.x, b.y)); continue; }
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
  compact: boolean | number = false,
): LayoutData {
  const desc = buildLayout(focusId, 'descendants', individuals, unions, maxDepth, true, vertical, compact);
  // The ancestor side keeps the focus's own parents side by side (see packTree).
  const anc = buildLayout(focusId, 'pedigree', individuals, unions, maxDepth, false, vertical, compact, false);
  if (desc.nodes.length === 0) return { nodes: [], edges: [] };

  const dFocus = desc.nodes.find(n => n.isFocus)!;
  const aFocus = anc.nodes.find(n => n.isFocus)!;
  const dx = dFocus.x - aFocus.x;
  const dy = dFocus.y - aFocus.y; // shift ancestors so the shared focus line lines up
  // Top-to-bottom (and compact): the ancestor tree already sits above the focus (see
  // raiseAncestors), so it is only shifted into line. Left-to-right: mirror across x.
  const topDown = vertical || !!compact;

  // Ancestors placed on the far side of the focus (focus itself kept once, from desc).
  const mirror = (n: LayoutNode): LayoutNode => topDown
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
    const down = !e.sideBySide && (topDown || !!e.vertical); // top→bottom, or a stacked generation
    const [L, R] = (down ? a.y <= b.y : a.x <= b.x) ? [a, b] : [b, a];
    const geom = e.ladder
      ? ladderGeom(a.x, a.y, b.x, b.y)
      : down
      ? { x1: L.x + CARD_W / 2, y1: L.y + CARD_H, x2: R.x + CARD_W / 2, y2: R.y, vertical: true, ...(e.elbow ? { elbow: true } : {}) }
      : { x1: L.x + CARD_W, y1: L.y + CARD_H / 2, x2: R.x, y2: R.y + CARD_H / 2 };
    edges.push({
      id: e.id, sourceId: e.sourceId, targetId: e.targetId, ...geom,
      ...(e.spouse ? { spouse: true } : {}), ...(e.ladder ? { ladder: true } : {}),
    });
  }

  return { nodes, edges };
}

// ── Compact layout ──────────────────────────────────────────────────────────
// The first few generations are rows, top to bottom, with siblings side by side
// (COMPACT_DEFAULT_ROW_GENERATIONS unless the view asks for another number). Beyond
// that, each person's descendants cascade beneath them, one indent step per generation
// (a waterfall), in columns when a column would get too tall. Card size and text are
// unchanged.
export const COMPACT_DEFAULT_ROW_GENERATIONS = 4;
/** `compact` is false, true (default rows) or a chosen number of row generations. */
function rowGenerationsOf(compact: boolean | number): number {
  return typeof compact === 'number' ? Math.max(1, Math.floor(compact)) : COMPACT_DEFAULT_ROW_GENERATIONS;
}
export const COMPACT_H_GAP = 28;     // between side-by-side relatives in a row
export const COMPACT_ROW_GAP = 24;   // between a generation's row and the next
export const COMPACT_SUB_GAP = 28;   // between side-by-side stacked columns
export const COMPACT_INDENT = 24;    // stacked generations step right by this much
const LADDER_INSET = 12;             // a cascade's spine runs this far inside the parent's left edge
export const COMPACT_STACK_GAP = 10; // between stacked cards
const ROW_GAP_BELOW = COMPACT_ROW_GAP;

interface Measured { w: number; h: number; groups: Datum[][]; offsets: number[] }

/** Children with partnerless family slots removed, so their children hang off the person. */
function visibleChildren(d: Datum): Datum[] {
  return (d.children ?? []).flatMap(c => (c.person ? [c] : visibleChildren(c)));
}

/** Number of people in a tree, counting only visible cards. */
function countCards(d: Datum): number {
  return 1 + visibleChildren(d).reduce((sum, c) => sum + countCards(c), 0);
}

interface Family {
  anchor: 'person' | 'partner';   // the card the children hang from
  slot: number;                   // partner index (for 'partner'), or -1
  kids: Datum[];
  x: number;                      // left edge of this family's block (relative to the block)
  w: number;                      // width of the block
  anchorCx: number;               // centre of the anchor card (relative to the block)
  cascade: boolean;               // children beyond the row generations: they cascade beneath
  cols: Datum[][];                // cascade columns
  colX: number[];                 // each cascade column's left edge, relative to the block
}

interface Block {
  w: number; h: number;
  dx: number;               // left of the person's card within the block
  partnersX: number[];      // partner cards' left edges within the block
  families: Family[];
}

/**
 * Pack a tree with the compact rules above, top to bottom. Gen is the Gen number
 * shown on the cards. A person's partners sit beside them in the same row. Each
 * family's children hang beneath the card they belong to (the female parent, or each
 * partner when there are several spouses), and that card is centred over them.
 * Children beyond the row generations cascade beneath that card, all siblings together
 * in one column; `stackRoot` false keeps the root's own families in rows
 * (ancestor side of the Full tree).
 */
function packTree(root: Datum, focusId: UUID, gen: Map<UUID, number>, stackRoot: boolean, rowGens: number): LayoutData {
  const genOf = (d: Datum): number => gen.get(d.person?.id ?? '') ?? 1;
  const partnersOf = (d: Datum): Datum[] => visibleChildren(d).filter(c => c.spouse);
  const directOf = (d: Datum): Datum[] => visibleChildren(d).filter(c => !c.spouse);
  const female = (x: Datum) => x.person?.sex === 'F';
  const memo = new Map<Datum, Block>();

  const measure = (d: Datum): Block => {
    const hit = memo.get(d);
    if (hit) return hit;
    const partners = partnersOf(d);
    const direct = directOf(d);

    // Families. Children of the person come first, then one slot per partner (the
    // partner's card, carrying its children when they hang from the partner).
    type Entry = { anchor: 'person' | 'partner'; slot: number; kids: Datum[] };
    const personEntries: Entry[] = [];
    const slotEntries: Entry[] = [];
    if (direct.length) personEntries.push({ anchor: 'person', slot: -1, kids: direct });
    partners.forEach((p, i) => {
      const kids = visibleChildren(p);
      const fromPartner = partners.length > 1 || (!female(d) && female(p));
      if (kids.length && !fromPartner) personEntries.push({ anchor: 'person', slot: i, kids });
      slotEntries.push({ anchor: 'partner', slot: i, kids: fromPartner ? kids : [] });
    });

    let cursor = 0;
    const families: Family[] = [...personEntries, ...slotEntries].map(e => {
      const x = cursor;
      const cascade = e.kids.length > 0
        && (e.anchor === 'partner' || d !== root || stackRoot)
        && e.kids.some(c => genOf(c) > rowGens);
      let w = CARD_W;
      let anchorCx = x + CARD_W / 2;
      let cols: Datum[][] = [];
      const colX: number[] = [];
      if (e.kids.length === 0) {
        // no children: the card alone
      } else if (cascade) {
        // siblings cascade together in one column, so they stay grouped
        cols = [e.kids];
        let off = 0;
        for (const col of cols) {
          colX.push(COMPACT_INDENT + off);
          const colW = Math.max(...col.map(c => measure(c).w));
          w = Math.max(w, COMPACT_INDENT + off + colW);
          off += colW + COMPACT_SUB_GAP;
        }
      } else if (e.kids.length === 1) {
        // a single child is aligned straight under the card it hangs from
        const k = measure(e.kids[0]);
        w = k.w;
        anchorCx = x + k.dx + CARD_W / 2;
      } else {
        w = e.kids.reduce((sum, c) => sum + measure(c).w, 0) + COMPACT_H_GAP * (e.kids.length - 1);
        anchorCx = x + w / 2; // the card is centred over its children
      }
      cursor = x + w + COMPACT_H_GAP;
      return { ...e, x, w, anchorCx, cascade, cols, colX };
    });

    // The person's card sits over their own children, or just left of their first partner.
    const partnerCx = partners.map((_, i) => families.find(f => f.anchor === 'partner' && f.slot === i)!.anchorCx);
    const personFam = families.find(f => f.anchor === 'person');
    const personCx = personFam ? personFam.anchorCx
      : partners.length ? partnerCx[0] - CARD_W - COMPACT_H_GAP
      : CARD_W / 2;

    const lefts = [personCx - CARD_W / 2, ...partnerCx.map(c => c - CARD_W / 2), ...families.map(f => f.x)];
    const shift = -Math.min(0, ...lefts);
    const right = Math.max(personCx + CARD_W / 2, ...partnerCx.map(c => c + CARD_W / 2), ...families.map(f => f.x + f.w));
    const shifted: Family[] = families.map(f => ({ ...f, x: f.x + shift, anchorCx: f.anchorCx + shift }));

    let below = 0;
    for (const f of shifted) {
      const extent = f.cascade
        ? Math.max(...f.cols.map(col => col.reduce((sum, c) => sum + measure(c).h + COMPACT_STACK_GAP, 0)))
        : f.kids.length ? COMPACT_ROW_GAP + Math.max(...f.kids.map(c => measure(c).h)) : 0;
      below = Math.max(below, extent);
    }
    const b: Block = {
      w: Math.max(CARD_W, right + shift),
      h: CARD_H + below,
      dx: personCx + shift - CARD_W / 2,
      partnersX: partnerCx.map(c => c + shift - CARD_W / 2),
      families: shifted,
    };
    memo.set(d, b);
    return b;
  };

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  const place = (d: Datum, X: number, Y: number, depth: number): void => {
    const b = measure(d);
    const cardLeft = X + b.dx;
    nodes.push({ id: d.id, person: d.person!, x: cardLeft, y: Y, depth, isFocus: d.id === focusId });
    const partners = partnersOf(d);
    partners.forEach((p, i) => {
      const px = X + b.partnersX[i];
      nodes.push({ id: p.id, person: p.person!, x: px, y: Y, depth, isFocus: false });
      edges.push({
        id: `${d.id}-${p.id}`, sourceId: d.id, targetId: p.id, spouse: true, sideBySide: true,
        x1: cardLeft + CARD_W, y1: Y + CARD_H / 2, x2: px, y2: Y + CARD_H / 2,
      });
    });

    for (const f of b.families) {
      const anchorId = f.anchor === 'person' ? d.id : partners[f.slot].id;
      const anchorLeft = f.anchor === 'person' ? cardLeft : X + b.partnersX[f.slot];
      const fx = X + f.x;
      if (f.cascade) {
        f.cols.forEach((col, j) => {
          let cy = Y + CARD_H + COMPACT_STACK_GAP;
          const cx = fx + f.colX[j];
          for (const c of col) {
            const cb = measure(c);
            edges.push({
              id: `${anchorId}-${c.id}`, sourceId: anchorId, targetId: c.id, ladder: true,
              ...ladderGeom(anchorLeft, Y, cx + cb.dx, cy),
            });
            place(c, cx, cy, depth + 1);
            cy += cb.h + COMPACT_STACK_GAP;
          }
        });
        continue;
      }
      const childY = Y + CARD_H + COMPACT_ROW_GAP;
      let kx = fx;
      for (const c of f.kids) {
        const cb = measure(c);
        edges.push({
          id: `${anchorId}-${c.id}`, sourceId: anchorId, targetId: c.id, vertical: true, elbow: true,
          x1: anchorLeft + CARD_W / 2, y1: Y + CARD_H,
          x2: kx + cb.dx + CARD_W / 2, y2: childY,
        });
        place(c, kx, childY, depth + 1);
        kx += cb.w + COMPACT_H_GAP;
      }
    }
  };

  place(root, 0, 0, 0);
  return { nodes, edges };
}
