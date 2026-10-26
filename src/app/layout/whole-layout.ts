import { Individual, Union, UUID } from '../core/model/types';
import { generations } from '../core/relate/relate';
import { hierarchy, tree } from 'd3-hierarchy';
import { CARD_W, CARD_H, LayoutData, LayoutEdge, LayoutNode } from './pedigree-layout';

const ROW_GAP_V = 60; // between generation rows, top to bottom
const ROW_GAP_H = 80; // between generation columns, left to right (room for the elbows)

/** A card group in the drawing: a person with the partners who married into the tree beside them (or, for
 *  children whose parents are not in the tree, an invisible family holding the siblings). */
interface Unit {
  key: string;
  members: UUID[]; // left to right
  unions: Union[]; // the families whose children hang under this group, left to right
  depth: number; // generation row (0 = first)
}

/** A node of the packing tree: a family group, or an invisible step (unit null) down to a later generation. */
interface Node { unit: Unit | null; children: Node[] }

/**
 * Everyone in the tree, by generation: each generation is a row (top to bottom) or a column (left to right).
 * A person with parents in the tree sits under them; partners without parents in the tree sit beside their
 * partner; each family's descendants take their own band, so the lines of different families never cross.
 * Unconnected groups follow the main family, the largest first. Nobody appears twice, and only `isFocus`
 * depends on `focusId`, never where a card goes.
 * ponytail: a marriage between two people who both have parents in the tree is drawn as one long line between
 * their families; draw such couples differently if the long lines get in the way.
 */
