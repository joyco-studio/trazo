/**
 * Pure geometry helpers shared by the git and flow layouts.
 *
 * No DOM, no canvas, no `window` — every function here is a pure function of
 * its arguments (and the bundled glyph table via `measure`), so it runs
 * unchanged in Node and produces byte-identical output on server and client.
 *
 * Responsibilities:
 *  - size flow node shapes from their label (box/stadium/diamond/cylinder),
 *  - compute boundary anchor points per direction + shape,
 *  - build SVG edge `d` strings (straight line for collinear points, cubic
 *    Bézier between layers) from an ordered point list.
 */

import type { EdgeStyle, FlowDirection, NodeShape, Point, SemanticRole } from "./types.js";
import { measure } from "./measure.js";

/**
 * Token key for a node/edge color from its semantic role (`"role-<role>"`). The
 * single source of truth for the role color-key format, shared by every flow-
 * style layout so they never diverge. The renderer maps the key onto a theme var.
 */
export function roleColorKey(role: SemanticRole): string {
  return `role-${role}`;
}

/** Font used to size flow-node labels — Public Sans, hub body size. */
const LABEL_FONT = { family: "PublicSans", size: 13 } as const;

/**
 * Letter-spacing applied to rendered labels (em). The renderer sets
 * `letter-spacing: 0.02em` for the uppercase JOYCO look, but `measure` only
 * sums glyph advances — so labels would overflow their box/badge by ~tracking
 * per character. `measureLabel` re-adds that tracking to the reserved width.
 */
const LABEL_TRACKING_EM = 0.02;

/**
 * Measure a rendered label's width INCLUDING the uppercase letter-spacing the
 * renderer applies. `text` should already be the displayed (uppercased) string.
 *
 * CSS `letter-spacing` adds its tracking AFTER every glyph (including the last),
 * so an N-glyph run gains N — not N-1 — units of tracking on top of the summed
 * advances. Reserving only (N-1) left the badge ~one glyph of tracking short and
 * the final characters overflowed its right edge. Width = advances + N*tracking.
 * Pure + deterministic.
 */
export function measureLabel(text: string, size = LABEL_FONT.size): number {
  const base = measure(text, { family: LABEL_FONT.family, size });
  const chars = [...text].length;
  const tracking = chars > 0 ? chars * LABEL_TRACKING_EM * size : 0;
  return base + tracking;
}

/**
 * Line height (px) for a stacked multi-line label at a given font size. The 1.3
 * factor is the leading the renderer applies between `<tspan>` rows; shared so
 * the engine reserves exactly the height the renderer draws.
 */
export const LABEL_LINE_HEIGHT_EM = 1.3;
export function labelLineHeight(size = LABEL_FONT.size): number {
  return size * LABEL_LINE_HEIGHT_EM;
}

/**
 * Split a label into its display lines on hard `\n` breaks. A single-line label
 * returns a one-element array. Empty/undefined → `[]`. The renderer stacks these
 * as `<tspan>` rows and the engine sizes shapes to the widest line × line count.
 */
export function labelLines(label: string | undefined): string[] {
  if (label === undefined || label === "") return [];
  return label.split("\n");
}

/**
 * Measured size of a (possibly multi-line) label, rendered uppercase with
 * tracking: width = the widest line's `measureLabel`, height = `lineCount` rows
 * at `labelLineHeight`. Pure. Single source of truth for node/group/note sizing.
 */
export function measureMultiline(
  label: string | undefined,
  size = LABEL_FONT.size,
): { width: number; height: number; lines: number } {
  const lines = labelLines(label);
  if (lines.length === 0) return { width: 0, height: 0, lines: 0 };
  let width = 0;
  for (const line of lines) {
    const w = measureLabel(line.toUpperCase(), size);
    if (w > width) width = w;
  }
  return { width, height: lines.length * labelLineHeight(size), lines: lines.length };
}

/**
 * Git node visual geometry, shared between the layout (for bounds math) and the
 * renderer (for drawing), so the computed `width` always reserves room for the
 * label and nothing is cropped. Git commit markers are SQUARES of side
 * `2*NODE_HALF`; the label sits to their right, `LABEL_GAP` px after the edge.
 */
