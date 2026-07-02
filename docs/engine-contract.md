# Engine contract (`trazo`)

The public API is `packages/trazo/src/types.ts` + `src/index.ts` + `src/react/`.
Treat any signature change as breaking for every consumer.

## Entry points

```ts
import { layout, layoutGit, layoutFlow, measure } from "@joycostudio/trazo";
import { Graph } from "@joycostudio/trazo/react"; // optional — React is a peer dep

layoutGit(input: CommitGraph, options?: LayoutOptions): PositionedGraph
layoutFlow(input: FlowGraph,   options?: FlowLayoutOptions): PositionedGraph
layout(input: CommitGraph | FlowGraph, options?): PositionedGraph  // dispatcher
measure(text: string, font: FontSpec): number
```

`layout()` discriminates on `input.kind === "flow"` → `layoutFlow`, otherwise
(`CommitGraph` has no `kind`) → `layoutGit`. Existing `layout(commitGraph)`
callers keep working.

## Input — git

```ts
interface Commit {
  id: CommitId;            // unique string
  parents: CommitId[];     // mainline first; [] = root; 2+ = merge
  branch?: string;         // ref/branch hint (keeps a branch on a stable lane)
  message?: string;        // commit subject → drives label sizing
  author?: string;         // rendered as a secondary (dim) label
  hash?: string;           // short hash, rendered mono before the subject
}
interface CommitGraph {
  commits: Commit[];
  refs?: Record<string, CommitId>;  // ref name → commit id (e.g. { main: "a1" })
}
```

## Input — flow

```ts
type NodeShape    = "dot" | "box" | "stadium" | "diamond" | "cylinder";
type SemanticRole = "primary" | "success" | "error" | "warning" | "streamed" | "neutral";
type FlowDirection = "TD" | "LR";

interface FlowNode { id: NodeId; label?: string; shape?: NodeShape; role?: SemanticRole; }
interface FlowEdge {
  from: NodeId; to: NodeId; label?: string;
  colored?: boolean;       // false (default) → neutral accent; true → source node's role color
}
interface FlowGraph { kind: "flow"; nodes: FlowNode[]; edges: FlowEdge[]; }
```

There are **5 node shapes**. `dot` is the git marker (rendered as a square — see
[rendering-and-brand.md](./rendering-and-brand.md)); `box` is the flow default.
There is **no "sliced-corner" node shape** — sliced corners are only the git
*label badge* treatment.

**Self-loops (`A --> A`) are first-class**: they skip the rank/order pipeline
and route as a wrap-around corridor beside the node (forward face → cross-end
corridor → cross-end face). The packing reserves `nodeGap` of cross-axis space
per loop (`Vertex.loopPad`) so corridors never collide with rank siblings;
multiple loops on one node nest at `nodeGap` intervals. Their labels sit on the
corridor and are excluded from sibling label leveling.

## Output — `PositionedGraph` (both layouts produce this)

```ts
interface PositionedNode {
  id; x; y;                // x/y is the CENTER
  color: string;           // TOKEN KEY, not a literal: "lane-<n>" (git) or "role-<role>" (flow)
  lane?: number;           // git column; absent for flow
  branch?; message?; author?; hash?;   // git label parts
  labelAnchor?: Point;     // git: top-left of the label badge (engine-placed per orientation/labelSide)
  shape?; role?; w?; h?; label?;       // flow shape + size + centered label
  labelWidth?: number;     // measured width (incl. uppercase tracking) for sizing
}
interface PositionedEdge {
  from; to;
  path: string;            // ready-to-use SVG `d` string (engine owns the geometry)
  kind: "normal" | "branch" | "merge" | "flow";
  color: string;           // TOKEN KEY: "lane-<n>" / "role-<role>" / "accent"
  label?; labelPoint?: Point; labelWidth?;  // flow edge labels
}
interface PositionedGraph {
  nodes; edges;
  width; height;           // bound ALL geometry incl. labels (set the viewBox from these)
  laneCount;               // git: columns. flow: layer/rank count.
}
```

## Layout options

```ts
type EdgeStyle = "elbow45" | "orthogonal";   // default "elbow45"

interface LayoutOptions {        // git
  laneWidth?; rowHeight?; nodeRadius?; padding?;
  maxLabelWidth?: number;        // ellipsis-truncate the message so the badge caps here
  edgeStyle?: EdgeStyle;
  orientation?: "vertical" | "horizontal";   // default "vertical"
  labelSide?: "left" | "right";              // default "right"
}
interface FlowLayoutOptions {    // flow
  direction?: FlowDirection;     // default "TD"
  layerGap?; nodeGap?; padding?; minNodeWidth?; nodeHeight?; labelPadX?;
  maxNodeWidth?: number;         // word-wrap labels so boxes cap near this px
  edgeStyle?: EdgeStyle;
}
```

## Invariants (never break these)

1. **Pure TS.** No DOM, no canvas, no `window`, no `fetch`/`fs` in `layout*`,
   `geometry`, `measure`. The engine runs in Node.
2. **Deterministic.** Equal input (same nodes/commits, same order) → deeply equal
   `PositionedGraph`. No `Math.random`, no `Date`, no reliance on hash-map
   iteration order — every tie-break is a fixed function of input array index.
3. **`<Graph>` is a pure function of props.** No hooks, no effects, no event
   handlers, no browser globals → renders identically as a Server Component and
   when hydrated. (See [ssr-and-determinism.md](./ssr-and-determinism.md).)
4. **`measure` reads a bundled glyph table, never a canvas.** Identical widths in
   Node and the browser. Unknown glyphs fall back to a defined average advance.
5. **The engine emits token keys, not colors.** `"lane-N"`, `"role-X"`,
   `"accent"`. The renderer maps them. Keeps color decisions in one place and
   the core environment-agnostic.

## The glyph table

`src/fonts/public-sans.ts` is **generated** from the real Public Sans TTF by
`scripts/gen-glyphs.ts` (uses `opentype.js`, a **dev dependency only** — it must
never reach the shipped runtime). `measure` does pure arithmetic:
`size / unitsPerEm * Σ advance(glyph)`. Re-generate with
`pnpm --filter trazo gen:glyphs`.
