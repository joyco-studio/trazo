/**
 * rama core entry (".") — FROZEN public API.
 *
 * Implementations are intentionally absent in this contract commit: the
 * functions below carry their final signatures and throw until Track A lands
 * the real engine behind them. Importers type-check against these signatures
 * today and get the real behavior with no API change later.
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

import type {
  CommitGraph,
  PositionedGraph,
  LayoutOptions,
  FontSpec,
} from "./types.js";

/**
 * Lay out a commit DAG into positioned nodes and SVG edge paths.
 *
 * Pure and deterministic: equal `input` (and `options`) always returns an
 * equal `PositionedGraph`. Runs in Node — no DOM, canvas, or `window`.
 *
 * @param input   the commit DAG (commits + optional refs)
 * @param options optional spacing overrides
 */
export declare function layout(
  input: CommitGraph,
  options?: LayoutOptions,
): PositionedGraph;

/**
 * Measure the rendered pixel width of `text` in `font`, by summing per-glyph
 * advances from the engine's bundled table for that font. Identical on server
 * and client. Never touches a canvas; unknown glyphs use the table's average
 * advance.
 *
 * @param text the string to measure
 * @param font the font family + size to measure against
 */
export declare function measure(text: string, font: FontSpec): number;
