/**
 * Deterministic git-graph layout.
 *
 * Pure TypeScript: no DOM, no canvas, no `window`. Equal `CommitGraph` (same
 * commits, same order) always produces a deeply-equal `PositionedGraph`. The
 * only ordering decisions made here are fixed functions of the input order, so
 * there is no dependence on hash-map iteration order, time, or randomness.
 *
 * ── Lane algorithm (topological, first-parent-stable) ──────────────────────
 * Commits are walked newest-first in the caller's given order, normalized so a
 * child is always placed on a row above its parents. We keep a set of "active
 * lanes": each lane is reserved by whichever not-yet-placed commit currently
 * occupies that column. When a commit is placed:
 *   - it takes the lowest-indexed lane already reserved for it, or a fresh free
 *     lane if none (a branch tip / root reserves a new lane);
 *   - its FIRST parent inherits the commit's lane (the mainline stays in
 *     column), unless that parent already holds an earlier lane;
 *   - each additional parent (a merge's non-mainline parents) is reserved a
 *     fresh free lane — this is the "branch" that merged in.
 * Lanes whose reserving commit has been placed and has no further claim are
 * freed and reused, keeping the graph as narrow as the DAG allows.
 */

import type {
  Commit,
  CommitGraph,
  CommitId,
  EdgeKind,
  EdgeStyle,
  GitLabelSide,
  GitOrientation,
  LayoutOptions,
  PositionedEdge,
  PositionedGraph,
  PositionedNode,
  Point,
} from "./types.js";
import {
  curveBetween,
  measureLabel,
  NODE_HALF,
  LABEL_GAP,
  LABEL_BADGE_PAD,
  BADGE_H,
} from "./geometry.js";

const DEFAULTS = {
  laneWidth: 28,
  rowHeight: 40,
  nodeRadius: 6,
  padding: 16,
} as const;

/** Number of distinct lane color token keys before cycling. Renderer maps these. */
function laneColorKey(lane: number): string {
  return `lane-${lane}`;
}

/**
 * Normalize the input into a deterministic top-to-bottom order where every
 * child appears before all of its parents. We preserve the caller's order as
 * the tie-breaker so identical input → identical output.
 *
 * Strategy: a stable depth-first / Kahn-style walk seeded by the caller's order
 * of "tip" commits (commits that are nobody's parent), falling back to the
 * caller's overall order. Cycles (which a real DAG won't have) are broken by
 * input order so the function still terminates deterministically.
 */
function orderCommits(commits: Commit[]): Commit[] {
  const byId = new Map<CommitId, Commit>();
  for (const c of commits) byId.set(c.id, c);

  // childCount[id] = how many in-graph commits list `id` as a parent.
  const childCount = new Map<CommitId, number>();
  for (const c of commits) childCount.set(c.id, 0);
  for (const c of commits) {
    for (const p of c.parents) {
      if (childCount.has(p)) childCount.set(p, (childCount.get(p) ?? 0) + 1);
    }
  }

  const remainingChildren = new Map(childCount);
  const placed = new Set<CommitId>();
  const order: Commit[] = [];

  // Seed queue: tips (no children) in caller order. Using the caller's index
  // keeps the walk deterministic and stable.
  const indexOf = new Map<CommitId, number>();
  commits.forEach((c, i) => indexOf.set(c.id, i));

  const ready: CommitId[] = [];
  const pushReady = (id: CommitId) => {
    if (!placed.has(id) && byId.has(id) && !ready.includes(id)) ready.push(id);
  };

  for (const c of commits) {
    if ((remainingChildren.get(c.id) ?? 0) === 0) pushReady(c.id);
  }
  // Keep ready ordered by caller index for determinism.
  ready.sort((a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0));

  while (order.length < commits.length) {
    if (ready.length === 0) {
      // Cycle or disconnected leftover: take the earliest unplaced by input
      // order so we always make progress deterministically.
      const next = commits.find((c) => !placed.has(c.id));
      if (!next) break;
      ready.push(next.id);
    }

    ready.sort((a, b) => (indexOf.get(a) ?? 0) - (indexOf.get(b) ?? 0));
    const id = ready.shift() as CommitId;
    if (placed.has(id)) continue;
    const commit = byId.get(id);
    if (!commit) continue;

    placed.add(id);
    order.push(commit);

    for (const p of commit.parents) {
      if (!byId.has(p)) continue;
      const left = (remainingChildren.get(p) ?? 0) - 1;
      remainingChildren.set(p, left);
      if (left <= 0) pushReady(p);
    }
  }

  return order;
}

/**
 * Assign an integer lane to every commit using the first-parent-stable walk
 * described at the top of this file.
 */
