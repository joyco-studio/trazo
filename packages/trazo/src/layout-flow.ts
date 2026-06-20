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
  FlowLayoutOptions,
  FlowNode,
  NodeId,
  NodeShape,
  Point,
  PositionedEdge,
  PositionedGraph,
  PositionedNode,
  SemanticRole,
} from "./types.js";
import {
  entryAnchor,
  exitAnchor,
  measureLabel,
  pathThrough,
  polylineMidpoint,
  sizeShape,
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

/** Token key for a node's color from its semantic role. */
function roleColorKey(role: SemanticRole): string {
  return `role-${role}`;
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
  /** Resolved center after coordinate assignment. */
  center: Point;
}

export function layoutFlow(
  graph: FlowGraph,
  options?: FlowLayoutOptions,
): PositionedGraph {
  const direction = options?.direction ?? DEFAULTS.direction;
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
        center: { x: 0, y: 0 },
      };
      vById.set(id, v);
      chain.push(id);
    }
    // Chain is ordered from the lower rank to the higher rank.
    dummyChain.set(e, chain);
  });

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
        reorderLayer(layers[r] as Vertex[], upNeighbors, vById);
      }
    } else {
      for (let r = layers.length - 2; r >= 0; r--) {
        reorderLayer(layers[r] as Vertex[], downNeighbors, vById);
      }
    }
  }

  // ── 4. Coordinate assignment ──────────────────────────────────────────
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
    let acc = padding;
    for (let r = 0; r < layers.length; r++) {
      rankMainStart[r] = acc;
      acc += (rankThickness[r] as number) + layerGap;
    }
  }

  let crossMax = 0;
  for (const layer of layers) {
    // Cross-axis pack: running cursor by order, gap + half-widths.
    let cursor = padding;
    for (let i = 0; i < layer.length; i++) {
      const v = layer[i] as Vertex;
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
    }
    const layerCrossEnd = cursor - nodeGap + padding;
    if (layerCrossEnd > crossMax) crossMax = layerCrossEnd;
  }

  // Total bounds. Main axis spans through the last rank's far edge + padding.
  const lastRank = layers.length - 1;
  const mainEnd =
    (rankMainStart[lastRank] as number) +
    (rankThickness[lastRank] as number) +
    padding;

  const width = direction === "TD" ? crossMax : mainEnd;
  const height = direction === "TD" ? mainEnd : crossMax;

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
      // Labels render uppercase (JOYCO style) with tracking; measure both.
      node.labelWidth = measureLabel(n.label.toUpperCase());
    }
    return node;
  });

  // ── 5. Edge routing ───────────────────────────────────────────────────
  const positionedEdges: PositionedEdge[] = edges.map((e) => {
    const fromV = vById.get(e.from) as Vertex;
    const toV = vById.get(e.to) as Vertex;
    const chain = dummyChain.get(e) as NodeId[];

    // The expanded path runs low-rank → high-rank; orient endpoints so the
    // exit anchor is on `from` and the entry anchor is on `to`.
    const fromIsLower = fromV.rank <= toV.rank;
    const exit = exitAnchor(
      fromV.center,
      fromV.w,
      fromV.h,
      fromV.shape,
      direction,
    );
    const entry = entryAnchor(
      toV.center,
      toV.w,
      toV.h,
      toV.shape,
      direction,
    );

    const middle = chain.map((id) => (vById.get(id) as Vertex).center);
    const orderedMiddle = fromIsLower ? middle : [...middle].reverse();
    // Perpendicular stubs off the exit and entry faces so the edge always
    // leaves/enters at 90° before any 45°/orthogonal turn. The stub points are
    // inserted just inside each anchor; the middle (dummy) points route the rest.
    const exitStub =
      direction === "TD"
        ? { x: exit.x, y: exit.y + stub }
        : { x: exit.x + stub, y: exit.y };
    const entryStub =
      direction === "TD"
        ? { x: entry.x, y: entry.y - stub }
        : { x: entry.x - stub, y: entry.y };
    const points: Point[] = [
      exit,
      exitStub,
      ...orderedMiddle,
      entryStub,
      entry,
    ];

    const edge: PositionedEdge = {
      from: e.from,
      to: e.to,
      path: pathThrough(points, edgeStyle),
      kind: "flow",
      // Default edges are neutral accent; opt in to the source role's color.
      color: e.colored ? roleColorKey(fromV.role) : "accent",
    };
    if (e.label !== undefined) {
      edge.label = e.label;
      edge.labelPoint = polylineMidpoint(points);
      edge.labelWidth = measureLabel(e.label.toUpperCase());
    }
    return edge;
  });

  return {
    nodes,
    edges: positionedEdges,
    width,
    height,
    laneCount: layers.length,
  };
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

/**
 * Reorder a layer by the barycenter (mean order) of each vertex's neighbors in
 * the adjacent layer. Stable sort on the computed key; vertices with no
 * neighbors keep their current order (key = their current order). Equal keys
 * preserve prior order.
 */
function reorderLayer(
  layer: Vertex[],
  neighbors: Map<NodeId, NodeId[]>,
  vById: Map<NodeId, Vertex>,
): void {
  const keyed = layer.map((v, i) => {
    const nbrs = neighbors.get(v.id) as NodeId[];
    let key: number;
    if (nbrs.length === 0) {
      key = v.order;
    } else {
      let sum = 0;
      for (const nb of nbrs) sum += (vById.get(nb) as Vertex).order;
      key = sum / nbrs.length;
    }
    return { v, key, i };
  });
  // Stable sort: compare by key, break ties by prior position `i`.
  keyed.sort((a, b) => (a.key === b.key ? a.i - b.i : a.key - b.key));
  for (let i = 0; i < keyed.length; i++) {
    const entry = keyed[i] as { v: Vertex };
    layer[i] = entry.v;
    entry.v.order = i;
  }
}
