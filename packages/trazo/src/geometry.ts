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

/**
 * The axis a diagram's flow travels along — TD/vertical charts flow along "y",
 * LR/horizontal ones along "x". Turn geometry (`turnKnees`) needs it so an
 * edge's FINAL approach into a node always runs along the main axis (the
 * cross shift happens near the source), regardless of segment proportions.
 */
export type MainAxis = "x" | "y";

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
 * Greedy word-wrap of a label so no line's rendered width (uppercase, with
 * tracking) exceeds `maxTextWidth` px. Hard `\n` breaks are preserved as
 * paragraph boundaries; a single word wider than the budget stays whole (no
 * hyphenation). Pure and deterministic — glyph-table measuring only.
 */
export function wrapLabel(label: string, maxTextWidth: number): string {
  const out: string[] = [];
  for (const hardLine of label.split("\n")) {
    const words = hardLine.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      out.push(hardLine);
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (line !== "" && measureLabel(candidate.toUpperCase()) > maxTextWidth) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line !== "") out.push(line);
  }
  return out.join("\n");
}

/**
 * Truncate a label with a trailing "…" so its rendered width (uppercase, with
 * tracking) fits `maxTextWidth` px — what real git UIs do to long commit
 * subjects. Returns the text unchanged when it already fits. Pure and
 * deterministic.
 */
export function truncateLabel(text: string, maxTextWidth: number): string {
  if (measureLabel(text.toUpperCase()) <= maxTextWidth) return text;
  const chars = [...text];
  while (chars.length > 0) {
    chars.pop();
    const candidate = `${chars.join("").trimEnd()}…`;
    if (measureLabel(candidate.toUpperCase()) <= maxTextWidth) return candidate;
  }
  return "…";
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
  // The cylinder's cap APEX sits exactly on the bounding box edge at center-x
  // (the curve's midpoint), so main-axis anchors use the plain box edge — an
  // inset would land arrowheads INSIDE the cap.
  void shape;
  if (direction === "TD") {
    switch (face) {
      case "forward":
        return { x: center.x, y: center.y + h / 2 };
      case "backward":
        return { x: center.x, y: center.y - h / 2 };
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
 * Cylinder exits from its bottom cap apex (on the box edge).
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
 * TD: top-center; LR: left-center. Cylinder enters at its top cap apex.
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
function turnKnees(
  from: Point,
  to: Point,
  style: EdgeStyle,
  mainAxis: MainAxis,
): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 || dy === 0) return [];

  // Bezier curves flow directly through the waypoints — no knees.
  if (style === "bezier") return [];

  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const adm = Math.abs(mainAxis === "y" ? dy : dx); // main-axis delta
  const adc = Math.abs(mainAxis === "y" ? dx : dy); // cross-axis delta

  // The turn always happens NEAR THE SOURCE: shift across at the source's
  // main-axis level, then run the main axis cleanly into the target (the
  // mermaid/mock look). Turning near the target reads as a last-second jog.

  // "rounded" is orthogonal geometry with the corners arced at draw time.
  if (style === "orthogonal" || style === "rounded") {
    return [mainAxis === "y" ? { x: to.x, y: from.y } : { x: from.x, y: to.y }];
  }

  // elbow45 — one 45° diagonal carries the cross shift:
  //  - cross-dominant: straight cross-run at the source's main level, then the
  //    diagonal lands directly on `to` (it covers the whole main delta).
  //  - main-dominant: the diagonal comes FIRST (covers the whole cross delta),
  //    then a long straight main-axis run descends into `to`.
  if (adc >= adm) {
    return [
      mainAxis === "y"
        ? { x: to.x - sx * adm, y: from.y }
        : { x: from.x, y: to.y - sy * adm },
    ];
  }
  return [
    mainAxis === "y"
      ? { x: to.x, y: from.y + sy * adc }
      : { x: from.x + sx * adc, y: to.y },
  ];
}

/**
 * Expand a waypoint list to the FULL rendered polyline, inserting each turn's
 * knee points. The result is exactly the sequence of vertices the SVG path
 * visits (start, every knee, every waypoint, end). Pure.
 */
export function expandPath(
  points: Point[],
  style: EdgeStyle = "elbow45",
  mainAxis: MainAxis = "y",
): Point[] {
  if (points.length <= 1) return [...points];
  const out: Point[] = [points[0] as Point];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1] as Point;
    const cur = points[i] as Point;
    out.push(...turnKnees(prev, cur, style, mainAxis), cur);
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
export function pathThrough(
  points: Point[],
  style: EdgeStyle = "elbow45",
  mainAxis: MainAxis = "y",
): string {
  const expanded = expandPath(points, style, mainAxis);
  if (expanded.length === 0) return "";
  const first = expanded[0] as Point;
  if (expanded.length === 1) return `M ${first.x} ${first.y}`;

  if (style === "bezier") return bezierPath(expanded);
  if (style === "rounded") return roundedPath(expanded);

  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < expanded.length; i++) {
    const p = expanded[i] as Point;
    d += ` L ${p.x} ${p.y}`;
  }
  return d;
}

