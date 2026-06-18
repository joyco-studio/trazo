/**
 * rama-stub — a LOCAL, deterministic stand-in for the real `rama` package.
 *
 * SWAP AT INTEGRATION
 * ───────────────────
 * This file re-implements *just enough* of rama's FROZEN contract
 * (`packages/rama/src/types.ts` + `packages/rama/src/index.ts`) for mirador to
 * develop against while Track A builds the real engine. The type names and
 * shapes here mirror the frozen contract EXACTLY, so the real package is a
 * drop-in replacement.
 *
 * To integrate the real rama, do TWO things:
 *   1. `pnpm add rama` in apps/mirador.
 *   2. Replace every `from "@/lib/rama-stub"` import with `from "rama"` (types
 *      + `layout`) and `from "rama/react"` (the `<Graph>` component, which lives
 *      in `@/components/graph.tsx` here). Search the repo for
 *      `// SWAP AT INTEGRATION` to find each call site.
 *
 * Hard invariants this stub honors (same as the real contract):
 *   - PURE: no DOM, no canvas, no `window`. Runs unchanged in Node so the
 *     server and client produce identical layouts.
 *   - DETERMINISTIC: equal `CommitGraph` input → equal `PositionedGraph`.
 */

// ──────────────────────────────────────────────────────────────────────────
// Input contract — mirrors packages/rama/src/types.ts
// ──────────────────────────────────────────────────────────────────────────

export type CommitId = string;

export interface Commit {
  id: CommitId;
  parents: CommitId[];
  branch?: string;
  message?: string;
}

export interface CommitGraph {
  commits: Commit[];
  refs?: Record<string, CommitId>;
}

// ──────────────────────────────────────────────────────────────────────────
// Output contract — mirrors packages/rama/src/types.ts
// ──────────────────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface PositionedNode {
  id: CommitId;
  lane: number;
  x: number;
  y: number;
  /** Token key for the lane's color, e.g. "lane-0". */
  color: string;
  branch?: string;
  message?: string;
  labelWidth?: number;
}

export type EdgeKind = "normal" | "branch" | "merge";

export interface PositionedEdge {
  from: CommitId;
  to: CommitId;
  /** SVG path data, same coordinate space as nodes. */
  path: string;
  kind: EdgeKind;
  color: string;
}

export interface PositionedGraph {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
  laneCount: number;
}

export interface LayoutOptions {
  laneWidth?: number;
  rowHeight?: number;
  nodeRadius?: number;
  padding?: number;
}

export interface FontSpec {
  family: string;
  size: number;
}

// ──────────────────────────────────────────────────────────────────────────
// measure — pure glyph-advance approximation (no canvas)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Approximate the pixel width of `text` for the given font. The real engine
 * sums per-glyph advances from a bundled table; this stub uses a single average
 * advance ratio so it stays pure and deterministic. Good enough to size labels.
 */
export function measure(text: string, font: FontSpec): number {
  const AVERAGE_ADVANCE_RATIO = 0.55;
  return Math.round(text.length * font.size * AVERAGE_ADVANCE_RATIO);
}

// ──────────────────────────────────────────────────────────────────────────
// layout — deterministic lane assignment + grid placement + edge geometry
// ──────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  laneWidth: 34,
  rowHeight: 56,
  nodeRadius: 7,
  padding: 28,
  labelFont: { family: "PublicSans", size: 13 } satisfies FontSpec,
  labelGap: 16,
} as const;

/**
 * Lay out a commit DAG into positioned nodes and SVG edge paths.
 *
 * Strategy (simple but deterministic):
 *  - Walk commits in input order (the DSL emits them oldest-first). Each row is
 *    one commit; row index drives `y`.
 *  - Assign each commit a lane. A commit reuses its mainline parent's lane when
 *    that lane is still "owned" by the same branch; a branch-out grabs the next
 *    free lane. Lanes are released when a merge folds a branch back in.
 *  - Edges connect a child to each parent with an SVG path: straight when on the
 *    same lane, a smooth cubic curve when crossing lanes (branch/merge).
 */
