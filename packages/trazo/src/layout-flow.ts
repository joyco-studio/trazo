/**
 * Deterministic Sugiyama-style layout for a generic directed flow graph.
 *
 * Pure TypeScript: no DOM, no canvas, no `window`. Equal `FlowGraph` (same
 * nodes/edges, same order) always produces a deeply-equal `PositionedGraph`.
 * Every ordering and tie-break decision is a fixed function of the caller's
 * input array index, so there is no dependence on hash-map iteration order,
 * time, or randomness.
 *
 * ── Pipeline ───────────────────────────────────────────────────────────────
 * 0. Normalize + index: drop edges to unknown nodes; build by-id, index-of, and
 *    input-order-preserving in/out adjacency.
 * 1. Rank assignment: longest-path via a Kahn topological sweep seeded by
 *    sources in input-index order. Cycles are broken by lowest input index when
 *    no zero-indegree node remains.
 * 2. Virtual/dummy nodes: edges spanning more than one rank get a chain of
 *    dummy nodes (one per intermediate rank) so cross-layer edges route cleanly.
 * 3. Ordering within layers: a FIXED number of barycenter sweeps (down then up),
 *    stable-sorted; equal barycenter keeps prior order; no-neighbor nodes keep
 *    their index.
 * 4. Coordinate assignment: real nodes are sized via geometry; the cross axis is
 *    packed by order with `nodeGap` + half-widths; the main axis is
 *    `padding + rank * (per-rank max thickness + layerGap)`. Direction projects
 *    rank → y (TD) or rank → x (LR).
 * 5. Edge routing: each original edge's polyline is exit-anchor → dummy centers →
 *    entry-anchor; the SVG path is built via geometry. Labeled edges get a
 *    label point at the polyline midpoint plus a measured label width.
 */

import type {
  FlowDirection,
  FlowEdge,
  FlowGraph,
  FlowGroup,
  FlowLayoutOptions,
  FlowNode,
  NodeId,
  NodeShape,
  Point,
  PositionedEdge,
  PositionedGraph,
  PositionedGroup,
  PositionedNode,
  SemanticRole,
} from "./types.js";
import {
  edgeLabelPoint,
  faceAnchor,
  groupBounds,
  GROUP_PAD,
  GROUP_TITLE_H,
  measureLabel,
  measureMultiline,
  pathThrough,
  roleColorKey,
  sizeShape,
  type AnchorFace,
} from "./geometry.js";

const DEFAULTS = {
  direction: "TD" as FlowDirection,
  layerGap: 56,
  nodeGap: 28,
  padding: 24,
  minNodeWidth: 64,
  nodeHeight: 36,
  labelPadX: 16,
} as const;

/** Fixed number of barycenter ordering sweeps (down + up counts as 2). */
const ORDERING_SWEEPS = 4;

/**
 * A point `stub` px outward from `anchor` along the perpendicular of its face,
 * so an edge leaves/enters the node at 90° before turning. The outward direction
 * is fixed by the face + layout direction (e.g. TD "forward" pushes down, TD
 * "backward" pushes up, "cross-end" pushes right, "cross-start" pushes left).
 */
function stubPoint(
  anchor: Point,
  face: AnchorFace,
  direction: FlowDirection,
  stub: number,
): Point {
  const along =
    face === "forward"
      ? +1
      : face === "backward"
        ? -1
        : face === "cross-end"
          ? +1
          : -1;
  const onMainAxis = face === "forward" || face === "backward";
  // TD: main axis is y, cross axis is x. LR: swapped.
  const movesY = direction === "TD" ? onMainAxis : !onMainAxis;
  return movesY
    ? { x: anchor.x, y: anchor.y + along * stub }
    : { x: anchor.x + along * stub, y: anchor.y };
}

/** Internal per-node working record (real or dummy). */
interface Vertex {
  id: NodeId;
  /** Input index for deterministic tie-breaks; dummies use their seed index. */
  index: number;
  rank: number;
  /** Position within the layer after ordering (filled during ordering). */
  order: number;
  isDummy: boolean;
  shape: NodeShape;
  role: SemanticRole;
  label: string | undefined;
  w: number;
  h: number;
  /**
   * Cluster id this vertex belongs to (real node's `group`, or a dummy whose
   * edge is fully inside one group). Ungrouped → undefined. Drives contiguous
   * ordering and the group's bounding box.
   */
  group: string | undefined;
  /** Resolved center after coordinate assignment. */
  center: Point;
}