function assignLanes(ordered: Commit[]): {
  laneOf: Map<CommitId, number>;
  laneCount: number;
} {
  const laneOf = new Map<CommitId, number>();

  // `lanes[i]` holds the CommitId currently reserving column i, or null if free.
  const lanes: (CommitId | null)[] = [];

  const firstFreeLane = (): number => {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) return i;
    }
    lanes.push(null);
    return lanes.length - 1;
  };

  // Find the lowest lane index currently reserved for `id`, if any.
  const reservedLaneFor = (id: CommitId): number => {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === id) return i;
    }
    return -1;
  };

  for (const commit of ordered) {
    // Claim this commit's lane: either one already reserved for it (it was a
    // parent some child pointed at) or a fresh free lane (a tip / root).
    let lane = reservedLaneFor(commit.id);
    if (lane === -1) {
      lane = firstFreeLane();
    }
    laneOf.set(commit.id, lane);

    // Free every lane reserved for this commit; we re-reserve below for the
    // parents that continue the lines.
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.id) lanes[i] = null;
    }

    const parents = commit.parents;
    if (parents.length > 0) {
      const firstParent = parents[0] as CommitId;
      const existing = reservedLaneFor(firstParent);
      if (existing === -1) {
        // Mainline parent inherits this commit's column when it's free; this is
        // what keeps a straight branch in a single lane.
        if (lanes[lane] === null) {
          lanes[lane] = firstParent;
        } else {
          lanes[firstFreeLane()] = firstParent;
        }
      }
      // Non-mainline (merge) parents reserve fresh lanes if not already active.
      for (let p = 1; p < parents.length; p++) {
        const pid = parents[p] as CommitId;
        if (reservedLaneFor(pid) === -1) {
          lanes[firstFreeLane()] = pid;
        }
      }
    }
  }

  // laneCount is the widest the graph ever got = highest assigned lane + 1.
  let maxLane = -1;
  for (const l of laneOf.values()) if (l > maxLane) maxLane = l;
  return { laneOf, laneCount: maxLane + 1 };
}

/**
 * Build the SVG `d` path for an edge between two placed nodes: a straight
 * vertical line when the lane doesn't change, a smooth cubic curve when it
 * does (control points at the vertical midpoint so it eases between columns).
 * Edge *kind* is decided by the caller from DAG structure, not geometry.
 *
 * The curve itself is the shared `curveBetween` helper in geometry.ts: same-lane
 * commits share an x, so it returns a straight `L`; lane-changing edges (always
 * across different rows) get the cubic ease — byte-identical to the prior
 * inline implementation.
 */
function edgePath(
  from: PositionedNode,
  to: PositionedNode,
  style: EdgeStyle,
): string {
  return curveBetween({ x: from.x, y: from.y }, { x: to.x, y: to.y }, style);
}

/**
 * Top-left corner of the label badge for a placed commit, given the chart
 * orientation and which side the badge sits on. The badge is `labelWidth +
 * 2*LABEL_BADGE_PAD` wide and `BADGE_H` tall.
 *
 *  - vertical:   badge sits beside the square (right → after it on x, left →
 *    before it), vertically centered on the square.
 *  - horizontal: badge sits below/above the square (right → below on y, left →
 *    above), horizontally centered on the square.
 *
 * Keeping this in the engine (not the renderer) preserves the "engine owns
 * geometry" invariant: the renderer just draws the badge at `labelAnchor`.
 */
function badgeAnchor(
  center: Point,
  labelWidth: number,
  orientation: GitOrientation,
  side: GitLabelSide,
): Point {
  const badgeW = labelWidth + LABEL_BADGE_PAD * 2;
  if (orientation === "horizontal") {
    // Centered on the square's x; below (right) or above (left) on y.
    const x = center.x - badgeW / 2;
    const y =
      side === "left"
        ? center.y - NODE_HALF - LABEL_GAP - BADGE_H
        : center.y + NODE_HALF + LABEL_GAP;
    return { x, y };
  }
  // vertical: centered on the square's y; right (after) or left (before) on x.
  const x =
    side === "left"
      ? center.x - NODE_HALF - LABEL_GAP - badgeW
      : center.x + NODE_HALF + LABEL_GAP;
  const y = center.y - BADGE_H / 2;
  return { x, y };
}

/**
 * Lay out a commit DAG into positioned nodes and SVG edge paths.
 */
