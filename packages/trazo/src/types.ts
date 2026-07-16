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
  /**
   * Free-form legend lines drawn beside the graph (e.g. "S = squash of
   * elvira/checkout"). Not tied to any commit — a caption for the whole chart.
   */
  notes?: GitNote[];
  /**
   * Labeled brackets over a contiguous run of commits (e.g. "Elvira's commits"
   * spanning e1–e2). Purely annotational: groups don't affect lane assignment.
   */
  commitGroups?: CommitGroup[];
}

/** A free-form git legend line (chart caption, not attached to a commit). */
export interface GitNote {
  text: string;
}

/**
 * A labeled bracket spanning a contiguous range of commits, by id. `from`/`to`
 * are inclusive commit ids in source order; the layout draws a bracket along
 * the commit axis covering that run and places `label` beside it.
 */
export interface CommitGroup {
  label: string;
  from: CommitId;
  to: CommitId;
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
  | "secondary"
  | "ghost"
  | "muted"
  | "neutral"
  | "success"
  | "warning"
  | "error"
  | "info";

/**
 * Every accepted role keyword, in one place so the flow/block/sequence DSL
 * parsers and any editor autocomplete never drift from the type union.
 */
export const SEMANTIC_ROLES: readonly SemanticRole[] = [
  "primary",
  "secondary",
  "ghost",
  "muted",
  "neutral",
  "success",
  "warning",
  "error",
  "info",
];

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
   *  - "end"   → a single arrowhead at `to` (the default; a directed `from → to`).
   *  - "start" → a single arrowhead at `from` (a reversed arrow: the edge still
   *    flows `from → to` for layout, but the head points back at the source —
   *    e.g. a "based on" / child→parent relation drawn `parent ← child`).
   *  - "none"  → a plain connector line with no head (an undirected association).
   *  - "both"  → arrowheads at both ends (a bidirectional / two-way relation).
   * Absent is treated as "end" so existing directed edges are unchanged.
   */
  arrow?: ArrowEnds;
}

/** Which ends of an edge carry an arrowhead. */
export type ArrowEnds = "none" | "end" | "start" | "both";

/** Which side of its target a flow annotation (`note`) sits on. */
export type NoteSide = "above" | "below" | "left" | "right";

/**
 * A free-floating annotation bound to an existing flow node — a margin note with
 * a leader arrow pointing at the target's near face. Unlike a {@link FlowNode},
 * a note is EXCLUDED from ranking: it never receives a rank, never generates a
 * dummy chain, and can never change which rank a real node lands in. The layout
 * places it in the gutter on `side` of the target after the main layout resolves,
 * centered on the target's cross-axis so its leader is a straight perpendicular
 * arrow (see {@link PositionedNode.kind} and the leader {@link PositionedEdge}).
 * A note that would spill off-canvas shifts the whole graph to stay in frame
 * (a pure translation that keeps it aligned), so real-node coordinates are
 * preserved only when no such shift is needed.
 */
export interface FlowNote {
  /** Id of the {@link FlowNode} this note hangs off (declared anywhere in the graph). */
  target: NodeId;
  /** Which side of the target the note sits on (and the face its leader points at). */
  side: NoteSide;
  /** Annotation text — same quoting/`<br/>`/inline-`code` rules as a node label. */
  label: string;
  /**
   * Optional semantic role for the note chip. Absent → `neutral`. The leader line
   * is always the neutral accent color regardless (a plain connector, not tinted
   * by the target's or note's role).
   */
  role?: SemanticRole;
}

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
  /**
   * Free-floating annotations, each bound to a node via {@link FlowNote.target}.
   * Excluded from ranking entirely — a note never moves a real node. The layout
   * emits each as a {@link PositionedNode} flagged `kind: "note"` plus a leader
   * {@link PositionedEdge}. A note whose target isn't a real node is dropped
   * (same forgiving policy as an edge to an unknown node).
   */
  notes?: FlowNote[];
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
  /**
   * Flow: discriminator marking a positioned entry as an ANNOTATION (a `note`)
   * rather than a ranked graph node. Absent → a normal node. A `"note"` entry
   * carries the same `shape`/`w`/`h`/`label`/`role` fields as a box node (so it
   * sizes and renders as a filled chip) but was placed in the gutter relative to
   * its target, outside the rank flow; the renderer draws it under
   * `data-slot="annotation"`. Its leader is a separate `PositionedEdge`.
   */
  kind?: "note";
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
   * Flow: measured pixel height of `label` (`lines × labelLineHeight`). >1 line
   * for a multi-line edge label (`\n`/`<br>`); the renderer stacks the lines and
   * sizes the badge via `badgeHeight`, and the layout reserves the same height.
   */
  labelHeight?: number;
  /**
   * Which ends of the edge carry an arrowhead (flow + sequence). Absent → the
   * renderer draws no head (git edges). `layoutFlow` emits "end" by default and
   * `layoutSequence` emits "end" on every message, so directed edges render an
   * arrowhead; "start" draws one at the source end (a reversed arrow), "both"
   * draws one at each end, "none" a plain line.
   */
  arrowHead?: ArrowEnds;
  /**
   * Render the edge as a dashed line. Used for async sequence messages
   * (`-->>`). Flow/git edges leave it unset (solid).
   */
  dashed?: boolean;
}

