/**
 * trazo — public contract (FROZEN core, additively extended for flow graphs).
 *
 * These types are the seam between the layout engine (Track A) and any renderer
 * or app (Track B). Both build against this file; the implementation lives
 * behind it. Changing an EXISTING type here is a breaking change to both
 * tracks; this file only ever ADDS to the contract so the git renderer stays
 * untouched.
 *
 * Hard invariants baked into this contract:
 *  - The core (`layout`, `layoutGit`, `layoutFlow`, `measure`) is pure
 *    TypeScript: no DOM, no canvas, no `window`. It must run unchanged in Node
 *    so the same graph renders identically on the server and the client. That
 *    is why text width is a pure function over a bundled glyph table (`measure`)
 *    and never a canvas measurement.
 *  - layout is deterministic: equal input (same nodes/commits, same order)
 *    always yields an equal `PositionedGraph`.
 */

// ──────────────────────────────────────────────────────────────────────────
// Generic node identity
// ──────────────────────────────────────────────────────────────────────────

/** Stable identifier for any node in a directed graph (commit or flow node). */
export type NodeId = string;

/** Stable identifier for a commit (e.g. a sha, or any unique string). */
export type CommitId = NodeId;

// ──────────────────────────────────────────────────────────────────────────
// Input — a commit DAG (git)
// ──────────────────────────────────────────────────────────────────────────

/**
 * A single commit in the DAG. Parents are referenced by id:
 *  - 0 parents → a root commit.
 *  - 1 parent  → a normal commit.
 *  - 2+ parents → a merge commit (first parent is the "mainline").
 *
 * `branch` is an optional hint naming the ref/branch this commit belongs to.
 * The engine may use it to keep a branch on a stable lane, but lane assignment
 * must not *require* it — a graph with no branch hints still lays out.
 */
export interface Commit {
  id: CommitId;
  /** Parent commit ids, mainline first. Empty for a root commit. */
  parents: CommitId[];
  /** Optional branch/ref name hint (e.g. "main", "feat/x"). */
  branch?: string;
  /** Optional human label (commit subject) — drives `measure`-based sizing. */
  message?: string;
}

/**
 * The full input graph: a list of commits plus optional named tips (refs
 * pointing at a commit id). Order is significant for determinism — callers
 * should provide commits newest-first (child before parent) or oldest-first
 * consistently; the engine documents and preserves whatever total order it
 * derives, but identical input order guarantees identical output.
 */
export interface CommitGraph {
  commits: Commit[];
  /** Optional ref tips: ref name → commit id (e.g. { main: "a1", HEAD: "a1" }). */
  refs?: Record<string, CommitId>;
}

// ──────────────────────────────────────────────────────────────────────────
// Input — a generic flow graph (flowchart)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Visual shape of a flow node. `dot` is the git default (a small circle);
 * the rest are flowchart primitives sized from their label via `measure`.
 */
export type NodeShape = "dot" | "box" | "stadium" | "diamond" | "cylinder";

/**
 * Semantic role of a flow node — maps to a theme color token in the renderer,
 * so the engine never emits a literal color (same discipline as git lanes).
 */
export type SemanticRole =
  | "primary"
  | "good"
  | "bad"
  | "pending"
  | "streamed"
  | "neutral";

/** Layout flow direction: top-down or left-right. */
export type FlowDirection = "TD" | "LR";

/** A node in a flow graph. `label` drives shape sizing via `measure`. */
export interface FlowNode {
  id: NodeId;
  label?: string;
  shape?: NodeShape;
  role?: SemanticRole;
}

/** A directed edge in a flow graph, from one node to another. */
export interface FlowEdge {
  from: NodeId;
  to: NodeId;
  label?: string;
}