export function layoutFlow(
  graph: FlowGraph,
  options?: FlowLayoutOptions,
): PositionedGraph {
  const direction = options?.direction ?? graph.direction ?? DEFAULTS.direction;
  const layerGap = options?.layerGap ?? DEFAULTS.layerGap;
  const nodeGap = options?.nodeGap ?? DEFAULTS.nodeGap;
  const padding = options?.padding ?? DEFAULTS.padding;
  const edgeStyle = options?.edgeStyle ?? "elbow45";
  // Short perpendicular stub off each node face before any turn (px).
  const stub = 12;
  const sizeOpts = {
    minNodeWidth: options?.minNodeWidth ?? DEFAULTS.minNodeWidth,
    nodeHeight: options?.nodeHeight ?? DEFAULTS.nodeHeight,
    labelPadX: options?.labelPadX ?? DEFAULTS.labelPadX,
  };

  // ── 0. Normalize + index ──────────────────────────────────────────────
  const byId = new Map<NodeId, FlowNode>();
  const indexOf = new Map<NodeId, number>();
  graph.nodes.forEach((n, i) => {
    byId.set(n.id, n);
    if (!indexOf.has(n.id)) indexOf.set(n.id, i);
  });

  // Keep only edges whose endpoints both exist; preserve input edge order.
  const edges = graph.edges.filter(
    (e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to,
  );

  // Adjacency preserving input order.
  const outAdj = new Map<NodeId, NodeId[]>();
  const inAdj = new Map<NodeId, NodeId[]>();
  for (const n of graph.nodes) {
    outAdj.set(n.id, []);
    inAdj.set(n.id, []);
  }
  for (const e of edges) {
    (outAdj.get(e.from) as NodeId[]).push(e.to);
    (inAdj.get(e.to) as NodeId[]).push(e.from);
  }

  // ── 1. Rank assignment (longest-path via Kahn, cycle-safe) ────────────
  const rank = assignRanks(graph.nodes, edges, indexOf, inAdj, outAdj);

  // ── Build real vertices ───────────────────────────────────────────────
  const vById = new Map<NodeId, Vertex>();
  for (const n of graph.nodes) {
    const shape: NodeShape = n.shape ?? "box";
    const { w, h } = sizeShape(shape, n.label, sizeOpts);
    vById.set(n.id, {
      id: n.id,
      index: indexOf.get(n.id) as number,
      rank: rank.get(n.id) as number,
      order: 0,
      isDummy: false,
      shape,
      role: n.role ?? "neutral",
      label: n.label,
      w,
      h,
      group: n.group,
      center: { x: 0, y: 0 },
    });
  }

  // ── 2. Virtual/dummy nodes for edges spanning >1 rank ─────────────────
  // For each original edge, record the ordered chain of dummy ids between its
  // endpoints (empty when the edge spans exactly one rank).
  const dummyChain = new Map<FlowEdge, NodeId[]>();
  let dummySeed = graph.nodes.length;
  edges.forEach((e, ei) => {
    const r0 = rank.get(e.from) as number;
    const r1 = rank.get(e.to) as number;
    const lo = Math.min(r0, r1);
    const hi = Math.max(r0, r1);
    // A dummy belongs to a group only when BOTH endpoints are in that same
    // group — so an intra-group long edge stays inside the box, but a
    // cross-group edge routes through the ungrouped gutter and never stretches
    // a foreign box.
    const fromGroup = (byId.get(e.from) as FlowNode).group;
    const toGroup = (byId.get(e.to) as FlowNode).group;
    const dummyGroup =
      fromGroup !== undefined && fromGroup === toGroup ? fromGroup : undefined;
    const chain: NodeId[] = [];
    for (let r = lo + 1; r < hi; r++) {
      const id = `__dummy_${ei}_${r}`;
      const v: Vertex = {
        id,
        index: dummySeed++,
        rank: r,
        order: 0,
        isDummy: true,
        shape: "dot",
        role: "neutral",
        label: undefined,
        w: 0,
        h: 0,
        group: dummyGroup,
        center: { x: 0, y: 0 },
      };
      vById.set(id, v);
      chain.push(id);
    }
    // Chain is ordered from the lower rank to the higher rank.
    dummyChain.set(e, chain);
  });

  // ── Per-group deterministic sort key (min member input index) ─────────
  // A group sorts as one unit against ungrouped vertices by the smallest input
  // index among its members — a fixed function of input order.
  const groupOrderKey = new Map<string, number>();
  for (const v of vById.values()) {
    if (v.group === undefined) continue;
    const prev = groupOrderKey.get(v.group);
    if (prev === undefined || v.index < prev) groupOrderKey.set(v.group, v.index);
  }

  // ── Group vertices into layers by rank ────────────────────────────────
  let maxRank = 0;
  for (const v of vById.values()) if (v.rank > maxRank) maxRank = v.rank;
  const layers: Vertex[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const v of vById.values()) (layers[v.rank] as Vertex[]).push(v);
  // Initial order = input index order (dummies sort after by their seed index).
  for (const layer of layers) {
    layer.sort((a, b) => a.index - b.index);
    layer.forEach((v, i) => (v.order = i));
  }

  // ── Layer-adjacency over the dummy-expanded graph (for barycenter) ────
  // For every consecutive segment of each edge's expanded path, link the two
  // endpoints so barycenter can read neighbor orders. Preserve build order.
  const downNeighbors = new Map<NodeId, NodeId[]>();
  const upNeighbors = new Map<NodeId, NodeId[]>();
  for (const v of vById.values()) {
    downNeighbors.set(v.id, []);
    upNeighbors.set(v.id, []);
  }
  for (const e of edges) {
    const chain = dummyChain.get(e) as NodeId[];
    const path = expandedPath(e, chain, rank);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1] as NodeId;
      const b = path[i] as NodeId;
      // a is on the lower rank, b on the higher rank (path built low→high).
      (downNeighbors.get(a) as NodeId[]).push(b);
      (upNeighbors.get(b) as NodeId[]).push(a);
    }
  }

  // ── 3. Ordering within layers: bounded barycenter sweeps ──────────────
  for (let sweep = 0; sweep < ORDERING_SWEEPS; sweep++) {
    const goingDown = sweep % 2 === 0;
    if (goingDown) {
      for (let r = 1; r < layers.length; r++) {
        reorderLayer(layers[r] as Vertex[], upNeighbors, vById, groupOrderKey);
      }
    } else {
      for (let r = layers.length - 2; r >= 0; r--) {
        reorderLayer(layers[r] as Vertex[], downNeighbors, vById, groupOrderKey);
      }
    }
  }

  // ── 4. Coordinate assignment ──────────────────────────────────────────
  // When the graph has clusters, reserve room up front so a subgraph container
  // (its GROUP_PAD on every side + the title strip ALWAYS along the TOP) never
  // pushes geometry past the origin. Seeding the leads here avoids a post-hoc
  // global shift that would invalidate already-baked edge path strings. The
  // title strip is always on top (y), independent of flow direction, so the
  // renderer can place the title uniformly — hence the title lead lands on
  // whichever lead (main/cross) maps to the Y axis for this direction.
  const hasGroups = (graph.groups?.length ?? 0) > 0;
  const groupPad = hasGroups ? GROUP_PAD : 0;
  const titleLead = hasGroups ? GROUP_TITLE_H : 0;
  // TD: main axis = y → title strip (top) rides the main lead.
  // LR: main axis = x, cross axis = y → title strip rides the CROSS lead.
  const mainLead = groupPad + (direction === "TD" ? titleLead : 0);
  const crossLead = groupPad + (direction === "TD" ? 0 : titleLead);

  // Per-rank main-axis thickness = max node extent along the main axis.
  const rankThickness: number[] = layers.map((layer) => {
    let max = 0;
    for (const v of layer) {
      const t = direction === "TD" ? v.h : v.w;
      if (t > max) max = t;
    }
    return max;
  });

  // Main-axis origin per rank: padding + Σ(prev thickness + layerGap) + half.
  const rankMainStart: number[] = [];
  {
    let acc = padding + mainLead;
    for (let r = 0; r < layers.length; r++) {
      rankMainStart[r] = acc;
      acc += (rankThickness[r] as number) + layerGap;
    }
  }

  // Extra cross-axis gap inserted at a group boundary (between members of two
  // different groups, or a group and an ungrouped node) so neither container box
  // — each padded by GROUP_PAD — overlaps the other. Two abutting boxes need
  // 2*GROUP_PAD between their member edges; nodeGap already covers part of it.
  const groupBoundaryGap = hasGroups ? Math.max(0, GROUP_PAD * 2 - nodeGap) : 0;

  let crossMax = 0;
  for (const layer of layers) {
    // Cross-axis pack: running cursor by order, gap + half-widths.
    let cursor = padding + crossLead;
    let prevGroup: string | undefined;
    let prevSeen = false;
    for (let i = 0; i < layer.length; i++) {
      const v = layer[i] as Vertex;
      // Open a little extra room when stepping across a group boundary.
      if (prevSeen && v.group !== prevGroup) cursor += groupBoundaryGap;
      const crossExtent = direction === "TD" ? v.w : v.h;
      const half = crossExtent / 2;
      cursor += half;
      const mainCenter =
        (rankMainStart[v.rank] as number) +
        (direction === "TD" ? v.h : v.w) / 2;
      if (direction === "TD") {
        v.center = { x: cursor, y: mainCenter };
      } else {
        v.center = { x: mainCenter, y: cursor };
      }
      cursor += half + nodeGap;
      prevGroup = v.group;
      prevSeen = true;
    }
    const layerCrossEnd = cursor - nodeGap + padding;
    if (layerCrossEnd > crossMax) crossMax = layerCrossEnd;
  }

  // ── Straighten single-node chains on the cross axis ───────────────────
  // Packing centers each node by its own half-width, so a chain of differently
  // sized nodes (Great! → Deploy → End) drifts a few px per step and every edge
  // picks up a tiny 45° jog. For a node that is ALONE in its layer there is no
  // sibling to collide with, so it can be snapped onto its upstream neighbor's
  // cross coordinate — making a straight, single-column chain. Top-down sweep so
  // the alignment propagates down the chain (C → E → F). Deterministic: uses the
  // input-order up-neighbor list and the median for forks.
  const crossOf = (v: Vertex): number => (direction === "TD" ? v.center.x : v.center.y);
  const setCross = (v: Vertex, c: number): void => {
    if (direction === "TD") v.center.x = c;
    else v.center.y = c;
  };
  for (let r = 1; r < layers.length; r++) {
    const layer = layers[r] as Vertex[];
    if (layer.length !== 1) continue; // only safe when there's no sibling
    const v = layer[0] as Vertex;
    const ups = (upNeighbors.get(v.id) as NodeId[])
      .map((id) => crossOf(vById.get(id) as Vertex))
      .sort((a, b) => a - b);
    if (ups.length === 0) continue;
    const mid = ups.length % 2 === 1
      ? (ups[(ups.length - 1) / 2] as number)
      : ((ups[ups.length / 2 - 1] as number) + (ups[ups.length / 2] as number)) / 2;
    setCross(v, mid);
  }

  // Aligning lone nodes to a narrower upstream neighbor can push a wider node's
  // leading edge past the padding (negative space). Shift ALL geometry on the
  // cross axis so the leftmost/topmost leading edge sits back at `padding`, then
  // recompute the cross extent. Deterministic; preserves relative positions.
  {
    let minLead = Infinity;
    let maxTrail = 0;
    for (const v of vById.values()) {
      const half = (direction === "TD" ? v.w : v.h) / 2;
      const lead = crossOf(v) - half;
      const trail = crossOf(v) + half;
      if (lead < minLead) minLead = lead;
      if (trail > maxTrail) maxTrail = trail;
    }
    const shift = padding + crossLead - minLead;
    if (shift > 0.0001 || shift < -0.0001) {
      for (const v of vById.values()) setCross(v, crossOf(v) + shift);
      maxTrail += shift;
    }
    crossMax = Math.max(crossMax, maxTrail + padding + crossLead);
  }

  // Total bounds. Main axis spans through the last rank's far edge + padding.
  const lastRank = layers.length - 1;
  const mainEnd =
    (rankMainStart[lastRank] as number) +
    (rankThickness[lastRank] as number) +
    padding;

  let width = direction === "TD" ? crossMax : mainEnd;
  let height = direction === "TD" ? mainEnd : crossMax;

  // ── 4.5 Subgraph container boxes ──────────────────────────────────────
  // Bound each declared group by its members' final shape boxes (+ padding), and
  // reserve a title strip on the backward face (TD: top, LR: left). Runs after
  // node centers are final so the box is tight; grows the viewBox to contain it.
  let positionedGroups: PositionedGroup[] | undefined;
  if (hasGroups) {
    const membersByGroup = new Map<string, Vertex[]>();
    for (const v of vById.values()) {
      if (v.isDummy || v.group === undefined) continue;
      const list = membersByGroup.get(v.group);
      if (list) list.push(v);
      else membersByGroup.set(v.group, [v]);
    }
    const out: PositionedGroup[] = [];
    // Emit in declared order for determinism.
    for (const g of graph.groups as FlowGroup[]) {
      const members = membersByGroup.get(g.id);
      if (!members || members.length === 0) continue;
      const box = groupBounds(
        members.map((v) => ({ x: v.center.x, y: v.center.y, w: v.w, h: v.h })),
        GROUP_PAD,
      );
      if (box === null) continue;
      // Reserve the title strip along the TOP in both directions, so the
      // renderer places the title uniformly (top-left of the box).
      box.y -= GROUP_TITLE_H;
      box.h += GROUP_TITLE_H;
      const pg: PositionedGroup = {
        id: g.id,
        x: box.x,
        y: box.y,
        w: box.w,
        h: box.h,
        variant: "group",
      };
      if (g.label !== undefined) {
        pg.label = g.label;
        pg.labelWidth = measureMultiline(g.label).width;
      }
      out.push(pg);
      // Grow the viewBox to contain the box (leads keep the near edges ≥ 0).
      if (box.x + box.w + padding > width) width = box.x + box.w + padding;
      if (box.y + box.h + padding > height) height = box.y + box.h + padding;
    }
    if (out.length > 0) positionedGroups = out;
  }

  // ── Emit positioned real nodes (in input order) ───────────────────────
  const nodes: PositionedNode[] = graph.nodes.map((n) => {
    const v = vById.get(n.id) as Vertex;
    const node: PositionedNode = {
      id: n.id,
      x: v.center.x,
      y: v.center.y,
      color: roleColorKey(v.role),
      shape: v.shape,
      role: v.role,
      w: v.w,
      h: v.h,
    };
    if (n.label !== undefined) {
      node.label = n.label;
      // Labels render uppercase (JOYCO style) with tracking; a multi-line label
      // reserves its WIDEST line's width.
      node.labelWidth = measureMultiline(n.label).width;
    }
    return node;
  });

  // ── 5. Edge routing ───────────────────────────────────────────────────
  // Track the extent any edge route reaches so back-edge side detours (which
  // bulge outside the node-derived bounds) aren't clipped by the viewBox.
  let routeMaxX = 0;
  let routeMaxY = 0;
  let routeMinX = 0;
  let routeMinY = 0;
  const positionedEdges: PositionedEdge[] = edges.map((e) => {
    const fromV = vById.get(e.from) as Vertex;
    const toV = vById.get(e.to) as Vertex;
    const chain = dummyChain.get(e) as NodeId[];

    // Pick the boundary face each endpoint attaches to from the rank relation:
    //  - forward edge (from below to): leave `from`'s forward face, enter `to`'s
    //    backward face — the normal top→bottom flow.
    //  - back-edge (from a higher rank to a lower one, e.g. a retry loop): the
    //    edge travels *against* the flow. Routing it straight up the column would
    //    sit on top of the forward edge between the same nodes, so it leaves and
    //    enters via the cross-axis SIDE faces and detours laterally around the
    //    column (the `backDetour` waypoints below), mirroring how Mermaid arcs a
    //    loop back to a decision.
    //  - same-rank: route along the cross axis between the two sides.
    const isBackEdge = fromV.rank > toV.rank;
    let exitFace: AnchorFace;
    let entryFace: AnchorFace;
    if (fromV.rank < toV.rank) {
      exitFace = "forward";
      entryFace = "backward";
    } else if (isBackEdge) {
      // Exit and re-enter on the same lateral side (the side the source sits on,
      // so the loop bulges outward away from the column's center).
      const side: AnchorFace =
        fromV.center.x >= toV.center.x ? "cross-end" : "cross-start";
      exitFace = side;
      entryFace = side;
    } else {
      // Same rank: leave one side, enter the other, by cross-axis order.
      const leftToRight = fromV.order <= toV.order;
      exitFace = leftToRight ? "cross-end" : "cross-start";
      entryFace = leftToRight ? "cross-start" : "cross-end";
    }

    const exit = faceAnchor(fromV.center, fromV.w, fromV.h, fromV.shape, direction, exitFace);
    const entry = faceAnchor(toV.center, toV.w, toV.h, toV.shape, direction, entryFace);

    // Dummy chain is built low-rank → high-rank; orient it from→to.
    const fromIsLower = fromV.rank <= toV.rank;
    const middle = chain.map((id) => (vById.get(id) as Vertex).center);
    const orderedMiddle = fromIsLower ? middle : [...middle].reverse();

    // Perpendicular stubs off each chosen face so the edge always leaves/enters
    // at 90° before any 45°/orthogonal turn. The stub direction follows the face.
    const exitStub = stubPoint(exit, exitFace, direction, stub);
    const entryStub = stubPoint(entry, entryFace, direction, stub);

    // A back-edge detours out past the side of its endpoints and runs along a
    // parallel corridor, so it never overlaps the forward edge between the same
    // pair. The corridor offset clears the wider of the two endpoints.
    const backDetour: Point[] = [];
    if (isBackEdge) {
      const goingEnd = exitFace === "cross-end";
      // The exit/entry stubs already sit one `stub` px outside each node's side
      // face (which itself accounts for half-width), so the corridor only needs a
      // small extra gap beyond the outermost stub to read as a clean arc.
      const clearance = nodeGap;
      if (direction === "TD") {
        const corridorX = goingEnd
          ? Math.max(exitStub.x, entryStub.x) + clearance
          : Math.max(padding, Math.min(exitStub.x, entryStub.x) - clearance);
        backDetour.push(
          { x: corridorX, y: exitStub.y },
          { x: corridorX, y: entryStub.y },
        );
      } else {
        const corridorY = goingEnd
          ? Math.max(exitStub.y, entryStub.y) + clearance
          : Math.max(padding, Math.min(exitStub.y, entryStub.y) - clearance);
        backDetour.push(
          { x: exitStub.x, y: corridorY },
          { x: entryStub.x, y: corridorY },
        );
      }
    }

    const points: Point[] = [
      exit,
      exitStub,
      ...backDetour,
      ...orderedMiddle,
      entryStub,
      entry,
    ];
    for (const p of points) {
      if (p.x > routeMaxX) routeMaxX = p.x;
      if (p.y > routeMaxY) routeMaxY = p.y;
      if (p.x < routeMinX) routeMinX = p.x;
      if (p.y < routeMinY) routeMinY = p.y;
    }

    const edge: PositionedEdge = {
      from: e.from,
      to: e.to,
      path: pathThrough(points, edgeStyle),
      kind: "flow",
      // Default edges are neutral accent; opt in to the source role's color.
      color: e.colored ? roleColorKey(fromV.role) : "accent",
      // Flow edges are directed by default; the DSL's `---`/`<-->` opt into a
      // headless or bidirectional arrow.
      arrowHead: e.arrow ?? "end",
    };
    if (e.label !== undefined) {
      edge.label = e.label;
      edge.labelPoint = edgeLabelPoint(points, edgeStyle, direction);
      // Widest line, so a multi-line edge label reserves the right badge width.
      edge.labelWidth = measureMultiline(e.label).width;
    }
    return edge;
  });

  // ── Align sibling edge labels to a shared level ───────────────────────
  // Labels on edges that fan out from the SAME source land on each edge's own
  // diagonal, which can sit at different main-axis depths (one high near the
  // fork, one low near its target box — where it can crowd that box). Snap every
  // labeled sibling to the SHALLOWEST of the group's main-axis levels (TD: min y;
  // LR: min x) so a decision's branch labels read as one aligned row, clear of
  // the downstream nodes. Each label keeps its own cross-axis position. Grouped
  // by source id in input order; deterministic.
  const labeledBySource = new Map<NodeId, PositionedEdge[]>();
  for (const pe of positionedEdges) {
    if (pe.labelPoint === undefined) continue;
    const list = labeledBySource.get(pe.from);
    if (list) list.push(pe);
    else labeledBySource.set(pe.from, [pe]);
  }
  for (const group of labeledBySource.values()) {
    if (group.length < 2) continue;
    let level = Infinity;
    for (const pe of group) {
      const main = direction === "TD" ? (pe.labelPoint as Point).y : (pe.labelPoint as Point).x;
      if (main < level) level = main;
    }
    for (const pe of group) {
      const lp = pe.labelPoint as Point;
      pe.labelPoint = direction === "TD" ? { x: lp.x, y: level } : { x: level, y: lp.y };
    }
  }

  // Grow the viewBox to include any edge route that bulged past the node bounds
  // (back-edge side detours). routeMin* are clamped at 0 by the corridor guard,
  // so geometry never needs a global shift here.
  if (routeMaxX + padding > width) width = routeMaxX + padding;
  if (routeMaxY + padding > height) height = routeMaxY + padding;
  void routeMinX;
  void routeMinY;

  const result: PositionedGraph = {
    nodes,
    edges: positionedEdges,
    width,
    height,
    laneCount: layers.length,
  };
  if (positionedGroups !== undefined) result.groups = positionedGroups;
  return result;
}