export function layout(
  input: CommitGraph,
  options?: LayoutOptions,
): PositionedGraph {
  const laneWidth = options?.laneWidth ?? DEFAULTS.laneWidth;
  const rowHeight = options?.rowHeight ?? DEFAULTS.rowHeight;
  const nodeRadius = options?.nodeRadius ?? DEFAULTS.nodeRadius;
  const padding = options?.padding ?? DEFAULTS.padding;

  const commits = input.commits;
  const indexById = new Map<CommitId, number>();
  commits.forEach((commit, index) => indexById.set(commit.id, index));

  // Lane bookkeeping: which branch name currently "owns" each lane column.
  const laneOwner: (string | null)[] = [];
  const laneByCommit = new Map<CommitId, number>();
  const laneByBranch = new Map<string, number>();

  function firstFreeLane(): number {
    const free = laneOwner.findIndex((owner) => owner === null);
    if (free !== -1) return free;
    laneOwner.push(null);
    return laneOwner.length - 1;
  }

  function claimLane(lane: number, branch: string | null) {
    laneOwner[lane] = branch;
  }

  let laneCount = 0;

  for (const commit of commits) {
    const branch = commit.branch ?? null;
    let lane: number;

    if (branch && laneByBranch.has(branch)) {
      // Keep an existing branch on its stable lane.
      lane = laneByBranch.get(branch)!;
    } else {
      const mainlineParent = commit.parents[0];
      const mainlineLane =
        mainlineParent !== undefined
          ? laneByCommit.get(mainlineParent)
          : undefined;

      if (
        mainlineLane !== undefined &&
        laneOwner[mainlineLane] === (branch ?? laneOwner[mainlineLane])
      ) {
        // Continue along the mainline parent's lane.
        lane = mainlineLane;
      } else if (mainlineLane !== undefined && branch === null) {
        lane = mainlineLane;
      } else {
        // Branch-out (or root): take the next free column.
        lane = firstFreeLane();
      }
    }

    claimLane(lane, branch);
    if (branch) laneByBranch.set(branch, lane);
    laneByCommit.set(commit.id, lane);
    laneCount = Math.max(laneCount, lane + 1);

    // A merge folds its non-mainline parents' lanes back into the pool.
    if (commit.parents.length > 1) {
      for (let p = 1; p < commit.parents.length; p++) {
        const mergedLane = laneByCommit.get(commit.parents[p]);
        if (mergedLane !== undefined && mergedLane !== lane) {
          laneOwner[mergedLane] = null;
        }
      }
    }
  }

  const xForLane = (lane: number) => padding + nodeRadius + lane * laneWidth;
  const yForRow = (row: number) => padding + nodeRadius + row * rowHeight;

  const nodes: PositionedNode[] = commits.map((commit, row) => {
    const lane = laneByCommit.get(commit.id)!;
    const node: PositionedNode = {
      id: commit.id,
      lane,
      x: xForLane(lane),
      y: yForRow(row),
      color: `lane-${lane}`,
      branch: commit.branch,
      message: commit.message,
    };
    if (commit.message) {
      node.labelWidth = measure(commit.message, DEFAULTS.labelFont);
    }
    return node;
  });

  const nodeById = new Map<CommitId, PositionedNode>();
  nodes.forEach((node) => nodeById.set(node.id, node));

  const edges: PositionedEdge[] = [];
  for (const commit of commits) {
    const child = nodeById.get(commit.id)!;
    commit.parents.forEach((parentId, parentIndex) => {
      const parent = nodeById.get(parentId);
      if (!parent) return; // tolerate dangling parent refs

      const isMerge = parentIndex > 0;
      const kind: EdgeKind =
        child.lane === parent.lane
          ? "normal"
          : isMerge
            ? "merge"
            : "branch";

      // Edge color follows the source (child) lane, except a merge-in which we
      // colour from the lane being merged so the curve reads as "coming from".
      const color = isMerge ? `lane-${parent.lane}` : child.color;

      edges.push({
        from: child.id,
        to: parent.id,
        path: edgePath(child, parent, rowHeight),
        kind,
        color,
      });
    });
  }

  const maxLabelRight = nodes.reduce((max, node) => {
    if (!node.labelWidth) return max;
    const right = node.x + nodeRadius + DEFAULTS.labelGap + node.labelWidth;
    return Math.max(max, right);
  }, 0);

  const width = Math.max(
    maxLabelRight + padding,
    xForLane(laneCount - 1) + nodeRadius + padding,
  );
  const height = yForRow(commits.length - 1) + nodeRadius + padding;

  return { nodes, edges, width, height, laneCount: Math.max(laneCount, 1) };
}

/**
 * SVG `d` for an edge between child (top) and parent (lower row, larger y).
 * Same lane → vertical line. Different lanes → smooth cubic that drops to the
 * destination column at the midpoint, giving the classic git-graph curve.
 */
function edgePath(
  child: PositionedNode,
  parent: PositionedNode,
  rowHeight: number,
): string {
  if (child.x === parent.x) {
    return `M ${child.x} ${child.y} L ${parent.x} ${parent.y}`;
  }
  const controlOffset = rowHeight * 0.5;
  return [
    `M ${child.x} ${child.y}`,
    `C ${child.x} ${child.y + controlOffset}`,
    `${parent.x} ${parent.y - controlOffset}`,
    `${parent.x} ${parent.y}`,
  ].join(" ");
}
