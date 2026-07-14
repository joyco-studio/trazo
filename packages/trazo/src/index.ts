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
 *  - `parseGit`   — parse the git DSL string into a `CommitGraph`.
 *  - `parseFlow`  — parse the flow DSL string into a `FlowGraph`.
 *  - `git`        — tagged template literal: parse git DSL, throw on error.
 *  - `flow`       — tagged template literal: parse flow DSL, throw on error.
 */

import type {
  BlockGraph,
  BlockLayoutOptions,
  CommitGraph,
  FlowGraph,
  FlowLayoutOptions,
  LayoutOptions,
  PositionedGraph,
  SequenceGraph,
  SequenceLayoutOptions,
} from "./types.js";
import { layoutGit } from "./layout-git.js";
import { layoutFlow } from "./layout-flow.js";
import { layoutSequence } from "./layout-sequence.js";
import { layoutBlock } from "./layout-block.js";
import { parseGit } from "./parse-git.js";
import { parseFlow } from "./parse-flow.js";
import { parseSequence } from "./parse-sequence.js";
import { parseBlock } from "./parse-block.js";

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
  ArrowEnds,
  FlowGroup,
  FlowGraph,
  ParseError,
  Point,
  PositionedNode,
  PositionedEdge,
  PositionedGroup,
  Lifeline,
  EdgeKind,
  EdgeStyle,
  LabelCase,
  PositionedGraph,
  LayoutOptions,
  GitLayoutOptions,
  GitOrientation,
  GitLabelSide,
  FlowLayoutOptions,
  SequenceGraph,
  SequenceParticipant,
  SequenceMessage,
  SequenceNote,
  MessageKind,
  SequenceLayoutOptions,
  BlockGraph,
  BlockCell,
  BlockLayoutOptions,
  FontSpec,
} from "./types.js";

export { SEMANTIC_ROLES } from "./types.js";
export {
  themed,
  themeFlowOptions,
  themeGitOptions,
  themeEdgeStyle,
  resolveThemePaint,
  contrastForeground,
  perceptualLightness,
  joycoTheme,
} from "./theme.js";
export type {
  TrazoTheme,
  TrazoTokenSlot,
  TrazoColorSlot,
  TrazoSurfaceSlot,
  ThemePadding,
  ThemeRoundness,
  ThemeLanesMode,
  ThemeLaneStyle,
  ThemeBorder,
  ThemeBackground,
  ThemeTextCase,
  ResolvedThemePaint,
} from "./theme.js";
export { layoutGit } from "./layout-git.js";
export { layoutFlow } from "./layout-flow.js";
export { layoutSequence } from "./layout-sequence.js";
export { layoutBlock } from "./layout-block.js";
export { measure } from "./measure.js";
export { parseGit } from "./parse-git.js";
export { parseFlow } from "./parse-flow.js";
export { parseSequence } from "./parse-sequence.js";
export { parseBlock } from "./parse-block.js";
export type { GitParseResult } from "./parse-git.js";
export type { FlowParseResult } from "./parse-flow.js";
export type { SequenceParseResult } from "./parse-sequence.js";
export type { BlockParseResult } from "./parse-block.js";

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
  input: SequenceGraph,
  options?: SequenceLayoutOptions,
): PositionedGraph;
export function layout(
  input: BlockGraph,
  options?: BlockLayoutOptions,
): PositionedGraph;
export function layout(
  input: CommitGraph,
  options?: LayoutOptions,
): PositionedGraph;
export function layout(
  input: FlowGraph | SequenceGraph | BlockGraph | CommitGraph,
  options?: FlowLayoutOptions | SequenceLayoutOptions | BlockLayoutOptions | LayoutOptions,
): PositionedGraph {
  if ((input as FlowGraph).kind === "flow") {
    return layoutFlow(input as FlowGraph, options as FlowLayoutOptions);
  }
  if ((input as SequenceGraph).kind === "sequence") {
    return layoutSequence(input as SequenceGraph, options as SequenceLayoutOptions);
  }
  if ((input as BlockGraph).kind === "block") {
    return layoutBlock(input as BlockGraph, options as BlockLayoutOptions);
  }
  return layoutGit(input as CommitGraph, options as LayoutOptions);
}

function joinTemplate(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce<string>(
    (acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ""),
    "",
  );
}

/**
 * Tagged template literal for the git DSL. Parses inline and throws a
 * descriptive `Error` if the source is invalid. Returns a `CommitGraph` ready
 * to pass to `layoutGit` or `layout`.
 *
 * @example
 * ```ts
 * import { git, layoutGit } from "@joycostudio/trazo";
 *
 * const positioned = layoutGit(git`
 *   commit a1b2c3 (Alice) : initial commit
 *   branch feature
 *   commit (Alice) : add feature
 *   checkout main
 *   merge feature : merge feature
 * `);
 * ```
 */
export function git(strings: TemplateStringsArray, ...values: unknown[]): CommitGraph {
  const source = joinTemplate(strings, values);
  const { graph, error } = parseGit(source);
  if (error) throw new Error(`trazo git DSL line ${error.line}: ${error.message}`);
  return graph;
}

/**
 * Tagged template literal for the flow DSL. Parses inline and throws a
 * descriptive `Error` if the source is invalid. Returns a `FlowGraph` (with
 * `direction` set from the source) ready to pass to `layoutFlow` or `layout`.
 *
 * @example
 * ```ts
 * import { flow, layoutFlow } from "@joycostudio/trazo";
 *
 * const positioned = layoutFlow(flow`
 *   flow LR
 *   A(["Start"]):primary ==> B["Process"]
 *   B --> C(["End"]):success
 * `);
 * ```
 */
export function flow(strings: TemplateStringsArray, ...values: unknown[]): FlowGraph {
  const source = joinTemplate(strings, values);
  const { graph, error } = parseFlow(source);
  if (error) throw new Error(`trazo flow DSL line ${error.line}: ${error.message}`);
  return graph;
}

/**
 * Tagged template literal for the sequence DSL. Parses inline and throws a
 * descriptive `Error` if the source is invalid. Returns a `SequenceGraph` ready
 * to pass to `layoutSequence` or `layout`.
 *
 * @example
 * ```ts
 * import { seq, layoutSequence } from "@joycostudio/trazo";
 *
 * const positioned = layoutSequence(seq`
 *   participant Client
 *   participant Server
 *   Client ->> Server : request
 *   Server -->> Client : response
 * `);
 * ```
 */
export function seq(strings: TemplateStringsArray, ...values: unknown[]): SequenceGraph {
  const source = joinTemplate(strings, values);
  const { graph, error } = parseSequence(source);
  if (error) throw new Error(`trazo sequence DSL line ${error.line}: ${error.message}`);
  return graph;
}

/**
 * Tagged template literal for the block DSL. Parses inline and throws a
 * descriptive `Error` if the source is invalid. Returns a `BlockGraph` ready to
 * pass to `layoutBlock` or `layout`.
 *
 * @example
 * ```ts
 * import { block, layoutBlock } from "@joycostudio/trazo";
 *
 * const positioned = layoutBlock(block`
 *   columns 2
 *   Nav["Navigation"] :2
 *   A["Sidebar"]
 *   B["Content"]
 * `);
 * ```
 */
export function block(strings: TemplateStringsArray, ...values: unknown[]): BlockGraph {
  const source = joinTemplate(strings, values);
  const { graph, error } = parseBlock(source);
  if (error) throw new Error(`trazo block DSL line ${error.line}: ${error.message}`);
  return graph;
}
