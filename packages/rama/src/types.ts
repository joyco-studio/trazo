/**
 * rama — public contract (FROZEN).
 *
 * These types are the seam between the layout engine (Track A) and any renderer
 * or app (Track B). Both build against this file; the implementation lives
 * behind it. Changing a type here is a breaking change to both tracks.
 *
 * Hard invariants baked into this contract:
 *  - The core (`layout`, `measure`) is pure TypeScript: no DOM, no canvas, no
 *    `window`. It must run unchanged in Node so the same graph renders
 *    identically on the server and the client. That is why text width is a
 *    pure function over a bundled glyph table (`measure`) and never a canvas
 *    measurement.
 *  - `layout` is deterministic: equal `CommitGraph` input (same commits, same
 *    order) always yields an equal `PositionedGraph`.
 */

// ──────────────────────────────────────────────────────────────────────────
// Input — a commit DAG
// ──────────────────────────────────────────────────────────────────────────

/** Stable identifier for a commit (e.g. a sha, or any unique string). */
export type CommitId = string;

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
// Output — a positioned graph
// ──────────────────────────────────────────────────────────────────────────

/** A 2D point in the layout's coordinate space (SVG user units, y grows down). */
export interface Point {
  x: number;
  y: number;
}

/**
 * A laid-out commit node. `lane` is the integer column index (0-based) the node
 * was assigned to; `x`/`y` are its resolved pixel-space center. `color` is a
 * lane-derived token *key* (not a literal color) so renderers can map it onto
 * theme tokens — keeping color decisions in the renderer, not the engine.
 */
export interface PositionedNode {
  id: CommitId;
  lane: number;
  x: number;
  y: number;
  /** Token key for the lane's color, e.g. "lane-0" → chart-1, etc. */
  color: string;
  branch?: string;
  message?: string;
  /**
   * Measured pixel width of `message` (via `measure`), if a message was
   * present. Renderers use this to size labels without re-measuring. Width is
   * for the default label font baked into the engine's glyph table.
   */
  labelWidth?: number;
}

/**
 * A laid-out edge between two commits, expressed as a ready-to-use SVG path
 * `d` string (so the core owns the curve geometry, not the renderer). `from`
 * is the child node, `to` is the parent. `kind` distinguishes a normal edge,
 * a branch-out, and a merge-in so renderers can style them differently.
 */
export interface PositionedEdge {
  from: CommitId;
  to: CommitId;
  /** SVG path data for the edge, in the same coordinate space as nodes. */
  path: string;
  kind: EdgeKind;
  /** Token key for the edge color (follows the source lane). */
  color: string;
}

export type EdgeKind = "normal" | "branch" | "merge";

/**
 * The complete layout result. `width`/`height` bound all geometry so a
 * renderer can set the `<svg>` viewBox without scanning nodes. `laneCount` is
 * the number of columns used.
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
 * Tunable spacing for `layout`. All optional; the engine supplies defaults.
 * Kept in the contract so an app can request denser/looser graphs without the
 * renderer recomputing geometry.
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
