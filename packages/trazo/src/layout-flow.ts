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
  BADGE_H,
  badgeHeight,
  badgeWidth,
  edgeLabelPoint,
  faceAnchor,
  groupBounds,
  GROUP_PAD,
  GROUP_TITLE_H,
  LABEL_GAP,
  measureLabel,
  measureMultiline,
  measurePlainMultiline,
  pathThrough,
  renderedPathSegments,
  roleColorKey,
  sizeShape,
  wrapLabel,
  type AnchorFace,
  type RenderedSegment,
} from "./geometry.js";
import { assignCross } from "./bk-align.js";

const DEFAULTS = {
  direction: "TD" as FlowDirection,
  layerGap: 56,
  nodeGap: 28,
  padding: 24,
  minNodeWidth: 64,
  nodeHeight: 36,
  labelPadX: 16,
  calloutGap: 24,
} as const;

/** Fixed number of barycenter ordering sweeps (down + up counts as 2). */
const ORDERING_SWEEPS = 4;

/** Breathing room between an annotation and an unrelated edge or box. */
const NOTE_CLEARANCE = 8;
/** Minimum cross-axis separation for parallel badges that remain side by side. */
const PARALLEL_LABEL_CLEARANCE = 4;

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function boxBounds(x: number, y: number, w: number, h: number): Bounds {
  return { left: x - w / 2, top: y - h / 2, right: x + w / 2, bottom: y + h / 2 };
}

function boxesOverlap(a: Bounds, b: Bounds, gap: number): boolean {
  return a.left < b.right + gap && a.right > b.left - gap &&
    a.top < b.bottom + gap && a.bottom > b.top - gap;
}

/** Liang–Barsky clip: does a straight edge segment enter an inflated box? */
function segmentHitsBox(a: Point, b: Point, box: Bounds, gap: number): boolean {
  const left = box.left - gap;
  const right = box.right + gap;
  const top = box.top - gap;
  const bottom = box.bottom + gap;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let enter = 0;
  let leave = 1;
  const limits: Array<[number, number]> = [
    [-dx, a.x - left], [dx, right - a.x],
    [-dy, a.y - top], [dy, bottom - a.y],
  ];
  for (const [p, q] of limits) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return false;
  }
  return true;
}

function pathHitsBox(path: RenderedSegment[], box: Bounds, gap: number): boolean {
  return path.some(({ a, b, error }) => segmentHitsBox(a, b, box, gap + error));
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1,
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq,
  ));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function closestPointOnPath(point: Point, path: RenderedSegment[]): Point {
  let closest = point;
  let best = Infinity;
  for (const { a, b } of path) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq,
    ));
    const candidate = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (distance < best) {
      best = distance;
      closest = candidate;
    }
  }
  return closest;
}

/** Minimum distance between two drawn segments, accounting for a crossing. */
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (u: Point, v: Point): number => u.x * v.y - u.y * v.x;
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = cross(r, s);
  if (Math.abs(denom) > 1e-9) {
    const delta = { x: c.x - a.x, y: c.y - a.y };
    const t = cross(delta, s) / denom;
    const u = cross(delta, r) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  return Math.min(
    pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b),
  );
}