/**
 * Longest-path rank assignment via a Kahn topological sweep over the acyclic
 * graph. Cycles are removed *before* ranking: a deterministic DFS (nodes and
 * neighbors visited in input-index order) classifies every edge that points to
 * an ancestor still on the DFS stack as a "back-edge", and those are dropped
 * for ranking. Ranking the remaining DAG keeps loop targets near their
 * predecessors instead of being pushed below them by the back-edge — so a
 * `B --> D --> B` retry loop still ranks `B` directly under its real parent.
 *
 * On the resulting DAG: seed sources (indegree 0) in input-index order and
 * relax each node's successors so a node's rank is the longest path from any
 * source. The cycle-breaker (force the earliest unplaced node) remains as a
 * safety net for any residual cycle.
 */
function assignRanks(
  inputNodes: FlowNode[],
  edges: FlowEdge[],
  indexOf: Map<NodeId, number>,
  inAdj: Map<NodeId, NodeId[]>,
  outAdj: Map<NodeId, NodeId[]>,
): Map<NodeId, number> {
  // ── Identify back-edges via a deterministic DFS, then rank on the DAG ──
  const backEdges = findBackEdges(inputNodes, indexOf, outAdj);
  // Acyclic adjacency + indegree: every edge except the back-edges. A back-edge
  // is keyed "from to"; all parallel duplicates of that pair are dropped.
  const dagOut = new Map<NodeId, NodeId[]>();
  const dagIndeg = new Map<NodeId, number>();
  for (const n of inputNodes) {
    dagOut.set(n.id, []);
    dagIndeg.set(n.id, 0);
  }
  for (const e of edges) {
    if (backEdges.has(edgeKey(e.from, e.to))) continue;
    (dagOut.get(e.from) as NodeId[]).push(e.to);
    dagIndeg.set(e.to, (dagIndeg.get(e.to) as number) + 1);
  }

  const rank = new Map<NodeId, number>();
  const indeg = new Map<NodeId, number>();
  for (const n of inputNodes) {
    indeg.set(n.id, dagIndeg.get(n.id) as number);
    rank.set(n.id, 0);
  }

  const placed = new Set<NodeId>();
  const ready: NodeId[] = [];
  const byIndex = (a: NodeId, b: NodeId) =>
    (indexOf.get(a) as number) - (indexOf.get(b) as number);

  const pushReady = (id: NodeId) => {
    if (!placed.has(id) && !ready.includes(id)) ready.push(id);
  };

  for (const n of inputNodes) if ((indeg.get(n.id) as number) === 0) pushReady(n.id);
  ready.sort(byIndex);

  while (placed.size < inputNodes.length) {
    if (ready.length === 0) {
      // Cycle: force the earliest unplaced node by input index.
      let next: NodeId | undefined;
      for (const n of inputNodes) {
        if (!placed.has(n.id)) {
          next = n.id;
          break;
        }
      }
      if (next === undefined) break;
      ready.push(next);
    }

    ready.sort(byIndex);
    const id = ready.shift() as NodeId;
    if (placed.has(id)) continue;
    placed.add(id);

    const myRank = rank.get(id) as number;
    for (const succ of dagOut.get(id) as NodeId[]) {
      const cand = myRank + 1;
      if (cand > (rank.get(succ) as number)) rank.set(succ, cand);
      const left = (indeg.get(succ) as number) - 1;
      indeg.set(succ, left);
      if (left <= 0) pushReady(succ);
    }
  }

  return rank;
}

