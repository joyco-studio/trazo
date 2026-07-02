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
  /** Optional author name (rendered as a secondary label). */
  author?: string;
  /** Optional short hash (rendered mono before the subject). */
  hash?: string;
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
  | "success"
  | "error"
  | "warning"
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
  /**
   * Optional cluster membership — the id of a group declared in
   * {@link FlowGraph.groups}. Grouped nodes are kept spatially contiguous by the
   * layout and enclosed in a labeled container box (a "subgraph"). A node may
   * belong to at most one group (first declaration wins in the DSL).
   */
  group?: NodeId;
}

/** A declared cluster (subgraph) — an id and an optional display title. */
export interface FlowGroup {
  id: NodeId;
  label?: string;
}

/** A directed edge in a flow graph, from one node to another. */
export interface FlowEdge {
  from: NodeId;
  to: NodeId;
  label?: string;
  /**
   * When true, the edge takes the color of its source node's role; otherwise
   * it renders in the neutral accent color (the default). Lets a chart mix
   * colored and neutral connectors.
   */
  colored?: boolean;
  /**
   * Which ends get an arrowhead:
   *  - "end"  → a single arrowhead at `to` (the default; a directed `from → to`).
   *  - "none" → a plain connector line with no head (an undirected association).
   *  - "both" → arrowheads at both ends (a bidirectional / two-way relation).
   * Absent is treated as "end" so existing directed edges are unchanged.
   */
  arrow?: ArrowEnds;
}

/** Which ends of an edge carry an arrowhead. */
export type ArrowEnds = "none" | "end" | "both";

/** The full input for a flow layout. `kind` discriminates from `CommitGraph`. */
export interface FlowGraph {
  kind: "flow";
  nodes: FlowNode[];
  edges: FlowEdge[];
  /**
   * Layout direction parsed from the DSL (`flow TD` / `flow LR`). When present,
   * `layoutFlow` uses it as the default so callers don't need to repeat it in
   * `FlowLayoutOptions`. An explicit `options.direction` always wins.
   */
  direction?: FlowDirection;
  /**
   * Declared clusters (subgraphs). A node opts into one via {@link FlowNode.group}.
   * The layout keeps each group's members contiguous and emits a
   * {@link PositionedGroup} bounding box per group with ≥1 positioned member.
   */
  groups?: FlowGroup[];
}

// ──────────────────────────────────────────────────────────────────────────
// Input — a sequence diagram
// ──────────────────────────────────────────────────────────────────────────

/** A participant (actor) in a sequence diagram — one vertical lifeline. */
export interface SequenceParticipant {
  id: NodeId;
  label?: string;
  role?: SemanticRole;
}

/**
 * Kind of a sequence message:
 *  - "sync"  → a solid arrow (synchronous call `->>`).
 *  - "async" → a dashed arrow (asynchronous return/signal `-->>`).
 *  - "self"  → a self-message (from === to) drawn as a small loop.
 */
export type MessageKind = "sync" | "async" | "self";

/** A single ordered message between two participants. */
export interface SequenceMessage {
  from: NodeId;
  to: NodeId;
  label?: string;
  kind: MessageKind;
  /**
   * Global event order across messages AND notes (0-based). The parser stamps it
   * from the source line order so the layout can interleave messages and notes
   * on one timeline. Absent → the layout falls back to the message's array order
   * (notes then sort after all messages).
   */
  seq?: number;
}

/** A note spanning one or more participants at a point in the sequence. */
export interface SequenceNote {
  /** Participant ids the note covers (its box spans from the first to the last). */
  over: NodeId[];
  text: string;
  /** Global event order across messages AND notes (0-based); see {@link SequenceMessage.seq}. */
  seq?: number;
}

/** The full input for a sequence layout. `kind` discriminates from the others. */
export interface SequenceGraph {
  kind: "sequence";
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
  notes?: SequenceNote[];
}

// ──────────────────────────────────────────────────────────────────────────
// Input — a block-grid wireframe (block-beta)
// ──────────────────────────────────────────────────────────────────────────

/**
 * A single cell in a block-grid layout. `span` is how many columns the cell
 * occupies (default 1). Cells flow left→right and wrap to the next row.
 */
export interface BlockCell {
  id: NodeId;
  label?: string;
  shape?: NodeShape;
  role?: SemanticRole;
  span?: number;
}

/**
 * The full input for a block-grid layout — a 2-D wireframe of boxes (no edges),
 * used for layout/composition diagrams (Mermaid's `block-beta`). `kind`
 * discriminates from the other graph inputs.
 */
export interface BlockGraph {
  kind: "block";
  columns: number;
  cells: BlockCell[];
}

/** Tunable spacing for the block layout (`layoutBlock`). All optional. */
export interface BlockLayoutOptions {
  /** Gap (px) between cells, both axes. */
  cellGap?: number;
  /** Row height (px). */
  rowHeight?: number;
  /** Minimum width (px) a single column may have. */
  minCellWidth?: number;
  /** Outer padding around the whole grid (px). */
  padding?: number;
}