export const NODE_HALF = 5;
export const LABEL_GAP = 10;
/** Horizontal padding inside the sliced-corner git label badge (each side). */
export const LABEL_BADGE_PAD = 10;
/**
 * Extra padding (px) on the RIGHT of the git label badge, on top of
 * `LABEL_BADGE_PAD`. The badge's bottom-right corner is chamfered, so the last
 * characters sit closer to the edge than on the left — this buys them room.
 */
export const LABEL_BADGE_PAD_RIGHT_EXTRA = 8;
/** Height (px) of the sliced-corner git label badge. Shared so the layout can
 * reserve bounds for above/below placement and the renderer draws to match. */
export const BADGE_H = 22;

/**
 * Full width (px) of the git label badge for a measured `labelWidth`: the text
 * advance plus left pad + right pad (right gets the chamfer-clearance extra).
 * Single source of truth so the layout's bounds/anchor math and the renderer's
 * drawn rect never drift.
 */
export function badgeWidth(labelWidth: number): number {
  return labelWidth + LABEL_BADGE_PAD * 2 + LABEL_BADGE_PAD_RIGHT_EXTRA;
}

/**
 * Padding (px) between a subgraph's member nodes and its container box edge.
 * Shared so the layout reserves bounds and the renderer draws to match.
 */
export const GROUP_PAD = 16;
/**
 * Height (px) reserved at the top (TD) / left (LR) of a subgraph box for its
 * title, inside the padded container. Echoes the git badge height.
 */
export const GROUP_TITLE_H = 22;

/**
 * Axis-aligned bounding box of a set of node shape-boxes (each given by its
 * center + full w/h), grown by `pad` on every side. Returns top-left + size.
 * Pure. Used to place a subgraph container around its members.
 */