export function buildWholeLayout(
  individuals: Map<UUID, Individual>,
  unions: Map<UUID, Union>,
  focusId: UUID | null,
  vertical: boolean,
): LayoutData {
  const people = [...individuals.values()];
  if (!people.length) return { nodes: [], edges: [] };
  const gen = generations(people, [...unions.values()]);
  const g = (id: UUID) => gen.get(id) ?? 1;

  // Card size and spacing along the row and along the generation axis.
  const along = vertical ? CARD_W : CARD_H;
  const across = vertical ? CARD_H : CARD_W;
  const gap = vertical ? 40 : 20; // between partners and between siblings
  const bandGap = vertical ? 60 : 36; // between one family's band and the next
  const step = across + (vertical ? ROW_GAP_V : ROW_GAP_H);

  const inTree = (id: UUID) => individuals.has(id);
  const spousesIn = (u: Union) => u.spouseIds.filter(inTree);
  const ownUnions = (id: UUID) => (individuals.get(id)?.unions ?? []).map((r) => unions.get(r.unionId)).filter((u): u is Union => !!u);
  const partnerIn = (u: Union, id: UUID) => spousesIn(u).find((s) => s !== id);
  // The family a person is drawn under (the first that lists them as a child).
  const parentUnion = new Map<UUID, Union>();
  for (const u of unions.values()) for (const c of u.childLinks) if (inTree(c.childId) && !parentUnion.has(c.childId)) parentUnion.set(c.childId, u);

  // Who sits beside a partner: someone with no parents in the tree, next to the first partner who has parents
  // (else the first partner already heading a group). Everyone else heads their own group.
  const besideOf = new Map<UUID, UUID>();
  const heads = new Set<UUID>();
  for (const p of people) {
    if (parentUnion.has(p.id)) { heads.add(p.id); continue; }
    const partners = ownUnions(p.id).map((u) => partnerIn(u, p.id)).filter((q): q is UUID => !!q);
    const anchor = partners.find((q) => parentUnion.has(q)) ?? partners.find((q) => heads.has(q));
    if (anchor) besideOf.set(p.id, anchor);
    else heads.add(p.id);
  }
  const headOf = (id: UUID) => besideOf.get(id) ?? id;
  // The group a family's children hang under: the group of its first parent in the tree.
  const homeOf = (u: Union) => {
    const s = spousesIn(u);
    return s.length ? headOf(s[0]) : `family:${u.id}`;
  };
  const homed = new Map<string, Union[]>();
  for (const u of unions.values()) if (u.childLinks.some((c) => inTree(c.childId))) homed.set(homeOf(u), [...(homed.get(homeOf(u)) ?? []), u]);

  const unitOf = (key: string, depth: number): Unit => {
    if (key.startsWith('family:')) return { key, members: [], unions: homed.get(key) ?? [], depth };
    // Partners alternate right and left of the person, so every couple sits side by side.
    const partners = ownUnions(key).map((u) => partnerIn(u, key)).filter((q): q is UUID => !!q && besideOf.get(q) === key);
    const right = partners.filter((_, i) => i % 2 === 0), left = partners.filter((_, i) => i % 2 === 1).reverse();
    const members = [...left, key, ...right];
    const at = (id: UUID) => { const i = members.indexOf(id); return i < 0 ? members.indexOf(key) : i; };
    // Families under the couple they come from, left to right.
    const fams = (homed.get(key) ?? []).map((u) => ({ u, x: spousesIn(u).reduce((n, s) => n + at(s), 0) / Math.max(1, spousesIn(u).length) }));
    return { key, members, unions: fams.sort((a, b) => a.x - b.x).map((f) => f.u), depth };
  };

  // Connected groups (partners, parents, children), the largest first; within a group, its top people first.
  const groupOf = new Map<UUID, number>();
  const groups: UUID[][] = [];
  for (const p of people) {
    if (groupOf.has(p.id)) continue;
    const group = [p.id];
    groupOf.set(p.id, groups.length);
    for (let i = 0; i < group.length; i++) {
      const id = group[i];
      const near = [
        ...ownUnions(id).flatMap((u) => [...u.spouseIds, ...u.childLinks.map((c) => c.childId)]),
        ...(parentUnion.has(id) ? [...parentUnion.get(id)!.spouseIds, ...parentUnion.get(id)!.childLinks.map((c) => c.childId)] : []),
      ];
      for (const n of near) if (inTree(n) && !groupOf.has(n)) { groupOf.set(n, groups.length); group.push(n); }
    }
    groups.push(group);
  }
  const order = new Map(people.map((p, i) => [p.id, i]));
  const ordered = groups.map((grp, i) => ({ grp, i })).sort((a, b) => b.grp.length - a.grp.length || a.i - b.i).map((x) => x.grp);

  // Tidy-tree packing (d3's Reingold-Tilford) per connected group: each family group is a node, its children's
  // groups are its children, and invisible steps put every top family on its own generation row. Neighbouring
  // families slide together where their generations leave room, and nobody overlaps.
  const placed = new Set<UUID>();
  const pos = new Map<UUID, { u: number; v: number }>();
  const slot = along + gap;
  let offset = 0;
  for (const group of ordered) {
    const tops = new Map<string, number>(); // band key → generation of its first row
    for (const id of group) {
      if (heads.has(id) && !parentUnion.has(id)) tops.set(id, g(id));
      const pu = parentUnion.get(id);
      if (pu && !spousesIn(pu).length) tops.set(homeOf(pu), g(id) - 1);
    }
    const sortedTops = [...tops].sort((a, b) => a[1] - b[1] || (order.get(a[0]) ?? Infinity) - (order.get(b[0]) ?? Infinity));
    const seen = new Set<string>();
    const build = (key: string, row: number): Node => {
      seen.add(key);
      const unit = unitOf(key, row);
      const children = unit.unions.flatMap((u) => u.childLinks.map((c) => c.childId))
        .filter((c) => inTree(c) && heads.has(c) && !seen.has(c) && parentUnion.get(c) && homeOf(parentUnion.get(c)!) === key)
        .map((c) => build(c, row + 1));
      return { unit, children };
    };
    // Steps from the group's first generation down to each top family, so rows follow generations.
    const first = Math.min(...sortedTops.map(([, row]) => row), 1);
    const rootChildren = sortedTops.filter(([key]) => !seen.has(key)).map(([key, row]) => {
      let n = build(key, row);
      for (let r = row; r > first; r--) n = { unit: null, children: [n] };
      return n;
    });
    if (!rootChildren.length) continue;
    const span = (n: Node) => (n.unit ? Math.max(1, n.unit.members.length) : 0.02);
    const root = hierarchy<Node>({ unit: null, children: rootChildren }, (n) => n.children);
    const packed = tree<Node>().nodeSize([slot, step])
      .separation((a, b) => (span(a.data) + span(b.data)) / 2 + (a.parent === b.parent ? bandGap / slot / 2 : bandGap / slot))(root);
    const laid = packed.descendants().filter((n) => n.data.unit && n.data.unit.members.length);
    const minX = Math.min(...laid.map((n) => n.x - (span(n.data) * slot - gap) / 2));
    let maxX = -Infinity;
    for (const n of laid) {
      const members = n.data.unit!.members;
      const left = n.x - (members.length * slot - gap) / 2 - minX + offset;
      members.forEach((m, i) => {
        if (placed.has(m)) return;
        placed.add(m);
        pos.set(m, { u: left + i * slot, v: (n.depth - 1 + first - 1) * step });
      });
      maxX = Math.max(maxX, left + members.length * slot - gap);
    }
    offset = maxX;
    // Anyone a cycle in the data left out still gets a card, after the group.
    for (const id of group) if (!placed.has(id)) {
      placed.add(id);
      offset += bandGap;
      pos.set(id, { u: offset, v: (g(id) - 1) * step });
      offset += along;
    }
    offset += 2 * along;
  }

  const toXY = (u: number, v: number) => (vertical ? { x: u, y: v } : { x: v, y: u });
  const nodes: LayoutNode[] = people.filter((p) => pos.has(p.id)).map((p) => {
    const at = pos.get(p.id)!;
    return { id: p.id, person: p, ...toXY(at.u, at.v), depth: Math.round(at.v / step), isFocus: p.id === focusId };
  });

  // Edges, drawn in the row frame (u along the row, v down the generations) and turned with the cards.
  const edges: LayoutEdge[] = [];
  const edge = (id: string, sourceId: UUID, targetId: UUID, u1: number, v1: number, u2: number, v2: number, extra: Partial<LayoutEdge> = {}) => {
    const a = toXY(u1, v1), b = toXY(u2, v2);
    // `vertical` tells edgePath the generations run downward; left to right, every line is drawn sideways.
    const { vertical: _down, ...rest } = extra;
    edges.push({ id, sourceId, targetId, x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...rest, ...(vertical && (extra.elbow || _down) ? { vertical: true } : {}) });
  };
  for (const u of unions.values()) {
    const spouses = spousesIn(u).filter((s) => pos.has(s));
    const children = u.childLinks.map((c) => c.childId).filter((c) => pos.has(c));
    let from: { u: number; v: number } | null = null;
    if (spouses.length === 2) {
      const [aId, bId] = pos.get(spouses[0])!.u <= pos.get(spouses[1])!.u ? spouses : [spouses[1], spouses[0]];
      const a = pos.get(aId)!, b = pos.get(bId)!;
      const adjacent = a.v === b.v && Math.abs(b.u - a.u - (along + gap)) < 0.5;
      if (a.v === b.v && !adjacent) {
        // Apart (both have parents in the tree): a bow through the gap on the parents' side, not a line behind other cards.
        edge(`${u.id}-spouses`, aId, bId, a.u + along / 2, a.v, b.u + along / 2, b.v, { spouse: true, arc: true, vertical: true });
      } else if (adjacent) {
        edge(`${u.id}-spouses`, aId, bId, a.u + along, a.v + across / 2, b.u, b.v + across / 2, { spouse: true, sideBySide: true });
        // Children hang from the ⚭ marker: a short drop to the cards' edge, then the elbows bend in the gap below.
        const mid = (a.u + along + b.u) / 2;
        if (children.length) edge(`${u.id}-drop`, aId, bId, mid, a.v + across / 2, mid, a.v + across, { vertical: true });
        from = { u: mid, v: a.v + across };
      } else {
        const [hi, lo] = a.v < b.v ? [a, b] : [b, a];
        edge(`${u.id}-spouses`, aId, bId, hi.u + along / 2, hi.v + across, lo.u + along / 2, lo.v, { spouse: true, vertical: true });
      }
    }
    if (!from && spouses.length) {
      // Not side by side: the line comes from the parent whose band the children are in.
      const p = pos.get(spouses.find((s) => headOf(s) === homeOf(u)) ?? spouses[0])!;
      from = { u: p.u + along / 2, v: p.v + across };
    }
    if (!from) continue;
    for (const c of children) {
      const child = pos.get(c)!;
      edge(`${u.id}-${c}`, spouses[0], c, from.u, from.v, child.u + along / 2, child.v, { elbow: true });
    }
  }

  // Everything at x, y >= 0.
  const minX = Math.min(...nodes.map((n) => n.x), ...edges.map((e) => Math.min(e.x1, e.x2)));
  const minY = Math.min(...nodes.map((n) => n.y), ...edges.map((e) => Math.min(e.y1, e.y2)));
  for (const n of nodes) { n.x -= minX; n.y -= minY; }
  for (const e of edges) { e.x1 -= minX; e.x2 -= minX; e.y1 -= minY; e.y2 -= minY; }
  return { nodes, edges };
}
