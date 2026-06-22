/**
 * Deterministic layout for a block-grid wireframe (Mermaid's `block-beta`).
 *
 * Pure TypeScript: no DOM, no canvas, no `window`. Equal `BlockGraph` (same
 * columns/cells, same order) always produces a deeply-equal `PositionedGraph`.
 *
 * A block grid is pure spatial placement, NOT a graph — there are no edges.
 * Cells flow left→right in input order and wrap to the next row; a cell with
 * `span = k` occupies k columns (wrapping early if it doesn't fit the remaining
 * columns). Columns are uniform width (the widest cell label, floored at
 * `minCellWidth`) so spans line up. The result reuses `PositionedNode` boxes so
 * the existing `<Graph>` renderer draws each cell with no new primitive.
 */

import type {
  BlockGraph,
  BlockLayoutOptions,
  PositionedGraph,
  PositionedNode,
} from "./types.js";
import { measureMultiline } from "./geometry.js";

const DEFAULTS = {
  cellGap: 12,
  rowHeight: 48,
  minCellWidth: 96,
  padding: 24,
} as const;

export function layoutBlock(
  graph: BlockGraph,
  options?: BlockLayoutOptions,
): PositionedGraph {
  const cellGap = options?.cellGap ?? DEFAULTS.cellGap;
  const rowHeight = options?.rowHeight ?? DEFAULTS.rowHeight;
  const minCellWidth = options?.minCellWidth ?? DEFAULTS.minCellWidth;
  const padding = options?.padding ?? DEFAULTS.padding;
  // Guard non-finite/zero column counts so geometry never becomes NaN.
  const rawColumns = Math.floor(graph.columns);
  const columns = Number.isFinite(rawColumns) ? Math.max(1, rawColumns) : 1;

  // A cell's effective span is clamped to the grid width — used BOTH for sizing
  // the columns and for placement, so the two never disagree.
  const spanOf = (cellSpan: number | undefined): number =>
    Math.min(columns, Math.max(1, Math.floor(cellSpan ?? 1)));

  // Uniform column width = widest measured single-column label, floored.
  const LABEL_CELL_PAD = 24;
  let colW = minCellWidth;
  for (const cell of graph.cells) {
    const span = spanOf(cell.span);
    // A spanning cell's label is shared across its (clamped) columns; attribute
    // its width to one column so one wide label doesn't inflate every column.
    const perColumn = measureMultiline(cell.label).width / span + LABEL_CELL_PAD;
    if (perColumn > colW) colW = perColumn;
  }

  // Walk cells, tracking (row, col); wrap when a cell's span won't fit.
  const xOfCol = (col: number): number => padding + col * (colW + cellGap);
  const yOfRow = (row: number): number => padding + row * (rowHeight + cellGap);

  let col = 0;
  let row = 0;
  const nodes: PositionedNode[] = graph.cells.map((cell) => {
    const span = spanOf(cell.span);
    if (col + span > columns) {
      // Doesn't fit on this row → wrap to the next.
      col = 0;
      row += 1;
    }
    const w = span * colW + (span - 1) * cellGap;
    const x = xOfCol(col) + w / 2;
    const y = yOfRow(row) + rowHeight / 2;
    const role = cell.role ?? "neutral";
    const node: PositionedNode = {
      id: cell.id,
      x,
      y,
      color: `role-${role}`,
      shape: cell.shape ?? "box",
      role,
      w,
      h: rowHeight,
    };
    if (cell.label !== undefined) {
      node.label = cell.label;
      node.labelWidth = measureMultiline(cell.label).width;
    }
    col += span;
    return node;
  });

  const rowsUsed = row + 1;
  const width = padding * 2 + columns * colW + (columns - 1) * cellGap;
  const height = padding * 2 + rowsUsed * rowHeight + (rowsUsed - 1) * cellGap;

  return {
    nodes,
    edges: [],
    width,
    height,
    laneCount: columns,
  };
}