export function groupBounds(
  members: ReadonlyArray<{ x: number; y: number; w: number; h: number }>,
  pad: number,
): { x: number; y: number; w: number; h: number } | null {
  if (members.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of members) {
    const left = m.x - m.w / 2;
    const right = m.x + m.w / 2;
    const top = m.y - m.h / 2;
    const bottom = m.y + m.h / 2;
    if (left < minX) minX = left;
    if (right > maxX) maxX = right;
    if (top < minY) minY = top;
    if (bottom > maxY) maxY = bottom;
  }
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

/** Defaults for shape sizing; callers may override width/height bases. */
export interface ShapeSizeOptions {
  /** Minimum full width (px) a box-like node may have. */
  minNodeWidth?: number;
  /** Base node height (px) before per-shape cap extents. */
  nodeHeight?: number;
  /** Horizontal padding (px) added around the measured label. */
  labelPadX?: number;
}

const SIZE_DEFAULTS = {
  minNodeWidth: 64,
  nodeHeight: 36,
  labelPadX: 16,
} as const;

/**
 * Size a flow node shape from its label. Returns the full bounding box
 * {w,h} including any per-shape cap extents (stadium caps, cylinder ellipse,
 * diamond point margins). Pure: same label + options → same size.
 */
export function sizeShape(
  shape: NodeShape,
  label: string | undefined,
  options?: ShapeSizeOptions,
): { w: number; h: number } {
  const minNodeWidth = options?.minNodeWidth ?? SIZE_DEFAULTS.minNodeWidth;
  const nodeHeight = options?.nodeHeight ?? SIZE_DEFAULTS.nodeHeight;
  const labelPadX = options?.labelPadX ?? SIZE_DEFAULTS.labelPadX;

  // Labels render UPPERCASE (JOYCO style) with letter-spacing — measure the
  // uppercased text WITH tracking so the shape reserves the right width. A
  // multi-line label (hard `\n` breaks) sizes to its WIDEST line and grows the
  // box height by one line-height per extra line beyond the first.
  const { width: labelWidth, lines } = measureMultiline(label);
  const boxW = Math.max(minNodeWidth, labelWidth + labelPadX * 2);
  const extraLines = lines > 1 ? lines - 1 : 0;
  const h = nodeHeight + extraLines * labelLineHeight();

  switch (shape) {
    case "box":
      return { w: boxW, h };
    case "stadium":
      // Stadium adds a semicircular cap on each end (~h/2 horizontal each).
      return { w: boxW + h, h };
    case "diamond":
      // A diamond's label box must fit inside the inscribed rhombus, so the
      // bounding box is roughly twice the label box in both axes.
      return { w: boxW * 2, h: h * 2 };
    case "cylinder":
      // Cylinder adds top + bottom ellipse caps → extra vertical extent.
      return { w: boxW, h: h + 12 };
    case "dot":
    default:
      // A dot has no label box; give it a small square footprint.
      return { w: h, h };
  }
}

/**
 * Which boundary face of a node an edge attaches to, relative to rank flow.
 * "forward" faces higher ranks (TD: bottom, LR: right); "backward" faces lower
 * ranks (TD: top, LR: left); "cross-*" are the in-plane sides, used for
 * same-rank and back-edge routing so a loop edge enters/leaves on the side
 * rather than colliding head-on with the forward/backward traffic.
 */
export type AnchorFace =
  | "forward"
  | "backward"
  | "cross-start"
  | "cross-end";

/**
 * Anchor point on a node's bounding-box boundary for the given face. Cylinder
 * caps are inset slightly on the forward/backward (flow) faces so the edge meets
 * the flat, not the ellipse. Pure function of its inputs.
 */
export function faceAnchor(
  center: Point,
  w: number,
  h: number,
  shape: NodeShape,
  direction: FlowDirection,
  face: AnchorFace,
): Point {
  const capInset = shape === "cylinder" ? 6 : 0;
  if (direction === "TD") {
    switch (face) {
      case "forward":
        return { x: center.x, y: center.y + h / 2 - capInset };
      case "backward":
        return { x: center.x, y: center.y - h / 2 + capInset };
      case "cross-start":
        return { x: center.x - w / 2, y: center.y };
      case "cross-end":
        return { x: center.x + w / 2, y: center.y };
    }
  }
  // LR
  switch (face) {
    case "forward":
      return { x: center.x + w / 2, y: center.y };
    case "backward":
      return { x: center.x - w / 2, y: center.y };
    case "cross-start":
      return { x: center.x, y: center.y - h / 2 };
    case "cross-end":
      return { x: center.x, y: center.y + h / 2 };
  }
}

/**
 * Exit anchor on the boundary of a node's bounding box, toward the next layer.
 * TD: bottom-center; LR: right-center. Diamond exits from its bottom/right
 * point (same center coords — the box already encodes the point extent).
 * Cylinder exits from the bottom cap flat (slightly inset).
 */
export function exitAnchor(
  center: Point,
  w: number,
  h: number,
  shape: NodeShape,
  direction: FlowDirection,
): Point {
  return faceAnchor(center, w, h, shape, direction, "forward");
}

/**
 * Entry anchor on the boundary of a node's bounding box, from the prior layer.
 * TD: top-center; LR: left-center. Cylinder enters at the top cap flat.
 */
export function entryAnchor(
  center: Point,
  w: number,
  h: number,
  shape: NodeShape,
  direction: FlowDirection,
): Point {
  return faceAnchor(center, w, h, shape, direction, "backward");
}

/**
 * Build the turn segment(s) from `from` to `to` (the `L` commands after an
 * already-emitted point), in the chosen edge style:
 *  - "elbow45": straight along the dominant axis, then a sharp 45° diagonal to
 *    shift across, then straight — no easing.
 *  - "orthogonal": straight along the dominant axis to the target's cross
 *    coordinate, then a 90° turn straight into the target.
 * Collinear points → a single `L`.
 */
/**
 * The intermediate knee point(s) the turn between `from` and `to` inserts, in
 * the chosen style (excluding `from`, including up to `to`'s predecessor knee
 * but NOT `to` itself). Collinear points insert no knee. This is the geometry
 * `turn()` draws — kept here so both the `d` string and the label placement
 * reason over the SAME expanded polyline.
 */
function turnKnees(from: Point, to: Point, style: EdgeStyle): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 || dy === 0) return [];

  if (style === "orthogonal") {
    if (Math.abs(dy) >= Math.abs(dx)) return [{ x: from.x, y: to.y }];
    return [{ x: to.x, y: from.y }];
  }

  // elbow45
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (ady >= adx) {
    const kneeY = to.y - sy * adx;
    return [{ x: from.x, y: kneeY }];
  }
  const kneeX = to.x - sx * ady;
  return [{ x: kneeX, y: from.y }];
}