/** Corner radius (px) for the "rounded" edge style, clamped per corner. */
const ROUNDED_R = 8;

/**
 * Draw an orthogonal polyline with every interior corner arced by a quadratic
 * curve: line up to `r` short of the corner, `Q corner exit-point`, continue.
 * The radius is clamped to half of each adjacent segment so short runs never
 * overshoot; (near-)collinear corners fall back to a plain `L`. Pure.
 */
function roundedPath(vertices: Point[]): string {
  const first = vertices[0] as Point;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < vertices.length - 1; i++) {
    const prev = vertices[i - 1] as Point;
    const p = vertices[i] as Point;
    const next = vertices[i + 1] as Point;
    const inLen = Math.hypot(p.x - prev.x, p.y - prev.y);
    const outLen = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(ROUNDED_R, inLen / 2, outLen / 2);
    if (r < 0.01) {
      d += ` L ${p.x} ${p.y}`;
      continue;
    }
    const inX = (p.x - prev.x) / inLen;
    const inY = (p.y - prev.y) / inLen;
    const outX = (next.x - p.x) / outLen;
    const outY = (next.y - p.y) / outLen;
    // Collinear → no corner to round.
    if (Math.abs(inX * outY - inY * outX) < 0.001) {
      d += ` L ${p.x} ${p.y}`;
      continue;
    }
    d += ` L ${p.x - inX * r} ${p.y - inY * r}`;
    d += ` Q ${p.x} ${p.y} ${p.x + outX * r} ${p.y + outY * r}`;
  }
  const last = vertices[vertices.length - 1] as Point;
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/**
 * Smooth spline for the "bezier" lanes mode — a uniform cubic **B-spline**
 * (d3's `curveBasis`), NOT a Catmull-Rom. The distinction matters: Catmull-Rom
 * passes THROUGH every waypoint, so the tight stub/corridor points produced
 * tight, ugly hairpins that could overlap node boxes. A basis spline merely
 * APPROXIMATES the interior waypoints — they act as a loose guide — giving the
 * ordinary relaxed arrow-spline look, and the curve is contained in the convex
 * hull of its control points, so it can never overshoot the canvas.
 *
 * Endpoints are clamped by tripling the first/last points, so the curve still
 * starts exactly at the node-face anchor and ends exactly at the arrow tip.
 * Consecutive duplicate points are skipped. Two distinct points degrade to a
 * straight line. Pure.
 */
function bezierPath(vertices: Point[]): string {
  const pts: Point[] = [];
  for (const p of vertices) {
    const last = pts[pts.length - 1];
    if (last === undefined || Math.hypot(p.x - last.x, p.y - last.y) > 0.01) {
      pts.push(p);
    }
  }
  const first = pts[0] as Point;
  if (pts.length === 1) return `M ${first.x} ${first.y}`;
  if (pts.length === 2) {
    const p = pts[1] as Point;
    return `M ${first.x} ${first.y} L ${p.x} ${p.y}`;
  }

  // Clamp the ends: tripled endpoints pin the spline to them.
  const ctrl: Point[] = [first, first, ...pts, pts[pts.length - 1] as Point, pts[pts.length - 1] as Point];
  let d = `M ${first.x} ${first.y}`;
  // Each window of 4 control points emits one cubic segment via the standard
  // uniform B-spline → Bézier conversion.
  for (let i = 0; i + 3 < ctrl.length; i++) {
    const p1 = ctrl[i + 1] as Point;
    const p2 = ctrl[i + 2] as Point;
    const p3 = ctrl[i + 3] as Point;
    const c1x = (2 * p1.x + p2.x) / 3;
    const c1y = (2 * p1.y + p2.y) / 3;
    const c2x = (p1.x + 2 * p2.x) / 3;
    const c2y = (p1.y + 2 * p2.y) / 3;
    const ex = (p1.x + 4 * p2.x + p3.x) / 6;
    const ey = (p1.y + 4 * p2.y + p3.y) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`;
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
  mainAxis: MainAxis = "y",
): string {
  return pathThrough([from, to], style, mainAxis);
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
  // The label rides the rendered polyline, so expand with the SAME main axis
  // the renderer's knees use or the label lands off the drawn line.
  const poly = expandPath(points, style, direction === "LR" ? "x" : "y");
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