export type EdgeKind = "normal" | "branch" | "merge" | "flow" | "message" | "note";

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
  /**
   * Git branch-lane labels (mermaid-style `main` / `feature-x` tags at each
   * lane's head). Only present when the layout assigned one lane per branch.
   */
  laneLabels?: LaneLabel[];
  /** Git free-form legend lines, positioned below the graph. */
  gitNotes?: PositionedNote[];
  /** Git commit-range group brackets, positioned along the commit axis. */
  commitBrackets?: CommitBracket[];
}

/**
 * A positioned git legend line: `(x,y)` is the text anchor (left-aligned). Lines
 * stack below the graph in source order.
 */
export interface PositionedNote {
  text: string;
  x: number;
  y: number;
}

/**
 * A positioned commit-range bracket: `(x1,y1)`→`(x2,y2)` is the bracket's span
 * along the commit axis (a horizontal run in horizontal charts, vertical in
 * vertical). `(labelX,labelY)` anchors the group label; `tick` is the small
 * perpendicular length of the bracket's end caps.
 */
export interface CommitBracket {
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  labelX: number;
  labelY: number;
  tick: number;
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

/**
 * A git branch-lane label: the branch name drawn at the head of its dedicated
 * lane (like mermaid's `main` / `feature-x` tags), so a multi-branch graph is
 * legible without reading every commit badge. `(x,y)` is the label's anchor at
 * the lane's outer end (top in vertical, left in horizontal). `lane` and
 * `color` match the lane's commits so the label picks up the lane's tint.
 * Only emitted when the layout assigned one lane per branch (branch names known).
 */
export interface LaneLabel {
  branch: string;
  lane: number;
  x: number;
  y: number;
  color: string;
  /**
   * Text anchor at `(x,y)`: "middle" for a vertical chart (tag centered above
   * its column), "start" for a horizontal chart (tag left-aligned in the left
   * gutter). The renderer reads this instead of knowing the orientation.
   */
  align: "middle" | "start";
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
  /**
   * Casing applied to every label as measured and drawn. Default "uppercase"
   * (the JOYCO look). Maps from a theme's `textCase` knob via `themeGitOptions`.
   */
  textCase?: LabelCase;
}

/**
 * How label text is cased when measured and drawn. "uppercase" is the JOYCO
 * default (the engine measures the uppercased string so boxes reserve the right
 * width); "none" leaves text exactly as authored. Inline `code` runs are always
 * exempt — code is case-sensitive.
 */
export type LabelCase = "uppercase" | "none";

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
 *  - "elbow45": straight, then a sharp 45° diagonal, then straight (default —
 *    the theme vocabulary calls this lanes mode "angular").
 *  - "orthogonal": straight, then a 90° right-angle elbow, then straight.
 *  - "rounded": orthogonal geometry with every corner arced (quadratic curve).
 *  - "bezier": one smooth cubic curve through the waypoints (Catmull-Rom).
 * In every style an edge always LEAVES and ENTERS a node perpendicular to the
 * node's face (a short straight stub) before any turn.
 */
export type EdgeStyle = "elbow45" | "orthogonal" | "rounded" | "bezier";

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
  /**
   * Gap (px) between a `note` annotation's near face and its target's near face
   * (and between stacked notes on the same side). Default 24.
   */
  calloutGap?: number;
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
  /**
   * Air gap (px) between an edge's endpoints (line end / arrow tip) and the
   * node face it connects to. 0 (default) = flush against the border; the
   * theme's "lane gap" knob maps here for flow diagrams.
   */
  edgeGap?: number;
  /** Edge connector style. Default "elbow45". */
  edgeStyle?: EdgeStyle;
  /**
   * Casing applied to every label as measured and drawn. Default "uppercase"
   * (the JOYCO look). Maps from a theme's `textCase` knob via `themeFlowOptions`.
   */
  textCase?: LabelCase;
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