/**
 * Deterministic back-edge classification. Runs an iterative DFS over the graph
 * (roots and each node's successors taken in input-index order) and marks every
 * edge whose target is currently on the DFS stack — i.e. an edge that closes a
 * cycle back onto an ancestor. Those edges are the ones to drop so ranking sees
 * a DAG. Order-independent of hash-map iteration: every choice is keyed on the
 * caller's input index.
 */
function findBackEdges(
  inputNodes: FlowNode[],
  indexOf: Map<NodeId, number>,
  outAdj: Map<NodeId, NodeId[]>,
): Set<string> {
  const back = new Set<string>();
  const visited = new Set<NodeId>();
  const onStack = new Set<NodeId>();
  const byIndex = (a: NodeId, b: NodeId) =>
    (indexOf.get(a) as number) - (indexOf.get(b) as number);

  // Iterative DFS so deep graphs can't blow the call stack. Each frame tracks
  // the node and the next successor index to descend into.
  type Frame = { id: NodeId; succ: NodeId[]; i: number };

  for (const root of [...inputNodes].sort((a, b) => byIndex(a.id, b.id))) {
    if (visited.has(root.id)) continue;
    const stack: Frame[] = [];
    const enter = (id: NodeId) => {
      visited.add(id);
      onStack.add(id);
      stack.push({
        id,
        succ: [...(outAdj.get(id) as NodeId[])].sort(byIndex),
        i: 0,
      });
    };
    enter(root.id);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as Frame;
      if (frame.i >= frame.succ.length) {
        onStack.delete(frame.id);
        stack.pop();
        continue;
      }
      const to = frame.succ[frame.i++] as NodeId;
      if (onStack.has(to)) {
        // Edge frame.id → to closes a cycle. Mark the first input edge that
        // matches (parallel duplicate edges share the classification).
        back.add(edgeKey(frame.id, to)); // edge closes a cycle onto an ancestor
        continue;
      }
      if (!visited.has(to)) enter(to);
    }
  }

  return back;
}