function pathsTooClose(a: RenderedSegment[], b: RenderedSegment[], gap: number): boolean {
  return a.some((first) => b.some((second) =>
    segmentDistance(first.a, first.b, second.a, second.b) <=
      gap + first.error + second.error,
  ));
}

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
   * Extra cross-axis space (px) reserved past this node's trailing side for
   * self-loop corridors, so a loop never collides with the next rank sibling.
   * `nodeGap` per self-loop on the node; 0 when it has none.
   */
  loopPad: number;
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
  const calloutGap = Math.max(0, options?.calloutGap ?? DEFAULTS.calloutGap);
  const edgeStyle = options?.edgeStyle ?? "elbow45";
  // Short perpendicular stub off each node face before any turn (px).
  const stub = 12;
  // Air gap between an edge endpoint (line end / arrow tip) and the node face
  // it connects to. 0 = flush (the default); the theme's "lane gap" maps here.
  const edgeGap = Math.max(0, options?.edgeGap ?? 0);
  const textCase = options?.textCase ?? "uppercase";
  const sizeOpts = {
    minNodeWidth: options?.minNodeWidth ?? DEFAULTS.minNodeWidth,
    nodeHeight: options?.nodeHeight ?? DEFAULTS.nodeHeight,
    labelPadX: options?.labelPadX ?? DEFAULTS.labelPadX,
    textCase,
  };
  // Word-wrap budget for the label TEXT (box width minus its side padding).
  const maxLabelWidth =
    options?.maxNodeWidth !== undefined
      ? Math.max(8, options.maxNodeWidth - sizeOpts.labelPadX * 2)
      : undefined;
  const wrapNodeLabel = (label: string | undefined): string | undefined =>
    label !== undefined && maxLabelWidth !== undefined
      ? wrapLabel(label, maxLabelWidth, textCase)
      : label;

  // ── 0. Normalize + index ──────────────────────────────────────────────
  const byId = new Map<NodeId, FlowNode>();
  const indexOf = new Map<NodeId, number>();
  graph.nodes.forEach((n, i) => {
    byId.set(n.id, n);
    if (!indexOf.has(n.id)) indexOf.set(n.id, i);
  });

  // Keep only edges whose endpoints both exist; preserve input edge order.
  // Self-loops (from === to) skip the rank/order/dummy pipeline entirely — they
  // are routed as wrap-around corridors after the regular edges (see below).
  const validEdges = graph.edges.filter(
    (e) => byId.has(e.from) && byId.has(e.to),
  );
  const edges = validEdges.filter((e) => e.from !== e.to);
  const selfLoops = validEdges.filter((e) => e.from === e.to);
  const loopCount = new Map<NodeId, number>();
  for (const e of selfLoops) {
    loopCount.set(e.from, (loopCount.get(e.from) ?? 0) + 1);
  }

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

  // ── 1b. Cluster cohesion: pull an edge-less group member into its band ──
  // A grouped node with NO edges is a rank-0 source by longest-path, which can
  // strand it far from its edge-connected cluster-mates — e.g. a bare node in a
  // right-side subgraph dragged back to the left source rank, stretching the
  // cluster box across a foreign subgraph (the two boxes then overlap). Re-rank
  // each such isolated member to its cluster's ANCHOR rank (the lowest rank held
  // by an edge-connected member of the same group), so the cluster stays a
  // compact, contiguous band instead of spanning the whole chart. Members that
  // carry edges are untouched (their rank is load-bearing). Deterministic: a
  // fixed function of ranks + input membership.
  if ((graph.groups?.length ?? 0) > 0) {
    const isolated = (id: NodeId): boolean =>
      (outAdj.get(id) as NodeId[]).length === 0 && (inAdj.get(id) as NodeId[]).length === 0;
    const anchorRank = new Map<string, number>();
    for (const n of graph.nodes) {
      if (n.group === undefined || isolated(n.id)) continue;
      const r = rank.get(n.id) as number;
      const prev = anchorRank.get(n.group);
      if (prev === undefined || r < prev) anchorRank.set(n.group, r);
    }
    for (const n of graph.nodes) {
      if (n.group === undefined || !isolated(n.id)) continue;
      const anchor = anchorRank.get(n.group);
      if (anchor !== undefined) rank.set(n.id, anchor);
    }

    // ── 1c. Lift external predecessors ABOVE a self-contained cluster ─────
    // When an UNGROUPED node feeds INTO a subgraph and shares the subgraph's top
    // rank, longest-path drops it beside the top members — inside the container
    // box, reading as part of the cluster (Mermaid instead stacks such feeders
    // ABOVE the box, pointing down in). Push the whole cluster DOWN so its top
    // rank clears every external predecessor. Guarded to a "downward-closed"
    // cluster — one whose members only send edges to OTHER members — so the shift
    // can't strand an external successor at a now-higher rank (no rank cascade).
    // Deterministic: groups processed in declared order; ranks are integers.
    const memberOf = new Map<string, NodeId[]>();
    for (const n of graph.nodes) {
      if (n.group === undefined) continue;
      const list = memberOf.get(n.group);
      if (list) list.push(n.id);
      else memberOf.set(n.group, [n.id]);
    }
    for (const g of graph.groups as FlowGroup[]) {
      const members = memberOf.get(g.id);
      if (!members || members.length === 0) continue;
      const inGroup = new Set(members);
      // Skip unless every out-edge stays inside the cluster (no downward exit).
      let downwardClosed = true;
      for (const m of members) {
        for (const succ of outAdj.get(m) as NodeId[]) {
          if (!inGroup.has(succ)) {
            downwardClosed = false;
            break;
          }
        }
        if (!downwardClosed) break;
      }
      if (!downwardClosed) continue;
      let topRank = Infinity;
      for (const m of members) topRank = Math.min(topRank, rank.get(m) as number);
      // Highest rank held by an external node that feeds a member.
      let maxExtPred = -Infinity;
      for (const m of members) {
        for (const pred of inAdj.get(m) as NodeId[]) {
          if (!inGroup.has(pred)) maxExtPred = Math.max(maxExtPred, rank.get(pred) as number);
        }
      }
      const delta = maxExtPred === -Infinity ? 0 : maxExtPred + 1 - topRank;
      if (delta > 0) for (const m of members) rank.set(m, (rank.get(m) as number) + delta);
    }
  }

  // ── Build real vertices ───────────────────────────────────────────────
  const vById = new Map<NodeId, Vertex>();
  for (const n of graph.nodes) {
    const shape: NodeShape = n.shape ?? "box";
    // Wrapping happens ONCE here; the same wrapped text sizes the shape and is
    // emitted on the PositionedNode, so what's measured is what's drawn.
    const label = wrapNodeLabel(n.label);
    const { w, h } = sizeShape(shape, label, sizeOpts);
    vById.set(n.id, {
      id: n.id,
      index: indexOf.get(n.id) as number,
      rank: rank.get(n.id) as number,
      order: 0,
      isDummy: false,
      shape,
      role: n.role ?? "neutral",
      label,
      w,
      h,
      // Self-loop corridors sit past the cross-end face by edgeGap + nodeGap
      // per nested loop — reserve exactly that so rank siblings stay clear.
      loopPad:
        (loopCount.get(n.id) ?? 0) > 0
          ? (loopCount.get(n.id) as number) * nodeGap + edgeGap
          : 0,
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
    // BACK-EDGES get no dummy chain: they route around the column via the
    // lateral corridor (see edge routing below), so mid-rank waypoints would
    // yank the path back INTO the layers it just detoured around — the
    // "floating triangle" artifact. They also shouldn't occupy layer slots.
    if (r0 > r1) {
      dummyChain.set(e, []);
      return;
    }
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
        loopPad: 0,
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

  // The set of groups a rank's REAL nodes belong to (dummies ignored). Used to
  // open extra main-axis room where one group's band ends and another begins.
  const rankGroups: Array<Set<string>> = layers.map((layer) => {
    const s = new Set<string>();
    for (const v of layer) if (!v.isDummy && v.group !== undefined) s.add(v.group);
    return s;
  });
  // True when ranks r-1 and r belong to DIFFERENT groups (a stacked-subgraph
  // boundary), so their container boxes don't crowd each other. The title strip
  // the lower box reserves on top also needs to clear the upper box.
  const crossesGroupBoundary = (r: number): boolean => {
    if (r === 0) return false;
    const prev = rankGroups[r - 1] as Set<string>;
    const cur = rankGroups[r] as Set<string>;
    if (prev.size === 0 && cur.size === 0) return false;
    for (const g of cur) if (prev.has(g)) return false; // shared group → same band
    return prev.size > 0 || cur.size > 0;
  };

  // Label-aware inter-rank gaps. An ADJACENT edge's label renders as a badge
  // centered in the gap between its two ranks. In a horizontal (LR) flow the
  // badge's WIDTH lies on the main axis and routinely exceeds the fixed
  // `layerGap`, so without reserving room the badge is drawn UNDER the
  // neighbouring node boxes. Vertical (TD) flows stay tight: the badge's height
  // sits on the main axis and a single-line badge fits `layerGap` — but a
  // multi-line label grows it, so reserve its real `badgeHeight`. Reserve, per
  // rank boundary, enough main-axis room for the widest adjacent label crossing
  // it (plus `LABEL_GAP` breathing space on each side).
  //
  // Only adjacent forward edges widen a gap. A rank-SPANNING edge's label isn't
  // gap-centered — it rides the polyline midpoint, which for a straightened span
  // lands in the dummy's own cross lane (clear of the nodes it flies over), so
  // no inter-rank widening is needed. KNOWN LIMITATION: a spanning label wider
  // than the rank spacing can still graze an endpoint's box; that case is
  // inherent (no on-line placement clears a badge wider than the node spacing).
  // A "parallel pair": two nodes on ADJACENT ranks with edges in BOTH directions
  // (a↔b), each the SOLE vertex on its rank. That's a 1↔1 sync relationship
  // (e.g. commit / scroll-deltas between two threads) — Mermaid draws it as two
  // parallel lines with both labels centered BETWEEN the boxes. Both edges route
  // straight through the shared inter-rank gap (see edge routing below), offset to
  // opposite sides of centre, instead of arcing the reverse edge out on a lateral
  // corridor (which strands its label at the far edge). The "sole on rank" guard
  // keeps genuine branch/merge loops — a retry edge back to a decision that fans
  // out, so its target rank has siblings — on the lateral arc. It also excludes
  // dummy lanes carrying longer edges through this gap. Deterministic.
  const edgeDirs = new Set<string>();
  for (const e of edges) edgeDirs.add(`${e.from} ${e.to}`);
  const realPerRank: number[] = layers.map(
    (layer) => layer.filter((v) => !v.isDummy).length,
  );
  const isParallelPair = (fromV: Vertex, toV: Vertex, e: FlowEdge): boolean =>
    Math.abs(fromV.rank - toV.rank) === 1 &&
    edgeDirs.has(`${e.to} ${e.from}`) &&
    (realPerRank[fromV.rank] as number) === 1 &&
    (realPerRank[toV.rank] as number) === 1 &&
    // A dummy lane carries a spanning edge through this same gap. The pair's
    // outer badges cannot safely straddle that extra route.
    (layers[fromV.rank] as Vertex[]).length === 1 &&
    (layers[toV.rank] as Vertex[]).length === 1;
  const parallelOffset = (fromV: Vertex, toV: Vertex): number => {
    const minHalf = Math.min(
      direction === "TD" ? fromV.w : fromV.h,
      direction === "TD" ? toV.w : toV.h,
    ) / 2;
    return Math.min(BADGE_H / 2 + 2, Math.max(0, minHalf - 4));
  };

  const labelGapAfter: number[] = new Array(layers.length).fill(0);
  for (const e of edges) {
    if (e.label === undefined) continue;
    const fromV = vById.get(e.from) as Vertex;
    const toV = vById.get(e.to) as Vertex;
    // A label sits in the inter-rank gap when its edge is a forward adjacent edge
    // OR a parallel-pair REVERSE edge (which routes back through the SAME gap). In
    // both cases reserve room at the LOWER rank's boundary so the widest of the
    // pair's two labels fits — otherwise a labeled reverse edge (or the wider of
    // the two) is drawn UNDER the node boxes.
    const forwardAdjacent = toV.rank === fromV.rank + 1;
    const parallelReverse = fromV.rank === toV.rank + 1 && isParallelPair(fromV, toV, e);
    if (!forwardAdjacent && !parallelReverse) continue;
    const gapRank = Math.min(fromV.rank, toV.rank);
    // Edge labels render verbatim (no inline-code chips), so measure them plain —
    // backticks are ordinary glyphs, not consumed delimiters. In TD the badge's
    // HEIGHT lies on the main axis (and grows with a multi-line label), in LR its
    // width does.
    const measured = measurePlainMultiline(e.label, undefined, textCase);
    const labelMainExtent =
      direction === "TD" ? badgeHeight(measured.height) : badgeWidth(measured.width);
    const need = labelMainExtent + LABEL_GAP * 2;
    if (need > (labelGapAfter[gapRank] as number)) labelGapAfter[gapRank] = need;
  }

  // A labeled 1↔1 pair normally fits by offsetting its two lines across the
  // flow. In TD, wide badges can overlap despite that offset (and in LR a tall
  // multiline badge can do the same). Reserve room to stagger only those pairs
  // along their lines, leaving already-clear pairs at their usual gap center.
  const pairLabels = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    if (e.label === undefined) continue;
    const fromV = vById.get(e.from) as Vertex;
    const toV = vById.get(e.to) as Vertex;
    if (!isParallelPair(fromV, toV, e)) continue;
    const key = [indexOf.get(e.from), indexOf.get(e.to)].sort((a, b) => (a as number) - (b as number)).join(":");
    const list = pairLabels.get(key);
    if (list) list.push(e);
    else pairLabels.set(key, [e]);
  }
  const stackedPairs: Array<{
    forward: FlowEdge;
    reverse: FlowEdge;
    gapRank: number;
    forwardMain: number;
    reverseMain: number;
  }> = [];
  for (const pair of pairLabels.values()) {
    if (pair.length !== 2) continue;
    const forward = pair.find((e) =>
      (vById.get(e.from) as Vertex).rank < (vById.get(e.to) as Vertex).rank,
    );
    const reverse = pair.find((e) => e !== forward);
    if (forward === undefined || reverse === undefined ||
        forward.from !== reverse.to || forward.to !== reverse.from) continue;
    const fromV = vById.get(forward.from) as Vertex;
    const toV = vById.get(forward.to) as Vertex;
    const f = measurePlainMultiline(forward.label as string, undefined, textCase);
    const r = measurePlainMultiline(reverse.label as string, undefined, textCase);
    const forwardCross = direction === "TD" ? badgeWidth(f.width) : badgeHeight(f.height);
    const reverseCross = direction === "TD" ? badgeWidth(r.width) : badgeHeight(r.height);
    const separation = 2 * parallelOffset(fromV, toV);
    if (separation >= (forwardCross + reverseCross) / 2 + PARALLEL_LABEL_CLEARANCE) continue;
    const forwardMain = direction === "TD" ? badgeHeight(f.height) : badgeWidth(f.width);
    const reverseMain = direction === "TD" ? badgeHeight(r.height) : badgeWidth(r.width);
    const gapRank = fromV.rank;
    const need = forwardMain + reverseMain + LABEL_GAP * 3;
    if (need > (labelGapAfter[gapRank] as number)) labelGapAfter[gapRank] = need;
    stackedPairs.push({ forward, reverse, gapRank, forwardMain, reverseMain });
  }

  // Main-axis origin per rank: padding + Σ(prev thickness + per-boundary gap) +
  // half. The gap after rank r is the larger of the fixed `layerGap` and the
  // room its crossing labels need, so unlabeled ranks keep tight spacing.
  const rankMainStart: number[] = [];
  {
    let acc = padding + mainLead;
    for (let r = 0; r < layers.length; r++) {
      // At a stacked-subgraph boundary, add room for both boxes' padding + the
      // lower box's title strip.
      if (hasGroups && crossesGroupBoundary(r)) acc += GROUP_PAD * 2 + GROUP_TITLE_H;
      rankMainStart[r] = acc;
      acc += (rankThickness[r] as number) + Math.max(layerGap, labelGapAfter[r] as number);
    }
  }

  // Extra cross-axis gap inserted at a group boundary (between members of two
  // different groups, or a group and an ungrouped node) so neither container box
  // — each padded by GROUP_PAD — overlaps the other. Two abutting boxes need
  // 2*GROUP_PAD between their member edges; nodeGap already covers part of it.
  const groupBoundaryGap = hasGroups ? Math.max(0, GROUP_PAD * 2 - nodeGap) : 0;

  // A note placed between siblings needs cross-axis room before their flow
  // routes are computed. Otherwise a centered note can cover the next branch
  // node, forcing a long sideways leader through another rank's boxes.
  const noteOutset = new Map<NodeId, { lead: number; trail: number }>();
  if (graph.notes) {
    for (const note of graph.notes) {
      const target = vById.get(note.target);
      if (target === undefined || target.isDummy) continue;
      const trailing = direction === "LR" ? note.side === "below" : note.side === "right";
      const leading = direction === "LR" ? note.side === "above" : note.side === "left";
      if (!trailing && !leading) continue;
      const label = wrapNodeLabel(note.label);
      const { w, h } = sizeShape("box", label, sizeOpts);
      const extent = direction === "LR" ? h : w;
      const out = noteOutset.get(note.target) ?? { lead: 0, trail: 0 };
      if (trailing) out.trail += calloutGap + extent;
      else out.lead += calloutGap + extent;
      noteOutset.set(note.target, out);
    }
  }

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
      // Trailing side also reserves the node's self-loop corridor space.
      cursor += half + v.loopPad + nodeGap;
      prevGroup = v.group;
      prevSeen = true;
    }
  }

  // ── Cross-axis coordinate assignment: Brandes–Köpf block alignment ────
  // The initial pack above is left-aligned; readability wants every co-aligned
  // run (a chain, a long-edge dummy chain, a cluster spine) to share ONE cross
  // coordinate so its connecting edge draws straight. Brandes–Köpf achieves this
  // in a single deterministic pass by grouping such nodes into vertical blocks
  // and placing each block once — no iterative averaging, so no residual
  // per-node drift (the failure mode of the old bounded PAVA sweeps). It is the
  // method dagre/Mermaid use; see docs/coordinate-assignment.md.
  const crossOf = (v: Vertex): number => (direction === "TD" ? v.center.x : v.center.y);
  const setCross = (v: Vertex, c: number): void => {
    if (direction === "TD") v.center.x = c;
    else v.center.y = c;
  };
  // Minimum center-to-center separation between two layer neighbors (`a` left of
  // `b`): half-widths + self-loop corridor + gap + any group-boundary breathing
  // room. Size-aware, so wide and narrow siblings never overlap and abutting
  // subgraph boxes stay clear.
  const minSep = (a: Vertex, b: Vertex): number => {
    const halfA = (direction === "TD" ? a.w : a.h) / 2;
    const halfB = (direction === "TD" ? b.w : b.h) / 2;
    const boundary = hasGroups && a.group !== b.group ? groupBoundaryGap : 0;
    const noteRoom = (noteOutset.get(a.id)?.trail ?? 0) +
      (noteOutset.get(b.id)?.lead ?? 0) + NOTE_CLEARANCE;
    return halfA + a.loopPad + Math.max(nodeGap, noteRoom) + boundary + halfB;
  };

  // Proper adjacency for BK: adjacent-rank segments only. A forward edge's
  // expanded path visits consecutive ranks (dummies fill any gap); each segment
  // links an upper (lower-rank) vertex to a lower (higher-rank) one. Back-edges
  // and same-rank edges are skipped — they route laterally and never pin a
  // column. Segment order follows input edge order → deterministic.
  const bkUp = new Map<NodeId, NodeId[]>();
  const bkDown = new Map<NodeId, NodeId[]>();
  for (const v of vById.values()) {
    bkUp.set(v.id, []);
    bkDown.set(v.id, []);
  }
  for (const e of edges) {
    if ((rank.get(e.from) as number) >= (rank.get(e.to) as number)) continue;
    const path = expandedPath(e, dummyChain.get(e) as NodeId[], rank);
    for (let i = 1; i < path.length; i++) {
      const upper = path[i - 1] as NodeId;
      const lower = path[i] as NodeId;
      (bkDown.get(upper) as NodeId[]).push(lower);
      (bkUp.get(lower) as NodeId[]).push(upper);
    }
  }

  {
    const cross = assignCross({
      layers: layers.map((layer) => layer.map((v) => v.id)),
      up: bkUp,
      down: bkDown,
      isDummy: (id) => (vById.get(id) as Vertex).isDummy,
      group: (id) => (vById.get(id) as Vertex).group,
      sep: (leftId, rightId) =>
        minSep(vById.get(leftId) as Vertex, vById.get(rightId) as Vertex),
    });
    for (const v of vById.values()) setCross(v, cross.get(v.id) as number);
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
      const trail = crossOf(v) + half + v.loopPad;
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
      // A subgraph box narrower than its own title clips the label (the title
      // renders left-aligned at `box.x + GROUP_PAD`). Widen the box to the RIGHT
      // so it's at least as wide as the title needs — GROUP_PAD on each side of
      // the measured label — keeping members left-aligned and growing the canvas
      // via the viewBox check below. Mirrors the sequence note box's title fit.
      const labelWidth = g.label !== undefined ? measureMultiline(g.label).width : 0;
      if (labelWidth > 0) {
        const titleNeed = labelWidth + GROUP_PAD * 2;
        if (box.w < titleNeed) box.w = titleNeed;
      }
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
        pg.labelWidth = labelWidth;
      }
      if (g.role !== undefined) pg.role = g.role;
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
    if (v.group !== undefined) node.group = v.group;
    if (v.label !== undefined) {
      // The vertex label is the (possibly auto-wrapped) text the shape was
      // sized against — emit THAT, not the raw input, so the renderer draws
      // exactly what was measured. Uppercase + tracking; a multi-line label
      // reserves its WIDEST line's width.
      node.label = v.label;
      node.labelWidth = measureMultiline(v.label, undefined, textCase).width;
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

  // Waypoints per edge, parallel to `positionedEdges`. Path strings are built
  // AFTER the label-bounds normalization below, which may shift every point.
  const edgePoints: Point[][] = [];
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
    const parallel = isParallelPair(fromV, toV, e);
    let exitFace: AnchorFace;
    let entryFace: AnchorFace;
    if (fromV.rank < toV.rank) {
      exitFace = "forward";
      entryFace = "backward";
    } else if (isBackEdge && parallel) {
      // Parallel pair: send the reverse edge back through the SAME gap as its
      // forward twin (leave the lower-rank-facing side, enter the twin's
      // gap-facing side), offset below centre — not out on a lateral corridor.
      exitFace = "backward";
      entryFace = "forward";
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

    // With an edgeGap the path starts/ends a few px OFF the face, so the line
    // (and the arrow tip, which sits at the path end) never touches the box.
    let exitAnchor = faceAnchor(fromV.center, fromV.w, fromV.h, fromV.shape, direction, exitFace);
    let entryAnchor = faceAnchor(toV.center, toV.w, toV.h, toV.shape, direction, entryFace);
    // Parallel pair: slide BOTH anchors off the face centre along the cross axis
    // — the low→high (forward) twin toward cross-start, the high→low (reverse)
    // toward cross-end — so the two lines run parallel with a clear gap and each
    // label centres on its own line, stacked between the boxes (Mermaid parity).
    // The base offset fits ordinary single-line badges; wider/taller pairs get
    // their labels staggered along the routes after edge placement.
    if (parallel) {
      const halfOff = parallelOffset(fromV, toV);
      const d = (fromV.rank < toV.rank ? -1 : 1) * halfOff;
      exitAnchor =
        direction === "TD"
          ? { x: exitAnchor.x + d, y: exitAnchor.y }
          : { x: exitAnchor.x, y: exitAnchor.y + d };
      entryAnchor =
        direction === "TD"
          ? { x: entryAnchor.x + d, y: entryAnchor.y }
          : { x: entryAnchor.x, y: entryAnchor.y + d };
    }
    const exit = edgeGap > 0 ? stubPoint(exitAnchor, exitFace, direction, edgeGap) : exitAnchor;
    const entry = edgeGap > 0 ? stubPoint(entryAnchor, entryFace, direction, edgeGap) : entryAnchor;

    // Dummy chain is built low-rank → high-rank; orient it from→to. Each dummy
    // contributes TWO waypoints spanning its whole rank (entering just above,
    // leaving just below) at the dummy's RESERVED cross position — so the edge
    // passes rank interiors strictly vertically through its own empty column,
    // and every cross shift happens in the inter-rank gaps. Routing through
    // the dummy CENTER instead put cross-runs exactly on a rank's boundary
    // line, grazing sibling boxes. Fresh Point objects (no vertex aliasing).
    const fromIsLower = fromV.rank <= toV.rank;
    const spanInset = Math.min(stub, layerGap / 2);
    const middle: Point[] = [];
    for (const id of chain) {
      const dv = vById.get(id) as Vertex;
      const spanStart = (rankMainStart[dv.rank] as number) - spanInset;
      const spanEnd =
        (rankMainStart[dv.rank] as number) + (rankThickness[dv.rank] as number) + spanInset;
      if (direction === "TD") {
        middle.push({ x: dv.center.x, y: spanStart }, { x: dv.center.x, y: spanEnd });
      } else {
        middle.push({ x: spanStart, y: dv.center.y }, { x: spanEnd, y: dv.center.y });
      }
    }
    const orderedMiddle = fromIsLower ? middle : [...middle].reverse();

    // Perpendicular stubs off each chosen face so the edge always leaves/enters
    // at 90° before any 45°/orthogonal turn. The stub direction follows the face.
    const exitStub = stubPoint(exit, exitFace, direction, stub);
    const entryStub = stubPoint(entry, entryFace, direction, stub);

    // A back-edge detours out past the side of its endpoints and runs along a
    // parallel corridor, so it never overlaps the forward edge between the same
    // pair. The corridor must clear EVERY node in the ranks it travels past
    // (a wide box on an intermediate rank would otherwise be sliced), so it
    // offsets from the outermost cross extent across the spanned rank range.
    // Notes on that side occupy the same corridor, so include their reserved
    // outset before choosing the detour. A parallel-pair reverse edge skips
    // this — it already runs straight through the gap, offset from its twin.
    const backDetour: Point[] = [];
    if (isBackEdge && !parallel) {
      const goingEnd = exitFace === "cross-end";
      const clearance = nodeGap;
      const rLo = Math.min(fromV.rank, toV.rank);
      const rHi = Math.max(fromV.rank, toV.rank);
      let spanTrail = -Infinity;
      let spanLead = Infinity;
      for (const v of vById.values()) {
        if (v.rank < rLo || v.rank > rHi) continue;
        const half = (direction === "TD" ? v.w : v.h) / 2;
        const cross = direction === "TD" ? v.center.x : v.center.y;
        const notes = noteOutset.get(v.id);
        if (cross + half + v.loopPad + (notes?.trail ?? 0) > spanTrail) {
          spanTrail = cross + half + v.loopPad + (notes?.trail ?? 0);
        }
        if (cross - half - (notes?.lead ?? 0) < spanLead) {
          spanLead = cross - half - (notes?.lead ?? 0);
        }
      }
      if (direction === "TD") {
        const corridorX = goingEnd
          ? Math.max(exitStub.x, entryStub.x, spanTrail + stub) + clearance
          : Math.max(padding, Math.min(exitStub.x, entryStub.x, spanLead - stub) - clearance);
        backDetour.push(
          { x: corridorX, y: exitStub.y },
          { x: corridorX, y: entryStub.y },
        );
      } else {
        const corridorY = goingEnd
          ? Math.max(exitStub.y, entryStub.y, spanTrail + stub) + clearance
          : Math.max(padding, Math.min(exitStub.y, entryStub.y, spanLead - stub) - clearance);
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

    edgePoints.push(points);
    const edge: PositionedEdge = {
      from: e.from,
      to: e.to,
      // Placeholder — the real path is built after label-bounds normalization,
      // once every waypoint is final.
      path: "",
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
      // Widest line for width, line-count for height, so a multi-line edge label
      // reserves the right badge in BOTH axes (the renderer stacks the lines).
      // Plain measure: the renderer draws `edge.label` verbatim (no inline-code
      // parsing), so backticks are literal glyphs here, not mono chips.
      const measured = measurePlainMultiline(e.label, undefined, textCase);
      edge.labelWidth = measured.width;
      edge.labelHeight = measured.height;
    }
    return edge;
  });

  // ── Self-loops (A → A) ────────────────────────────────────────────────
  // A self-loop leaves the node's FORWARD face, runs along a corridor past the
  // node's cross-end side (space the packing reserved via `loopPad`), and
  // re-enters the CROSS-END face — so its arrowhead never stacks on the
  // backward-face arrows of the node's regular in-edges. Multiple loops on one
  // node nest at `nodeGap` intervals, innermost first. Deterministic: input
  // edge order.
  const loopSeen = new Map<NodeId, number>();
  for (const e of selfLoops) {
    const v = vById.get(e.from) as Vertex;
    const nth = loopSeen.get(e.from) ?? 0;
    loopSeen.set(e.from, nth + 1);
    const corridorGap = nodeGap * (nth + 1);
    const exitAnchor = faceAnchor(v.center, v.w, v.h, v.shape, direction, "forward");
    const entryAnchor = faceAnchor(v.center, v.w, v.h, v.shape, direction, "cross-end");
    const exit = edgeGap > 0 ? stubPoint(exitAnchor, "forward", direction, edgeGap) : exitAnchor;
    const entry = edgeGap > 0 ? stubPoint(entryAnchor, "cross-end", direction, edgeGap) : entryAnchor;
    const exitStub = stubPoint(exit, "forward", direction, stub);
    // The entry stub doubles as the corridor turn: `corridorGap` px past the
    // cross-end face, perpendicular to it.
    const entryStub = stubPoint(entry, "cross-end", direction, corridorGap);
    const corner =
      direction === "TD"
        ? { x: entryStub.x, y: exitStub.y }
        : { x: exitStub.x, y: entryStub.y };
    const points: Point[] = [exit, exitStub, corner, entryStub, entry];
    for (const p of points) {
      if (p.x > routeMaxX) routeMaxX = p.x;
      if (p.y > routeMaxY) routeMaxY = p.y;
    }
    edgePoints.push(points);
    const edge: PositionedEdge = {
      from: e.from,
      to: e.to,
      path: "",
      kind: "flow",
      color: e.colored ? roleColorKey(v.role) : "accent",
      arrowHead: e.arrow ?? "end",
    };
    if (e.label !== undefined) {
      edge.label = e.label;
      // Center the badge on the corridor run (the segment beside the node).
      edge.labelPoint =
        direction === "TD"
          ? { x: entryStub.x, y: (exitStub.y + entryStub.y) / 2 }
          : { x: (exitStub.x + entryStub.x) / 2, y: entryStub.y };
      // Plain measure (drawn verbatim, no inline-code chips), multi-line aware.
      const measured = measurePlainMultiline(e.label, undefined, textCase);
      edge.labelWidth = measured.width;
      edge.labelHeight = measured.height;
    }
    positionedEdges.push(edge);
  }

  // ── Annotations (`note`) ──────────────────────────────────────────────
  // Notes never participate in RANKING/ordering (they are not in `graph.nodes`,
  // so `assignRanks` never saw them and no dummy chain was built) — they can
  // never change which rank a real node lands in. A note between same-rank
  // siblings may reserve cross-axis space above; exact box placement is a
  // post-pass over the already-resolved real-node centers.
  //
  // Each note starts centered in the gutter on its requested side. If that box
  // would cover a routed flow edge, slide it along the target's face to the
  // nearest clear position. The requested side and routed flow edges stay
  // fixed. Multiple notes on the same side stack outward as before.
  //
  // The note chip + leader are appended to `nodes`/`positionedEdges`/`edgePoints`
  // BEFORE the label-bounds normalization below, so the same "labels grow the
  // canvas" pass that guards edge labels also grows the viewBox for a note and,
  // when one would spill past the top/left origin, SHIFTS the whole graph to keep
  // it in frame. That shift is a pure translation (relative layout unchanged) and
  // keeps the note on its requested side. A note is position-neutral for real
  // nodes unless sibling spacing was reserved or this origin shift is needed.
  // Collision handling never changes ranks or reroutes the flow edges.
  const mainAxis = direction === "LR" ? "x" : "y";
  const needsClearance = (graph.notes?.length ?? 0) > 0 ||
    positionedEdges.some((edge) => edge.labelPoint !== undefined);
  const flowPaths = needsClearance
    ? edgePoints.map((points) => renderedPathSegments(points, edgeStyle, mainAxis))
    : [];
  const noteBoxes: PositionedNode[] = [];
  const movedNoteEdges = new Set<number>();
  if (graph.notes && graph.notes.length > 0) {
    // Accumulated outward distance already consumed by prior notes on a side,
    // keyed `${target}|${side}`, so stacked notes step past each other.
    const stackOffset = new Map<string, number>();
    let noteSeed = 0;
    for (const note of graph.notes) {
      const tv = vById.get(note.target);
      // Drop notes whose target isn't a real node (same policy as a dangling edge).
      if (tv === undefined || tv.isDummy) continue;
      const role: SemanticRole = note.role ?? "neutral";
      const label = wrapNodeLabel(note.label);
      const { w: nw, h: nh } = sizeShape("box", label, sizeOpts);

      const vertical = note.side === "above" || note.side === "below";
      const sign = note.side === "above" || note.side === "left" ? -1 : +1;
      const targetHalf = (vertical ? tv.h : tv.w) / 2;
      const noteExtent = vertical ? nh : nw;
      const key = `${note.target}|${note.side}`;
      const consumed = stackOffset.get(key) ?? 0;
      // Distance from the target CENTER out to the note's near face, then to its
      // own center; the next same-side note starts one note + gap further out.
      const nearFaceDist = targetHalf + calloutGap + consumed;
      const centerDist = nearFaceDist + noteExtent / 2;
      stackOffset.set(key, consumed + noteExtent + calloutGap);

      let nx = vertical ? tv.center.x : tv.center.x + sign * centerDist;
      let ny = vertical ? tv.center.y + sign * centerDist : tv.center.y;
      const initialAlong = vertical ? nx : ny;
      const halfAlong = (vertical ? nw : nh) / 2;
      const fixedMin = vertical ? ny - nh / 2 : nx - nw / 2;
      const fixedMax = vertical ? ny + nh / 2 : nx + nw / 2;
      // The target itself defines the requested gutter. In particular,
      // calloutGap: 0 may intentionally put the chip flush against its face.
      const occupied = nodes
        .filter((n) => n.id !== note.target)
        .map((n) => boxBounds(n.x, n.y, n.w ?? 0, n.h ?? 0));
      // A moved note can still have a straight leader: attach from the near
      // third of its face, directly below/above (or beside) an open target-face
      // point. Only a note too far aside needs a bent leader.
      const targetCenterAlong = vertical ? tv.center.x : tv.center.y;
      const targetHalfAlong = (vertical ? tv.w : tv.h) / 2;
      const faceInset = Math.min(NOTE_CLEARANCE, targetHalfAlong);
      const faceMin = targetCenterAlong - targetHalfAlong + faceInset;
      const faceMax = targetCenterAlong + targetHalfAlong - faceInset;
      const clampToFace = (value: number): number => Math.max(faceMin, Math.min(value, faceMax));
      // Keep the leader tip off any flow arrow already using this face.
      const used: number[] = [];
      const faceNormal = vertical
        ? tv.center.y + sign * targetHalf
        : tv.center.x + sign * targetHalf;
      for (let i = 0; i < positionedEdges.length; i++) {
        const edge = positionedEdges[i] as PositionedEdge;
        if (edge.kind !== "flow") continue;
        const points = edgePoints[i] as Point[];
        const endpoint = edge.to === note.target
          ? points[points.length - 1]
          : edge.from === note.target ? points[0] : undefined;
        if (endpoint === undefined) continue;
        const normal = vertical ? endpoint.y : endpoint.x;
        if (Math.abs(normal - faceNormal) < edgeGap + 0.01) {
          used.push(vertical ? endpoint.x : endpoint.y);
        }
      }
      const buildLeader = (along: number) => {
        const moved = Math.abs(along - initialAlong) > 0.001;
        const x = vertical ? along : nx;
        const y = vertical ? ny : along;
        let targetAlong = moved ? clampToFace(along) : along;
        let straightLeader = !moved;
        if (moved) {
          const openOnFace = (min: number, max: number): number | undefined => {
            if (min > max) return undefined;
            const clamp = (value: number): number => Math.max(min, Math.min(value, max));
            const choices = [clamp(along), min, max];
            for (const position of used) {
              choices.push(clamp(position - NOTE_CLEARANCE - 1));
              choices.push(clamp(position + NOTE_CLEARANCE + 1));
            }
            choices.sort((a, b) => Math.abs(a - along) - Math.abs(b - along) || b - a);
            return choices.find((candidate) =>
              used.every((position) => Math.abs(candidate - position) > NOTE_CLEARANCE),
            );
          };
          const third = (halfAlong * 2) / 3;
          const nearSide = along > targetCenterAlong;
          const thirdMin = nearSide
            ? along - halfAlong + NOTE_CLEARANCE
            : along + halfAlong - third;
          const thirdMax = nearSide
            ? along - halfAlong + third
            : along + halfAlong - NOTE_CLEARANCE;
          const straightPoint = openOnFace(Math.max(faceMin, thirdMin), Math.min(faceMax, thirdMax));
          if (straightPoint !== undefined) {
            targetAlong = straightPoint;
            straightLeader = true;
          } else {
            targetAlong = openOnFace(faceMin, faceMax) ?? targetAlong;
          }
        }
        const noteFaceAlong = straightLeader ? targetAlong : along;
        const noteFace: Point = vertical
          ? { x: noteFaceAlong, y: y - sign * (nh / 2) }
          : { x: x - sign * (nw / 2), y: noteFaceAlong };
        const targetFace: Point = vertical
          ? { x: targetAlong, y: tv.center.y + sign * targetHalf }
          : { x: tv.center.x + sign * targetHalf, y: targetAlong };
        const mid = vertical
          ? (noteFace.y + targetFace.y) / 2
          : (noteFace.x + targetFace.x) / 2;
        const points: Point[] = moved && !straightLeader
          ? vertical
            ? [noteFace, { x, y: mid }, { x: targetAlong, y: mid }, targetFace]
            : [noteFace, { x: mid, y }, { x: mid, y: targetAlong }, targetFace]
          : [noteFace, targetFace];
        return { x, y, moved, straightLeader, points };
      };
      // The note's normal-axis gutter is fixed. An edge elsewhere cannot meet
      // either the chip or its leader, so omit it before searching sideways.
      const normalMin = Math.min(fixedMin, faceNormal) - NOTE_CLEARANCE - 1;
      const normalMax = Math.max(fixedMax, faceNormal) + NOTE_CLEARANCE + 1;
      const alongBounds = ({ a, b, error }: RenderedSegment): [number, number] =>
        vertical
          ? [Math.min(a.x, b.x) - error, Math.max(a.x, b.x) + error]
          : [Math.min(a.y, b.y) - error, Math.max(a.y, b.y) + error];
      const crossesGutter = ({ a, b, error }: RenderedSegment): boolean =>
        vertical
          ? Math.max(a.y, b.y) + error >= normalMin && Math.min(a.y, b.y) - error <= normalMax
          : Math.max(a.x, b.x) + error >= normalMin && Math.min(a.x, b.x) - error <= normalMax;
      const gutterPaths = flowPaths
        .map((path) => path.filter(crossesGutter))
        .filter((path) => path.length > 0);
      const gutterBoxes = occupied.filter((box) => vertical
        ? box.bottom >= normalMin && box.top <= normalMax
        : box.right >= normalMin && box.left <= normalMax);
      let radius = Math.max(32, halfAlong, targetHalfAlong) + NOTE_CLEARANCE;
      let maxRadius = radius;
      const includeExtent = (min: number, max: number): void => {
        maxRadius = Math.max(maxRadius,
          Math.abs(min - initialAlong) + halfAlong + NOTE_CLEARANCE + 1,
          Math.abs(max - initialAlong) + halfAlong + NOTE_CLEARANCE + 1);
      };
      for (const path of gutterPaths) {
        for (const segment of path) includeExtent(...alongBounds(segment));
      }
      for (const box of gutterBoxes) includeExtent(
        vertical ? box.left : box.top,
        vertical ? box.right : box.bottom,
      );

      let clearAlong: number | undefined;
      while (clearAlong === undefined) {
        // Widen only when every candidate in the current interval is blocked.
        // This keeps distant routes out of both candidate sorting and the
        // expensive segment-to-segment checks for nearby placements.
        const reach = radius + Math.max(halfAlong, targetHalfAlong) + NOTE_CLEARANCE + 1;
        const searchMin = initialAlong - reach;
        const searchMax = initialAlong + reach;
        const localPaths = gutterPaths
          .map((path) => path.filter((segment) => {
            const [min, max] = alongBounds(segment);
            return max >= searchMin && min <= searchMax;
          }))
          .filter((path) => path.length > 0);
        const localBoxes = gutterBoxes.filter((box) => vertical
          ? box.right >= searchMin && box.left <= searchMax
          : box.bottom >= searchMin && box.top <= searchMax);
        const candidates = new Set<number>([initialAlong]);
        const addCandidates = (min: number, max: number): void => {
          candidates.add(min - halfAlong - NOTE_CLEARANCE - 1);
          candidates.add(max + halfAlong + NOTE_CLEARANCE + 1);
        };
        for (const path of localPaths) {
          for (const segment of path) addCandidates(...alongBounds(segment));
        }
        for (const box of localBoxes) addCandidates(
          vertical ? box.left : box.top,
          vertical ? box.right : box.bottom,
        );
        const clear = (along: number): boolean => {
          const proposed = buildLeader(along);
          const box = boxBounds(proposed.x, proposed.y, nw, nh);
          if (localBoxes.some((other) => boxesOverlap(box, other, NOTE_CLEARANCE)) ||
              localPaths.some((path) => pathHitsBox(path, box, NOTE_CLEARANCE))) return false;
          const leaderStyle = proposed.moved && !proposed.straightLeader ? "orthogonal" : edgeStyle;
          const leader = renderedPathSegments(proposed.points, leaderStyle, mainAxis);
          return localBoxes.every((other) => !pathHitsBox(leader, other, NOTE_CLEARANCE / 2)) &&
            localPaths.every((path) => !pathsTooClose(leader, path, NOTE_CLEARANCE / 2));
        };
        clearAlong = [...candidates]
          .filter((candidate) => Math.abs(candidate - initialAlong) <= radius)
          .sort((a, b) => Math.abs(a - initialAlong) - Math.abs(b - initialAlong) || b - a)
          .find(clear);
        if (clearAlong !== undefined || radius >= maxRadius) break;
        radius = Math.min(maxRadius, radius * 2);
      }
      const along = clearAlong ?? initialAlong;
      const { x, y, moved, straightLeader, points } = buildLeader(along);
      nx = x;
      ny = y;

      const noteId = `__note_${noteSeed++}`;
      const box: PositionedNode = {
        id: noteId,
        kind: "note",
        x: nx,
        y: ny,
        color: roleColorKey(role),
        shape: "box",
        role,
        w: nw,
        h: nh,
      };
      if (label !== undefined) {
        box.label = label;
        box.labelWidth = measureMultiline(label, undefined, textCase).width;
      }
      nodes.push(box);
      noteBoxes.push(box);

      for (const p of points) {
        if (p.x > routeMaxX) routeMaxX = p.x;
        if (p.y > routeMaxY) routeMaxY = p.y;
        if (p.x < routeMinX) routeMinX = p.x;
        if (p.y < routeMinY) routeMinY = p.y;
      }
      edgePoints.push(points);
      if (moved && !straightLeader) movedNoteEdges.add(positionedEdges.length);
      positionedEdges.push({
        from: noteId,
        to: note.target,
        path: "",
        kind: "note",
        // Leaders are always the neutral accent connector — never tinted.
        color: "accent",
        arrowHead: "end",
      });
    }
  }

  // Stagger only the parallel pairs whose full badge rectangles would collide.
  // Put their badges outside the two lanes and connect each badge to its own
  // straight run. Centering wide badges on the lanes hides both arrows and
  // makes it impossible to tell which label belongs to which direction.
  const stackedPositioned = new Set<PositionedEdge>();
  for (const pair of stackedPairs) {
    const forward = positionedEdges[edges.indexOf(pair.forward)] as PositionedEdge;
    const reverse = positionedEdges[edges.indexOf(pair.reverse)] as PositionedEdge;
    const gapStart = (rankMainStart[pair.gapRank] as number) + (rankThickness[pair.gapRank] as number);
    const gapEnd = rankMainStart[pair.gapRank + 1] as number;
    const content = pair.forwardMain + pair.reverseMain + LABEL_GAP;
    const firstCenter = (gapStart + gapEnd - content) / 2 + pair.forwardMain / 2;
    const secondCenter = firstCenter + pair.forwardMain / 2 + LABEL_GAP + pair.reverseMain / 2;
    if (direction === "TD") {
      const forwardLane = (forward.labelPoint as Point).x;
      const reverseLane = (reverse.labelPoint as Point).x;
      const forwardSide = forwardLane < reverseLane ? -1 : 1;
      forward.labelAnchor = { x: forwardLane, y: firstCenter };
      reverse.labelAnchor = { x: reverseLane, y: secondCenter };
      forward.labelPoint = {
        x: forwardLane + forwardSide * (badgeWidth(forward.labelWidth ?? 0) / 2 + LABEL_GAP),
        y: firstCenter,
      };
      reverse.labelPoint = {
        x: reverseLane - forwardSide * (badgeWidth(reverse.labelWidth ?? 0) / 2 + LABEL_GAP),
        y: secondCenter,
      };
    } else {
      const forwardLane = (forward.labelPoint as Point).y;
      const reverseLane = (reverse.labelPoint as Point).y;
      const forwardSide = forwardLane < reverseLane ? -1 : 1;
      forward.labelAnchor = { x: firstCenter, y: forwardLane };
      reverse.labelAnchor = { x: secondCenter, y: reverseLane };
      forward.labelPoint = {
        x: firstCenter,
        y: forwardLane + forwardSide * (badgeHeight(forward.labelHeight ?? 0) / 2 + LABEL_GAP),
      };
      reverse.labelPoint = {
        x: secondCenter,
        y: reverseLane - forwardSide * (badgeHeight(reverse.labelHeight ?? 0) / 2 + LABEL_GAP),
      };
    }
    stackedPositioned.add(forward);
    stackedPositioned.add(reverse);
  }

  // ── Align sibling edge labels to a shared level ───────────────────────
  // Labels on adjacent-rank forward edges that fan out from the SAME source
  // land on each edge's own diagonal. Those can sit at different main-axis
  // depths: one high near the fork, one low near its target box. Snap every
  // labeled sibling to the SHALLOWEST of the group's main-axis levels (TD: min y;
  // LR: min x) so a decision's branch labels read as one aligned row, clear of
  // the downstream nodes. A multi-rank edge keeps its own level so its label
  // stays attached to its route. Each label keeps its own cross-axis position.
  // Grouped by source id in input order; deterministic.
  const labeledBySource = new Map<NodeId, PositionedEdge[]>();
  for (const pe of positionedEdges) {
    if (pe.labelPoint === undefined) continue;
    // Back-edges and staggered pairs keep the level found on their own route.
    const fromV = vById.get(pe.from);
    const toV = vById.get(pe.to);
    if (fromV === undefined || toV === undefined || toV.rank !== fromV.rank + 1 ||
        stackedPositioned.has(pe)) continue;
    const list = labeledBySource.get(pe.from);
    if (list) list.push(pe);
    else labeledBySource.set(pe.from, [pe]);
  }
  for (const [from, group] of labeledBySource) {
    if (group.length < 2) continue;
    let level = Infinity;
    for (const pe of group) {
      const main = direction === "TD" ? (pe.labelPoint as Point).y : (pe.labelPoint as Point).x;
      if (main < level) level = main;
    }
    // Snapping to the SHALLOWEST sibling can drag the group's TALLEST badge up
    // into the source node: the inter-rank gap was widened for that badge's main
    // extent, but this shared level rides the shallowest sibling's own diagonal,
    // which can sit shallower than the gap's center. Floor the level so even the
    // tallest badge clears the source's forward face by `LABEL_GAP`. Alignment
    // only moves labels shallower, so the source side is the only one at risk.
    const src = vById.get(from) as Vertex;
    let maxHalf = 0;
    for (const pe of group) {
      const extent =
        direction === "TD" ? badgeHeight(pe.labelHeight ?? 0) : badgeWidth(pe.labelWidth ?? 0);
      if (extent / 2 > maxHalf) maxHalf = extent / 2;
    }
    const srcForward = direction === "TD" ? src.center.y + src.h / 2 : src.center.x + src.w / 2;
    const floor = srcForward + maxHalf + LABEL_GAP;
    if (level < floor) level = floor;
    for (const pe of group) {
      const lp = pe.labelPoint as Point;
      pe.labelPoint = direction === "TD" ? { x: lp.x, y: level } : { x: level, y: lp.y };
    }
  }

  // A badge can hide a different arrow crossing beneath it, including a badge
  // already displaced for a parallel pair. Move it to a clear side of its own
  // route with a short connector. Check the connector as well as the badge.
  for (let i = 0; i < positionedEdges.length; i++) {
    const pe = positionedEdges[i] as PositionedEdge;
    if (pe.labelPoint === undefined) continue;
    const halfW = badgeWidth(pe.labelWidth ?? 0) / 2;
    const halfH = badgeHeight(pe.labelHeight ?? 0) / 2;
    const badgeAt = (point: Point): Bounds => boxBounds(point.x, point.y, halfW * 2, halfH * 2);
    const hitsAnotherRoute = (box: Bounds): boolean => positionedEdges.some((other, j) => {
      if (j === i || other.kind !== "flow") return false;
      return pathHitsBox(flowPaths[j] as RenderedSegment[], box, 1);
    });
    if (!hitsAnotherRoute(badgeAt(pe.labelPoint))) continue;

    // A Bézier label's waypoint midpoint may lie off the visible spline.
    // Anchor the displaced badge to the actual rendered route.
    const anchor = pe.labelAnchor ?? closestPointOnPath(
      pe.labelPoint, flowPaths[i] as RenderedSegment[],
    );
    const crossHalf = direction === "TD" ? halfW : halfH;
    const candidates = [-1, 1].map((side) => direction === "TD"
      ? { x: anchor.x + side * (crossHalf + LABEL_GAP), y: anchor.y }
      : { x: anchor.x, y: anchor.y + side * (crossHalf + LABEL_GAP) });
    const clear = (point: Point): boolean => {
      const box = badgeAt(point);
      if (hitsAnotherRoute(box)) return false;
      if (nodes.some((node) => boxesOverlap(box, boxBounds(node.x, node.y, node.w ?? 0, node.h ?? 0), LABEL_GAP / 2))) {
        return false;
      }
      if (positionedEdges.some((other, j) => j !== i && other.labelPoint !== undefined &&
          boxesOverlap(box, badgeAtOther(other), LABEL_GAP / 2))) return false;
      const face: Point = direction === "TD"
        ? { x: point.x < anchor.x ? box.right : box.left, y: point.y }
        : { x: point.x, y: point.y < anchor.y ? box.bottom : box.top };
      const connector: RenderedSegment[] = [{ a: face, b: anchor, error: 0 }];
      return nodes.every((node) => !pathHitsBox(connector,
        boxBounds(node.x, node.y, node.w ?? 0, node.h ?? 0), LABEL_GAP / 2)) &&
        flowPaths.every((path, j) => j === i || !pathsTooClose(connector, path, 1));
    };
    const badgeAtOther = (other: PositionedEdge): Bounds => boxBounds(
      (other.labelPoint as Point).x, (other.labelPoint as Point).y,
      badgeWidth(other.labelWidth ?? 0), badgeHeight(other.labelHeight ?? 0),
    );
    const selected = candidates.find(clear);
    if (selected !== undefined) {
      pe.labelAnchor = anchor;
      pe.labelPoint = selected;
    }
  }

  // ── Fold edge-label badges into the bounds ────────────────────────────
  // Edge labels render as a sliced badge centered on `labelPoint`
  // (badgeWidth × badgeHeight). A label wider than the graph spills past the
  // viewBox on either side, breaking the contract that width/height bound ALL
  // geometry including labels. Left/top spill shifts the whole geometry
  // right/down (same normalization as the git leading badge); right/bottom
  // spill just grows the canvas.
  let labelMinX = Infinity;
  let labelMinY = Infinity;
  let labelMaxX = -Infinity;
  let labelMaxY = -Infinity;
  for (const pe of positionedEdges) {
    if (pe.labelPoint === undefined) continue;
    const halfW = badgeWidth(pe.labelWidth ?? 0) / 2;
    const halfH = badgeHeight(pe.labelHeight ?? 0) / 2;
    if (pe.labelPoint.x - halfW < labelMinX) labelMinX = pe.labelPoint.x - halfW;
    if (pe.labelPoint.x + halfW > labelMaxX) labelMaxX = pe.labelPoint.x + halfW;
    if (pe.labelPoint.y - halfH < labelMinY) labelMinY = pe.labelPoint.y - halfH;
    if (pe.labelPoint.y + halfH > labelMaxY) labelMaxY = pe.labelPoint.y + halfH;
  }
  // Annotation chips ride the same normalization as edge labels: an `above`/
  // `left` note spilling past the top/left origin shifts the whole graph to
  // remain visible; a `below`/`right` note can grow the far canvas. A note that
  // slid along its target's face may extend either side of the canvas.
  for (const nb of noteBoxes) {
    const halfW = (nb.w ?? 0) / 2;
    const halfH = (nb.h ?? 0) / 2;
    if (nb.x - halfW < labelMinX) labelMinX = nb.x - halfW;
    if (nb.x + halfW > labelMaxX) labelMaxX = nb.x + halfW;
    if (nb.y - halfH < labelMinY) labelMinY = nb.y - halfH;
    if (nb.y + halfH > labelMaxY) labelMaxY = nb.y + halfH;
  }
  const shiftX = labelMinX === Infinity ? 0 : Math.max(0, padding - labelMinX);
  const shiftY = labelMinY === Infinity ? 0 : Math.max(0, padding - labelMinY);
  if (shiftX > 0 || shiftY > 0) {
    for (const n of nodes) {
      n.x += shiftX;
      n.y += shiftY;
    }
    if (positionedGroups !== undefined) {
      for (const g of positionedGroups) {
        g.x += shiftX;
        g.y += shiftY;
      }
    }
    // Every waypoint (stubs, detours, dummy span points) is a fresh per-edge
    // object — no shared Point references, so no double shifts.
    for (const pts of edgePoints) {
      for (const p of pts) {
        p.x += shiftX;
        p.y += shiftY;
      }
    }
    for (const pe of positionedEdges) {
      if (pe.labelPoint !== undefined) {
        pe.labelPoint = { x: pe.labelPoint.x + shiftX, y: pe.labelPoint.y + shiftY };
      }
      if (pe.labelAnchor !== undefined) {
        pe.labelAnchor = { x: pe.labelAnchor.x + shiftX, y: pe.labelAnchor.y + shiftY };
      }
    }
    routeMaxX += shiftX;
    routeMaxY += shiftY;
    width += shiftX;
    height += shiftY;
  }
  if (labelMaxX !== -Infinity) {
    if (labelMaxX + shiftX + padding > width) width = labelMaxX + shiftX + padding;
    if (labelMaxY + shiftY + padding > height) height = labelMaxY + shiftY + padding;
  }

  // Grow the viewBox to include any edge route that bulged past the node bounds
  // (back-edge side detours). routeMin* are clamped at 0 by the corridor guard,
  // so geometry never needs a global shift here.
  if (routeMaxX + padding > width) width = routeMaxX + padding;
  if (routeMaxY + padding > height) height = routeMaxY + padding;
  void routeMinX;
  void routeMinY;

  // Build the SVG path strings now that every waypoint is final.
  positionedEdges.forEach((pe, i) => {
    pe.path = pathThrough(
      edgePoints[i] as Point[], movedNoteEdges.has(i) ? "orthogonal" : edgeStyle, mainAxis,
    );
  });

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
  // is keyed "from to"; all parallel duplicates of that pair are dropped.
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