/** Error reported by `parseGit` or `parseFlow` when the source is invalid. */
export interface ParseError {
  /** 1-based line number where the error occurred. */
  line: number;
  /** Human-readable description of the problem. */
  message: string;
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
  /** Token key for the node color, e.g. "lane-0" (git) or "role-success" (flow). */
  color: string;
  branch?: string;
  message?: string;
  /** Git: optional author name (secondary label). */
  author?: string;
  /** Git: optional short hash (mono prefix on the label). */
  hash?: string;
  /**
   * Measured pixel width of `message`/`label` (via `measure`), if present.
   * Renderers use this to size labels without re-measuring. Width is for the
   * default label font baked into the engine's glyph table.
   */
  labelWidth?: number;
  /**
   * Git: top-left corner of the label badge, in node coordinate space. The
   * engine computes it from the chart orientation + `labelSide` so the renderer
   * just draws the badge there (never re-deriving placement). Absent → the
   * renderer falls back to the legacy right-of-square placement.
   */
  labelAnchor?: Point;
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
  /**
   * Which ends of the edge carry an arrowhead (flow + sequence). Absent → the
   * renderer draws no head (git edges). `layoutFlow` emits "end" by default and
   * `layoutSequence` emits "end" on every message, so directed edges render an
   * arrowhead; "both" draws one at each end, "none" a plain line.
   */
  arrowHead?: ArrowEnds;
  /**
   * Render the edge as a dashed line. Used for async sequence messages
   * (`-->>`). Flow/git edges leave it unset (solid).
   */
  dashed?: boolean;
}

export type EdgeKind = "normal" | "branch" | "merge" | "flow" | "message";

/**
 * A laid-out cluster container (subgraph box) or sequence note box. Unlike a
 * node, `x`/`y` are the TOP-LEFT corner (mirroring an SVG `<rect>`), not the
 * center. `variant` distinguishes a flow subgraph container ("group") from a
 * sequence note box ("note") so the renderer can style each differently.
 */
export interface PositionedGroup {
  id: NodeId;
  label?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Measured pixel width of `label` (via `measure`), if present. */
  labelWidth?: number;
  /** Container kind. Default "group" (flow subgraph); "note" for sequence notes. */
  variant?: "group" | "note";
}

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
  /**
   * Flow subgraph containers / sequence note boxes, when the input declared any.
   * Absent for plain graphs with no groups/notes (renderers can skip the slot).
   */
  groups?: PositionedGroup[];
  /** Sequence-diagram lifelines (vertical dashed lines under each participant). */
  lifelines?: Lifeline[];
}

/**
 * A sequence-diagram lifeline: the vertical line dropping from a participant's
 * header down through the messages. `(x1,y1)` is the top (under the header),
 * `(x2,y2)` the bottom (past the last message row).
 */
export interface Lifeline {
  id: NodeId;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
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
  /**
   * Truncate the commit MESSAGE with a trailing "…" so the whole badge text
   * (hash + message + author) never measures wider than this (px) — what real
   * git UIs do to long subjects. Hash and author are never cut. Default: no
   * truncation.
   */
  maxLabelWidth?: number;
  /** Edge connector style. Default "elbow45". */
  edgeStyle?: EdgeStyle;
  /**
   * Chart orientation. "vertical" (default) flows commits top→bottom with lanes
   * as columns; "horizontal" flows commits left→right with lanes as rows.
   */
  orientation?: GitOrientation;
  /**
   * Which side of the commit square the label badge sits on.
   *  - vertical chart:   "right" (default) | "left" of the square.
   *  - horizontal chart: "right" → below the square (default), "left" → above.
   * In short: "right" trails the cross-axis, "left" leads it.
   */
  labelSide?: GitLabelSide;
}

/** Git chart orientation: commits flow top→bottom or left→right. */
export type GitOrientation = "vertical" | "horizontal";

/**
 * Side of the commit square the label badge sits on, along the chart's
 * cross-axis. Vertical → right/left; horizontal → below/above (see
 * {@link LayoutOptions.labelSide}).
 */
export type GitLabelSide = "left" | "right";

/**
 * How edges turn between nodes:
 *  - "elbow45": straight, then a sharp 45° diagonal, then straight (default).
 *  - "orthogonal": straight, then a 90° right-angle elbow, then straight.
 * In both styles an edge always LEAVES and ENTERS a node perpendicular to the
 * node's face (a short straight stub) before any turn.
 */
export type EdgeStyle = "elbow45" | "orthogonal";

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
  /**
   * Word-wrap node labels so a box never grows past ~this width (px) — the
   * mermaid-style guard against one long label producing an extremely wide
   * node. Hard `\n` breaks are preserved; a single word longer than the budget
   * stays whole, so the box can still exceed this in that edge case.
   * Default: no wrapping.
   */
  maxNodeWidth?: number;
  /** Edge connector style. Default "elbow45". */
  edgeStyle?: EdgeStyle;
}

/**
 * Tunable spacing for the sequence layout (`layoutSequence`). All optional; the
 * engine supplies defaults.
 */
export interface SequenceLayoutOptions {
  /** Horizontal distance between participant lifeline columns (px). */
  columnGap?: number;
  /** Vertical distance between successive message rows (px). */
  rowGap?: number;
  /** Participant header box height (px). */
  headerHeight?: number;
  /** Outer padding around the whole diagram (px). */
  padding?: number;
  /** Edge connector style for messages. Default "orthogonal". */
  edgeStyle?: EdgeStyle;
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