/** Stable key for an edge by its endpoints (back-edge classification is by pair). */
function edgeKey(from: NodeId, to: NodeId): string {
  return `${from} ${to}`;
}

/**
 * The ordered id path for an edge after dummy expansion, running from the
 * lower-ranked endpoint to the higher-ranked endpoint.
 */
function expandedPath(
  e: FlowEdge,
  chain: NodeId[],
  rank: Map<NodeId, number>,
): NodeId[] {
  const r0 = rank.get(e.from) as number;
  const r1 = rank.get(e.to) as number;
  const lowEnd = r0 <= r1 ? e.from : e.to;
  const highEnd = r0 <= r1 ? e.to : e.from;
  return [lowEnd, ...chain, highEnd];
}

/** Barycenter (mean neighbor order) of a vertex; falls back to its own order. */
function barycenter(
  v: Vertex,
  neighbors: Map<NodeId, NodeId[]>,
  vById: Map<NodeId, Vertex>,
): number {
  const nbrs = neighbors.get(v.id) as NodeId[];
  if (nbrs.length === 0) return v.order;
  let sum = 0;
  for (const nb of nbrs) sum += (vById.get(nb) as Vertex).order;
  return sum / nbrs.length;
}

/**
 * Reorder a layer by the barycenter (mean order) of each vertex's neighbors in
 * the adjacent layer, KEEPING every cluster's members contiguous (no group
 * interleaves with another group or with ungrouped vertices).
 *
 * Two-level stable sort over "units": each ungrouped vertex is a singleton unit;
 * each group's members in this layer form one unit. Units sort by their mean
 * barycenter (ties broken by a fixed input-derived identity — an ungrouped
 * vertex's `index`, a group's `groupOrderKey`); then members WITHIN a group sort
 * by their own barycenter (ties by `index`). With no groups every unit is a
 * singleton and this collapses to the plain barycenter sort, tie-broken by prior
 * position — byte-identical to the pre-clustering behavior.
 */