export function layoutGit(
  input: CommitGraph,
  options?: LayoutOptions,
): PositionedGraph {
  const laneWidth = options?.laneWidth ?? DEFAULTS.laneWidth;
  const rowHeight = options?.rowHeight ?? DEFAULTS.rowHeight;
  const padding = options?.padding ?? DEFAULTS.padding;
  const edgeStyle = options?.edgeStyle ?? "elbow45";
  const orientation: GitOrientation = options?.orientation ?? "vertical";
  const labelSide: GitLabelSide = options?.labelSide ?? "right";
  const horizontal = orientation === "horizontal";

  const ordered = orderCommits(input.commits);
  const { laneOf, laneCount } = assignLanes(ordered);

  const nodeById = new Map<CommitId, PositionedNode>();
  const nodes: PositionedNode[] = ordered.map((commit, row) => {
    const lane = laneOf.get(commit.id) ?? 0;
    // The "commit axis" advances with `row` (time); the "lane axis" with `lane`
    // (branch column). Vertical → commit axis is y, lane axis is x. Horizontal
    // swaps them so commits flow left→right and lanes stack as rows.
    const commitPos = padding + row * rowHeight;
    const lanePos = padding + lane * laneWidth;
    const x = horizontal ? commitPos : lanePos;
    const y = horizontal ? lanePos : commitPos;
    const node: PositionedNode = {
      id: commit.id,
      lane,
      x,
      y,
      color: laneColorKey(lane),
    };
    if (commit.branch !== undefined) node.branch = commit.branch;
    if (commit.author !== undefined) node.author = commit.author;
    if (commit.hash !== undefined) node.hash = commit.hash;
    if (commit.message !== undefined) {
      node.message = commit.message;
      // The rendered label badge reads "<hash> <message>" (uppercase, JOYCO
      // style — wider than authored case). Plus the author trails it. Measure
      // the full uppercased label text so the width reserved (and the badge)
      // never crops. Author adds a separate trailing run.
      const hashPart = commit.hash ? `${commit.hash} ` : "";
      const authorPart = commit.author ? `  ${commit.author}` : "";
      const full = `${hashPart}${commit.message}${authorPart}`.toUpperCase();
      node.labelWidth = measureLabel(full);
      node.labelAnchor = badgeAnchor(node, node.labelWidth, orientation, labelSide);
    }
    nodeById.set(commit.id, node);
    return node;
  });

  // Normalize the leading edge. A badge on the "left" side (vertical) or
  // "above" (horizontal) extends past the node-center grid into negative
  // coordinates; reserve room for it by shifting all geometry so the leftmost /
  // topmost badge corner sits at `padding`. We only normalize the axis the
  // badge is *offset* along (x for vertical, y for horizontal); the centered
  // axis keeps the node-center grid origin (`center at padding`), preserving
  // the long-standing vertical/right output exactly. Edges are built AFTER this
  // shift (from translated centers) so their baked path strings stay correct.
  let leading = Infinity;
  for (const node of nodes) {
    if (node.labelAnchor === undefined || node.labelWidth === undefined) continue;
    leading = Math.min(leading, horizontal ? node.labelAnchor.y : node.labelAnchor.x);
  }
  const shift = Number.isFinite(leading) && leading < padding ? padding - leading : 0;
  if (shift !== 0) {
    for (const node of nodes) {
      if (horizontal) node.y += shift;
      else node.x += shift;
      if (node.labelAnchor !== undefined) {
        if (horizontal) node.labelAnchor.y += shift;
        else node.labelAnchor.x += shift;
      }
    }
  }

  const edges: PositionedEdge[] = [];
  for (const commit of ordered) {
    const from = nodeById.get(commit.id);
    if (!from) continue;
    for (let p = 0; p < commit.parents.length; p++) {
      const parentId = commit.parents[p] as CommitId;
      const to = nodeById.get(parentId);
      if (!to) continue; // parent not in graph (shallow boundary) → no edge
      const path = edgePath(from, to, edgeStyle);
      // Edge kind from DAG structure:
      //  - a non-first parent of a multi-parent commit is a merge-in;
      //  - any other lane-changing edge (a line diverging from its parent's
      //    column) is a branch-out;
      //  - a same-lane edge is a normal mainline step.
      let kind: EdgeKind;
      if (commit.parents.length > 1 && p > 0) {
        kind = "merge";
      } else if (from.lane !== to.lane) {
        kind = "branch";
      } else {
        kind = "normal";
      }
      edges.push({
        from: commit.id,
        to: parentId,
        path,
        kind,
        color: from.color,
      });
    }
  }

  // Bounds. Geometry is already normalized so the min corner sits at `padding`;
  // here we find the max corner over every square + badge rect. The furthest
  // edge is usually a commit LABEL badge (its full padded width/height), not a
  // bare square — so reserve the badge rect on whatever side it was placed.
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    maxX = Math.max(maxX, node.x + NODE_HALF);
    maxY = Math.max(maxY, node.y + NODE_HALF);
    if (node.labelAnchor !== undefined && node.labelWidth !== undefined) {
      const badgeW = node.labelWidth + LABEL_BADGE_PAD * 2;
      maxX = Math.max(maxX, node.labelAnchor.x + badgeW);
      maxY = Math.max(maxY, node.labelAnchor.y + BADGE_H);
    }
  }
  const width = Number.isFinite(maxX) ? maxX + padding : padding * 2;
  const height = Number.isFinite(maxY) ? maxY + padding : padding * 2;

  return { nodes, edges, width, height, laneCount };
}
