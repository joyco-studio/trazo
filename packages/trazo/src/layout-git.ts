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
  CommitBracket,
  CommitGraph,
  CommitId,
  EdgeKind,
  EdgeStyle,
  GitLabelSide,
  GitOrientation,
  LaneLabel,
  LayoutOptions,
  PositionedEdge,
  PositionedGraph,
  PositionedNode,
  PositionedNote,
  Point,
} from "./types.js";
import {
  applyCase,
  curveBetween,
  measureLabel,
  truncateLabel,
  badgeWidth,
  NODE_HALF,
  LABEL_GAP,
  BADGE_H,
  type MainAxis,
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
 * Assign one dedicated lane per branch, keyed by branch name (mermaid style):
 * every commit on branch B lands in B's column for the whole graph, so a
 * multi-branch history is legible at a glance and lanes can be labeled with the
 * branch name. Lanes are ordered by first appearance while walking the commits
 * top-to-bottom (main, then each branch as it first shows up) — a fixed function
 * of input order, so output stays deterministic.
 *
 * Only usable when EVERY commit carries a `branch` (the git DSL always sets it;
 * a raw `CommitGraph` built by a consumer may not). `assignLanes` picks this
 * path when branches are complete and falls back to the compact algorithm
 * otherwise, preserving the engine contract for non-DSL callers.
 */
function assignBranchLanes(ordered: Commit[]): {
  laneOf: Map<CommitId, number>;
  laneCount: number;
  branchOfLane: string[];
} {
  const laneOf = new Map<CommitId, number>();
  const laneForBranch = new Map<string, number>();
  const branchOfLane: string[] = [];

  for (const commit of ordered) {
    const branch = commit.branch as string;
    let lane = laneForBranch.get(branch);
    if (lane === undefined) {
      lane = branchOfLane.length;
      laneForBranch.set(branch, lane);
      branchOfLane.push(branch);
    }
    laneOf.set(commit.id, lane);
  }

  return { laneOf, laneCount: branchOfLane.length, branchOfLane };
}

/**
 * Assign an integer lane to every commit. Prefers one lane per branch (see
 * `assignBranchLanes`) when branch names are complete; otherwise falls back to
 * the compact first-parent-stable walk described at the top of this file.
 */
function assignLanes(ordered: Commit[]): {
  laneOf: Map<CommitId, number>;
  laneCount: number;
  branchOfLane?: string[];
} {
  // Branch-per-lane only when every commit knows its branch (DSL guarantees it).
  if (ordered.length > 0 && ordered.every((c) => c.branch !== undefined)) {
    return assignBranchLanes(ordered);
  }

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
  mainAxis: MainAxis,
): string {
  return curveBetween({ x: from.x, y: from.y }, { x: to.x, y: to.y }, style, mainAxis);
}

/**
 * Top-left corner of the label badge for a placed commit, given the chart
 * orientation and which side the badge sits on. The badge is `badgeWidth(...)`
 * wide and `BADGE_H` tall.
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
  gutterCross: number,
): Point {
  const badgeW = badgeWidth(labelWidth);
  if (orientation === "horizontal") {
    // Centered on the square's x; below (right) or above (left) on y — from
    // the GUTTER (outermost lane row), so badges never sit over lane lines.
    const x = center.x - badgeW / 2;
    const y =
      side === "left"
        ? gutterCross - NODE_HALF - LABEL_GAP - BADGE_H
        : gutterCross + NODE_HALF + LABEL_GAP;
    return { x, y };
  }
  // vertical: centered on the square's y; a shared message column right
  // (after) or left (before) of the OUTERMOST lane — like `git log --graph`,
  // and no badge ever crosses a lane line.
  const x =
    side === "left"
      ? gutterCross - NODE_HALF - LABEL_GAP - badgeW
      : gutterCross + NODE_HALF + LABEL_GAP;
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
  const { laneOf, laneCount, branchOfLane } = assignLanes(ordered);

  // Pre-compute label widths for all commits that have any label content (hash,
  // message, or author). In horizontal mode these widths drive commit spacing so
  // adjacent badges don't overlap. We trim each part: an all-whitespace field is
  // treated as absent so it never produces a badge.
  const precomputedLabelWidths = new Map<CommitId, number>();
  // Message text as drawn — the ellipsis-truncated subject when maxLabelWidth
  // is set. Truncation happens ONCE here; widths and the emitted node.message
  // both use it, so what's measured is exactly what's rendered.
  const displayMessages = new Map<CommitId, string>();
  const maxLabelWidth = options?.maxLabelWidth;
  const textCase = options?.textCase ?? "uppercase";
  for (const commit of ordered) {
    const hash = commit.hash?.trim();
    const message = commit.message?.trim();
    const author = commit.author?.trim();
    if (hash || message || author) {
      const hashPart = hash ? `${hash} ` : "";
      const authorPart = author ? `  ${author}` : "";
      let msgPart = message ?? "";
      if (maxLabelWidth !== undefined && msgPart !== "") {
        // Glyph-table measuring is strictly additive (advances + per-char
        // tracking), so the message budget is exact: total minus the fixed
        // hash/author parts. Hash and author are never cut.
        const fixed = measureLabel(applyCase(`${hashPart}${authorPart}`, textCase));
        msgPart = truncateLabel(msgPart, Math.max(24, maxLabelWidth - fixed), textCase);
      }
      if (message !== undefined) displayMessages.set(commit.id, msgPart);
      precomputedLabelWidths.set(
        commit.id,
        measureLabel(applyCase(`${hashPart}${msgPart}${authorPart}`, textCase)),
      );
    }
  }

  // Compute the commit-axis position for each commit.
  // Vertical: fixed rowHeight spacing is fine — badges sit to the side and don't
  // affect vertical spacing. Horizontal: spread commits apart whenever adjacent
  // badges would otherwise overlap.
  const HORIZONTAL_BADGE_GAP = 8;
  const commitPositions: number[] = [];
  if (horizontal) {
    let pos = padding;
    for (let i = 0; i < ordered.length; i++) {
      commitPositions.push(pos);
      if (i < ordered.length - 1) {
        const idThis = ordered[i]?.id;
        const idNext = ordered[i + 1]?.id;
        const wThis =
          idThis !== undefined && precomputedLabelWidths.has(idThis)
            ? badgeWidth(precomputedLabelWidths.get(idThis)!) / 2
            : 0;
        const wNext =
          idNext !== undefined && precomputedLabelWidths.has(idNext)
            ? badgeWidth(precomputedLabelWidths.get(idNext)!) / 2
            : 0;
        pos += Math.max(rowHeight, wThis + wNext + HORIZONTAL_BADGE_GAP);
      }
    }
  } else {
    for (let i = 0; i < ordered.length; i++) {
      commitPositions.push(padding + i * rowHeight);
    }
  }

  const nodeById = new Map<CommitId, PositionedNode>();
  // Badges anchor off a shared GUTTER at the outermost lane on the label side
  // (`git log --graph` style): trailing side → the last lane; leading side →
  // lane 0 (positions are `padding + lane * laneWidth`).
  const gutterCross =
    labelSide === "left" ? padding : padding + (laneCount - 1) * laneWidth;
  const nodes: PositionedNode[] = ordered.map((commit, row) => {
    const lane = laneOf.get(commit.id) ?? 0;
    // The "commit axis" advances with `row` (time); the "lane axis" with `lane`
    // (branch column). Vertical → commit axis is y, lane axis is x. Horizontal
    // swaps them so commits flow left→right and lanes stack as rows.
    const commitPos = commitPositions[row] ?? padding + row * rowHeight;
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
    // Only attach trimmed, non-empty label parts; empty/whitespace strings
    // would produce blank tspans in the renderer.
    const hash = commit.hash?.trim();
    // Emit the message AS MEASURED — the ellipsis-truncated subject when
    // maxLabelWidth applied (displayMessages), the raw trim otherwise.
    const message = displayMessages.get(commit.id) ?? commit.message?.trim();
    const author = commit.author?.trim();
    if (hash) node.hash = hash;
    if (author) node.author = author;
    if (message) node.message = message;
    // Badge geometry is set whenever any label content exists (not just message).
    const labelW = precomputedLabelWidths.get(commit.id);
    if (labelW !== undefined) {
      node.labelWidth = labelW;
      node.labelAnchor = badgeAnchor(node, labelW, orientation, labelSide, gutterCross);
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

  // In horizontal mode badges are centered on the commit's x, so the leftmost
  // badge's left edge (labelAnchor.x = center.x − badgeW/2) can go negative
  // when the first commit sits near `padding`. Shift all geometry right so no
  // badge is clipped by the viewbox. Edges are built after this block and read
  // the updated node.x values, so their paths stay correct.
  if (horizontal) {
    let leadingX = Infinity;
    for (const node of nodes) {
      if (node.labelAnchor === undefined) continue;
      leadingX = Math.min(leadingX, node.labelAnchor.x);
    }
    const shiftX =
      Number.isFinite(leadingX) && leadingX < padding ? padding - leadingX : 0;
    if (shiftX !== 0) {
      for (const node of nodes) {
        node.x += shiftX;
        if (node.labelAnchor !== undefined) node.labelAnchor.x += shiftX;
      }
    }
  }

  // Branch-lane labels (mermaid-style `main:` / `feature-x:` tags in the left
  // gutter). Only in HORIZONTAL orientation: there lanes are ROWS, so a
  // horizontal branch name reads naturally beside its row (the reference/mermaid
  // look). In vertical orientation lanes are narrow COLUMNS (laneWidth apart) and
  // horizontal names would overlap — the per-lane COLOR already disambiguates, so
  // we skip the text there rather than rotate it (rotated tags were rejected).
  // The band is reserved and the grid pushed inward FIRST, so edge paths (built
  // below from shifted node centers) bake in correctly.
  let laneLabels: LaneLabel[] | undefined;
  if (horizontal && branchOfLane !== undefined && branchOfLane.length > 0) {
    const LANE_LABEL_GAP = LABEL_GAP + NODE_HALF;
    // Left gutter as wide as the widest branch name (+ the trailing colon).
    let band = 0;
    for (const name of branchOfLane) {
      band = Math.max(band, measureLabel(applyCase(`${name}:`, textCase)));
    }
    band += LANE_LABEL_GAP;
    for (const node of nodes) {
      node.x += band;
      if (node.labelAnchor !== undefined) node.labelAnchor.x += band;
    }

    laneLabels = branchOfLane.map((branch, lane) => {
      // Read a node on this lane so the label picks up the same normalization the
      // grid got; fall back to the lane grid position for an (unusual) empty lane.
      const onLane = nodes.find((n) => n.lane === lane);
      const y = onLane ? onLane.y : padding + band + lane * laneWidth;
      return { branch, lane, x: padding, y, color: laneColorKey(lane), align: "start" as const };
    });
  }

  const edges: PositionedEdge[] = [];
  for (const commit of ordered) {
    const from = nodeById.get(commit.id);
    if (!from) continue;
    for (let p = 0; p < commit.parents.length; p++) {
      const parentId = commit.parents[p] as CommitId;
      const to = nodeById.get(parentId);
      if (!to) continue; // parent not in graph (shallow boundary) → no edge
      const path = edgePath(from, to, edgeStyle, horizontal ? "x" : "y");
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
      const badgeW = badgeWidth(node.labelWidth);
      maxX = Math.max(maxX, node.labelAnchor.x + badgeW);
      maxY = Math.max(maxY, node.labelAnchor.y + BADGE_H);
    }
  }
  // Horizontal lane tags sit in the reserved left band (x ≥ padding) and are
  // vertically centered on their row — both already inside the node bounds, so
  // no extra reservation is needed. (Vertical charts emit no lane labels.)

  // Commit-range group brackets ("Elvira's commits" spanning e1–e2). The bracket
  // runs parallel to the COMMIT axis (horizontal chart → a horizontal line under
  // the commits; vertical chart → a vertical line beside them), on the far side
  // from the badges, with a centered label. Purely annotational — placed after
  // the grid is final, and it extends the bounds so nothing is clipped.
  const BRACKET_GAP = 14;
  const BRACKET_TICK = 6;
  const BRACKET_LABEL_GAP = 6;
  let commitBrackets: CommitBracket[] | undefined;
  if (input.commitGroups !== undefined && input.commitGroups.length > 0) {
    commitBrackets = [];
    // Shared baseline so multiple groups under the same commit row sit at ONE
    // level (side by side, like the reference), rather than stacking. Frozen
    // from the pre-bracket bound; bounds extend once, after all brackets.
    const baseline = horizontal ? maxY + BRACKET_GAP : maxX + BRACKET_GAP;
    const labelOffset = BRACKET_TICK + BRACKET_LABEL_GAP;
    let labelExtent = baseline; // furthest the labels reach past the baseline
    // Horizontal: labels are centered UNDER their span and can overlap when two
    // groups sit close. Track each label row's right edge and push a colliding
    // label onto the next row (stacked), so nothing overprints. Vertical labels
    // sit on distinct commit rows already, so they never collide.
    const LABEL_ROW = BADGE_H;
    const LABEL_PAD = 8;
    const rowRightEdge: number[] = [];
    for (const group of input.commitGroups) {
      const range = memberRange(ordered, group.from, group.to);
      const pts = ordered
        .filter((_c, idx) => range.has(idx))
        .map((c) => nodeById.get(c.id))
        .filter((n): n is PositionedNode => n !== undefined);
      if (pts.length === 0) continue;
      if (horizontal) {
        const x1 = Math.min(...pts.map((n) => n.x));
        const x2 = Math.max(...pts.map((n) => n.x));
        const labelW = measureLabel(applyCase(group.label, textCase));
        const centerX = (x1 + x2) / 2;
        const leftEdge = centerX - labelW / 2;
        // First row whose last label ends before this one starts; else a new row.
        let row = rowRightEdge.findIndex((edge) => edge <= leftEdge);
        if (row === -1) {
          row = rowRightEdge.length;
          rowRightEdge.push(0);
        }
        rowRightEdge[row] = centerX + labelW / 2 + LABEL_PAD;
        const labelY = baseline + labelOffset + BADGE_H / 2 + row * LABEL_ROW;
        commitBrackets.push({
          label: group.label,
          x1,
          y1: baseline,
          x2,
          y2: baseline,
          labelX: centerX,
          labelY,
          tick: BRACKET_TICK,
        });
        labelExtent = Math.max(labelExtent, labelY + BADGE_H / 2);
        maxX = Math.max(maxX, centerX + labelW / 2);
      } else {
        const y1 = Math.min(...pts.map((n) => n.y));
        const y2 = Math.max(...pts.map((n) => n.y));
        const labelX = baseline + labelOffset;
        commitBrackets.push({
          label: group.label,
          x1: baseline,
          y1,
          x2: baseline,
          y2,
          labelX,
          labelY: (y1 + y2) / 2,
          tick: BRACKET_TICK,
        });
        labelExtent = Math.max(labelExtent, labelX + measureLabel(applyCase(group.label, textCase)));
      }
    }
    if (horizontal) maxY = Math.max(maxY, labelExtent);
    else maxX = Math.max(maxX, labelExtent);
  }

  // Free-form legend notes ("S = squash of x") stack below the whole graph,
  // left-aligned at `padding`, one row each. They extend the height.
  let gitNotes: PositionedNote[] | undefined;
  if (input.notes !== undefined && input.notes.length > 0) {
    gitNotes = [];
    const NOTE_ROW = BADGE_H;
    let y = (Number.isFinite(maxY) ? maxY : padding) + BRACKET_GAP + NOTE_ROW / 2;
    for (const note of input.notes) {
      gitNotes.push({ text: note.text, x: padding, y });
      maxX = Math.max(maxX, padding + measureLabel(applyCase(note.text, textCase)));
      maxY = Math.max(maxY, y + NOTE_ROW / 2);
      y += NOTE_ROW;
    }
  }

  const width = Number.isFinite(maxX) ? maxX + padding : padding * 2;
  const height = Number.isFinite(maxY) ? maxY + padding : padding * 2;

  const result: PositionedGraph = { nodes, edges, width, height, laneCount };
  if (laneLabels !== undefined) result.laneLabels = laneLabels;
  if (commitBrackets !== undefined && commitBrackets.length > 0) {
    result.commitBrackets = commitBrackets;
  }
  if (gitNotes !== undefined) result.gitNotes = gitNotes;
  return result;
}

/**
 * The set of `ordered` indices covered by a commit-id range [from, to]
 * inclusive. Ranges are interpreted in the layout's top-to-bottom ordered array
 * so the bracket covers a contiguous run regardless of source direction. If
 * either endpoint is missing, returns an empty set (no bracket).
 */
function memberRange(
  ordered: Commit[],
  from: CommitId,
  to: CommitId,
): Set<number> {
  const idxFrom = ordered.findIndex((c) => c.id === from);
  const idxTo = ordered.findIndex((c) => c.id === to);
  if (idxFrom === -1 || idxTo === -1) return new Set();
  const lo = Math.min(idxFrom, idxTo);
  const hi = Math.max(idxFrom, idxTo);
  const out = new Set<number>();
  for (let i = lo; i <= hi; i++) out.add(i);
  return out;
}