/** The full input for a flow layout. `kind` discriminates from `CommitGraph`. */
export interface FlowGraph {
  kind: "flow";
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ──────────────────────────────────────────────────────────────────────────
// Output — a positioned graph
// ──────────────────────────────────────────────────────────────────────────

/** A 2D point in the layout's coordinate space (SVG user units, y grows down). */
export interface Point {
  x: number;
  y: number;
}

/**
 * A laid-out node (commit or flow). For git, `lane` is the integer column index
 * (0-based) the node was assigned to. For flow, `lane` is absent and `rank`-
 * derived geometry is encoded directly in `x`/`y`. `x`/`y` are the resolved
 * pixel-space CENTER. `color` is a token *key* (not a literal color) so
 * renderers map it onto theme tokens — git emits `"lane-<n>"`, flow emits
 * `"role-<role>"`.
 */
export interface PositionedNode {
  id: CommitId;
  /** Git lane / column index (0-based). Absent for flow nodes. */
  lane?: number;
  x: number;
  y: number;
  /** Token key for the node color, e.g. "lane-0" (git) or "role-good" (flow). */
  color: string;
  branch?: string;
  message?: string;
  /**
   * Measured pixel width of `message`/`label` (via `measure`), if present.
   * Renderers use this to size labels without re-measuring. Width is for the
   * default label font baked into the engine's glyph table.
   */
  labelWidth?: number;
  /** Flow: shape primitive to render. Absent → git dot. */
  shape?: NodeShape;
  /** Flow: semantic role (mirrors the `role-*` color key). */
  role?: SemanticRole;
  /** Flow: full node width (px) for box-like shapes. */
  w?: number;
  /** Flow: full node height (px). */
  h?: number;
  /** Flow: node label text (rendered centered inside the shape). */
  label?: string;
}

/**
 * A laid-out edge between two nodes, expressed as a ready-to-use SVG path
 * `d` string (so the core owns the curve geometry, not the renderer). `from`
 * is the child/source node, `to` is the parent/target. `kind` distinguishes a
 * normal edge, a branch-out, a merge-in, and a generic flow edge so renderers
 * can style them differently.
 */
export interface PositionedEdge {
  from: CommitId;
  to: CommitId;
  /** SVG path data for the edge, in the same coordinate space as nodes. */
  path: string;
  kind: EdgeKind;
  /** Token key for the edge color (git: source lane; flow: source role). */
  color: string;
  /** Flow: optional edge label text. */
  label?: string;
  /** Flow: point at which to anchor the edge label (polyline midpoint). */
  labelPoint?: Point;
  /** Flow: measured pixel width of `label` (via `measure`). */
  labelWidth?: number;
}

export type EdgeKind = "normal" | "branch" | "merge" | "flow";

/**
 * The complete layout result. `width`/`height` bound all geometry so a
 * renderer can set the `<svg>` viewBox without scanning nodes. For git,
 * `laneCount` is the number of columns used; for flow, `laneCount` doubles as
 * the number of layers (ranks) the Sugiyama layering produced.
 */
export interface PositionedGraph {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
  laneCount: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Layout options
// ──────────────────────────────────────────────────────────────────────────

/**
 * Tunable spacing for the git layout (`layoutGit`). All optional; the engine
 * supplies defaults. Kept in the contract so an app can request denser/looser
 * graphs without the renderer recomputing geometry.
 */
export interface LayoutOptions {
  /** Horizontal distance between lane centers (px). */
  laneWidth?: number;
  /** Vertical distance between commit rows (px). */
  rowHeight?: number;
  /** Radius of a commit node dot (px). */
  nodeRadius?: number;
  /** Outer padding around the whole graph (px). */
  padding?: number;
}

/** Alias for {@link LayoutOptions} — the git-specific layout options. */
export type GitLayoutOptions = LayoutOptions;

/**
 * Tunable spacing for the flow layout (`layoutFlow`). All optional; the engine
 * supplies defaults.
 */
export interface FlowLayoutOptions {
  /** Layout direction: "TD" (top-down) or "LR" (left-right). Default "TD". */
  direction?: FlowDirection;
  /** Main-axis gap (px) between successive layers/ranks. */
  layerGap?: number;
  /** Cross-axis gap (px) between sibling nodes within a layer. */
  nodeGap?: number;
  /** Outer padding around the whole graph (px). */
  padding?: number;
  /** Minimum width (px) a sized box-like node may have. */
  minNodeWidth?: number;
  /** Base node height (px) before per-shape cap extents. */
  nodeHeight?: number;
  /** Horizontal padding (px) added around a node's measured label. */
  labelPadX?: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Font metrics
// ──────────────────────────────────────────────────────────────────────────

/**
 * A font the engine can measure against. The engine bundles a glyph-advance
 * table for the JOYCO brand body font (Public Sans); `measure` reads that
 * table so a width is identical in Node and in the browser. There is NO canvas
 * fallback — unknown glyphs use the table's defined average advance.
 */
export interface FontSpec {
  /** Logical font family name. Must match a bundled table (e.g. "PublicSans"). */
  family: string;
  /** Font size in px the advances should be scaled to. */
  size: number;
}