function reorderLayer(
  layer: Vertex[],
  neighbors: Map<NodeId, NodeId[]>,
  vById: Map<NodeId, Vertex>,
  groupOrderKey: Map<string, number>,
): void {
  const bary = new Map<NodeId, number>();
  layer.forEach((v) => bary.set(v.id, barycenter(v, neighbors, vById)));
  const priorPos = new Map<NodeId, number>();
  layer.forEach((v, i) => priorPos.set(v.id, i));

  // Partition into units, recording each unit's first-seen position so a
  // group-less layer keeps the old prior-position tie-break exactly.
  type Unit = {
    members: Vertex[];
    /** Sort key: mean barycenter of members. */
    key: number;
    /** Tie-break identity: group → groupOrderKey; singleton → vertex index. */
    tie: number;
    /** First-seen position in the layer (for byte-identical no-group order). */
    firstPos: number;
    group: string | undefined;
  };
  const byGroup = new Map<string, Unit>();
  const units: Unit[] = [];
  layer.forEach((v, i) => {
    if (v.group === undefined) {
      units.push({
        members: [v],
        key: bary.get(v.id) as number,
        tie: v.index,
        firstPos: i,
        group: undefined,
      });
      return;
    }
    const existing = byGroup.get(v.group);
    if (existing) {
      existing.members.push(v);
      return;
    }
    const unit: Unit = {
      members: [v],
      key: 0,
      tie: groupOrderKey.get(v.group) ?? v.index,
      firstPos: i,
      group: v.group,
    };
    byGroup.set(v.group, unit);
    units.push(unit);
  });

  // Finalize each group unit's key (mean of member barycenters) and sort its
  // members internally by barycenter, ties by input index.
  for (const unit of units) {
    if (unit.group === undefined) continue;
    let sum = 0;
    for (const m of unit.members) sum += bary.get(m.id) as number;
    unit.key = sum / unit.members.length;
    unit.members.sort((a, b) => {
      const ka = bary.get(a.id) as number;
      const kb = bary.get(b.id) as number;
      return ka === kb ? a.index - b.index : ka - kb;
    });
  }

  // Stable-sort the units by key; ties by prior position for singletons (to
  // match the old behavior) and by the fixed identity for groups.
  units.sort((a, b) => {
    if (a.key !== b.key) return a.key - b.key;
    // Equal keys: ungrouped-vs-ungrouped fall back to prior position; otherwise
    // the fixed identity tie-break keeps a deterministic, input-derived order.
    if (a.group === undefined && b.group === undefined) return a.firstPos - b.firstPos;
    return a.tie - b.tie;
  });

  let i = 0;
  for (const unit of units) {
    for (const v of unit.members) {
      layer[i] = v;
      v.order = i;
      i++;
    }
  }
}
