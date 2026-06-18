/**
 * rama core entry (".") — FROZEN public API.
 *
 * Re-exports the pure, deterministic layout engine (`layout`) and the
 * glyph-table-backed text measurer (`measure`) behind their frozen signatures.
 * No DOM, canvas, or `window` anywhere in this path — it runs unchanged in Node.
 */

export type {
  CommitId,
  Commit,
  CommitGraph,
  Point,
  PositionedNode,
  PositionedEdge,
  EdgeKind,
  PositionedGraph,
  LayoutOptions,
  FontSpec,
} from "./types.js";

export { layout } from "./layout.js";
export { measure } from "./measure.js";
