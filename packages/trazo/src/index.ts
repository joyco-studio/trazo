/**
 * trazo core entry (".") — public API.
 *
 * Re-exports the pure, deterministic layout engines and the glyph-table-backed
 * text measurer behind their frozen signatures. No DOM, canvas, or `window`
 * anywhere in this path — it runs unchanged in Node.
 *
 *  - `layoutGit`  — git commit DAG → positioned lane graph.
 *  - `layoutFlow` — generic directed flow graph → positioned Sugiyama layout.
 *  - `layout`     — thin dispatcher: routes a `FlowGraph` (kind === "flow") to
 *                   `layoutFlow`, anything else (a `CommitGraph`) to `layoutGit`,
 *                   so existing `layout(commitGraph)` callers are unchanged.
 */

import type {
  CommitGraph,
  FlowGraph,
  FlowLayoutOptions,
  LayoutOptions,
  PositionedGraph,
} from "./types.js";
import { layoutGit } from "./layout-git.js";
import { layoutFlow } from "./layout-flow.js";

export type {
  NodeId,
  CommitId,
  Commit,
  CommitGraph,
  NodeShape,
  SemanticRole,
  FlowDirection,
  FlowNode,
  FlowEdge,
  FlowGraph,
  Point,
  PositionedNode,
  PositionedEdge,
  EdgeKind,
  EdgeStyle,
  PositionedGraph,
  LayoutOptions,
  GitLayoutOptions,
  FlowLayoutOptions,
  FontSpec,
} from "./types.js";

export { layoutGit } from "./layout-git.js";
export { layoutFlow } from "./layout-flow.js";
export { measure } from "./measure.js";

/**
 * Dispatch to the correct layout engine by input shape. A `FlowGraph` carries
 * `kind: "flow"`; a `CommitGraph` does not (it has `commits`). Overloaded so
 * callers keep precise option types per branch.
 */
export function layout(
  input: FlowGraph,
  options?: FlowLayoutOptions,
): PositionedGraph;
export function layout(
  input: CommitGraph,
  options?: LayoutOptions,
): PositionedGraph;
export function layout(
  input: FlowGraph | CommitGraph,
  options?: FlowLayoutOptions | LayoutOptions,
): PositionedGraph {
  if ((input as FlowGraph).kind === "flow") {
    return layoutFlow(input as FlowGraph, options as FlowLayoutOptions);
  }
  return layoutGit(input as CommitGraph, options as LayoutOptions);
}