/**
 * Expand a waypoint list to the FULL rendered polyline, inserting each turn's
 * knee points. The result is exactly the sequence of vertices the SVG path
 * visits (start, every knee, every waypoint, end). Pure.
 */
export function expandPath(points: Point[], style: EdgeStyle = "elbow45"): Point[] {
  if (points.length <= 1) return [...points];
  const out: Point[] = [points[0] as Point];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1] as Point;
    const cur = points[i] as Point;
    out.push(...turnKnees(prev, cur, style), cur);
  }
  return out;
}

/**
 * Build the SVG `d` path for an edge through an ordered list of points (the
 * exit anchor, any dummy/waypoints, and the entry anchor), using the chosen
 * turn style between consecutive points. Callers add perpendicular stub points
 * at each end (see {@link withStubs}) so edges always leave/enter a node face
 * at 90° before any turn. Pure function of its inputs.
 */
export function pathThrough(points: Point[], style: EdgeStyle = "elbow45"): string {
  const expanded = expandPath(points, style);
  if (expanded.length === 0) return "";
  const first = expanded[0] as Point;
  if (expanded.length === 1) return `M ${first.x} ${first.y}`;

  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < expanded.length; i++) {
    const p = expanded[i] as Point;
    d += ` L ${p.x} ${p.y}`;
  }
  return d;
}

/**
 * Two-point convenience: an edge straight from `from` to `to` in the given
 * style (used by the git layout, whose lanes are a regular grid). Perpendicular
 * stubs are unnecessary for git dots/squares (they are points), so this is a
 * direct two-point {@link pathThrough}.
 */
export function curveBetween(
  from: Point,
  to: Point,
  style: EdgeStyle = "elbow45",
): string {
  return pathThrough([from, to], style);
}


/**
 * Where to place an edge's label along its RENDERED polyline. An elbow45 edge
 * runs: a perpendicular stub, possibly a straight run along one axis, the 45°
 * DIAGONAL that actually carries the edge across to the target's column, then a
 * final stub. The label belongs on that diagonal — centered on its midpoint —
 * so it reads as riding the line rather than sitting on a flat stub/run beside
 * it. Pick the longest diagonal segment (|Δx| ≈ |Δy|, both non-zero); if there
 * is none (e.g. orthogonal style, or a perfectly straight edge) fall back to the
 * arc-length midpoint. `direction` is unused for the diagonal pick but kept for
 * symmetry with the other anchor helpers. Pure.
 */
export function edgeLabelPoint(
  points: Point[],
  style: EdgeStyle,
  direction: FlowDirection,
): Point {
  void direction;
  const poly = expandPath(points, style);
  if (poly.length <= 1) return polylineMidpoint(poly);

  let best: { mid: Point; len: number } | null = null;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1] as Point;
    const b = poly[i] as Point;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    // A 45° diagonal: both axes move, by (near-)equal amounts.
    const isDiagonal = dx > 0.5 && dy > 0.5 && Math.abs(dx - dy) <= 0.5;
    if (!isDiagonal) continue;
    const len = Math.hypot(dx, dy);
    if (best === null || len > best.len) {
      best = { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, len };
    }
  }
  // No diagonal run (orthogonal/straight edge): center along the arc.
  if (best === null) return polylineMidpoint(poly);
  return best.mid;
}

/** Midpoint of an ordered polyline (by segment-length-weighted arc midpoint). */
export function polylineMidpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0] as Point;

  let total = 0;
  const segLengths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLengths.push(len);
    total += len;
  }

  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const len = segLengths[i] as number;
    if (acc + len >= half) {
      const a = points[i] as Point;
      const b = points[i + 1] as Point;
      const t = len === 0 ? 0 : (half - acc) / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    acc += len;
  }
  return points[points.length - 1] as Point;
}
