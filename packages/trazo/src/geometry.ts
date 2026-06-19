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

import type { EdgeStyle, FlowDirection, NodeShape, Point } from "./types.js";
import { measure } from "./measure.js";

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
 * Width = glyph advances + (chars - 1) * tracking. Pure + deterministic.
 */
export function measureLabel(text: string, size = LABEL_FONT.size): number {
  const base = measure(text, { family: LABEL_FONT.family, size });
  const chars = [...text].length;
  const tracking = chars > 1 ? (chars - 1) * LABEL_TRACKING_EM * size : 0;
  return base + tracking;
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
/** Height (px) of the sliced-corner git label badge. Shared so the layout can
 * reserve bounds for above/below placement and the renderer draws to match. */
export const BADGE_H = 22;

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
  // uppercased text WITH tracking so the shape reserves the right width.
  const labelWidth = label ? measureLabel(label.toUpperCase()) : 0;
  const boxW = Math.max(minNodeWidth, labelWidth + labelPadX * 2);
  const h = nodeHeight;

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
  if (direction === "LR") {
    return { x: center.x + w / 2, y: center.y };
  }
  // TD
  const capInset = shape === "cylinder" ? 6 : 0;
  return { x: center.x, y: center.y + h / 2 - capInset };
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
  if (direction === "LR") {
    return { x: center.x - w / 2, y: center.y };
  }
  // TD
  const capInset = shape === "cylinder" ? 6 : 0;
  return { x: center.x, y: center.y - h / 2 + capInset };
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
function turn(from: Point, to: Point, style: EdgeStyle): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 || dy === 0) {
    return `L ${to.x} ${to.y}`;
  }

  if (style === "orthogonal") {
    // Right-angle elbow. Pivot on the dominant axis so the bend reads cleanly:
    // vertical-dominant → go down to target y, then across; mirror for LR.
    if (Math.abs(dy) >= Math.abs(dx)) {
      return `L ${from.x} ${to.y} L ${to.x} ${to.y}`;
    }
    return `L ${to.x} ${from.y} L ${to.x} ${to.y}`;
  }

  // elbow45
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (ady >= adx) {
    const kneeY = to.y - sy * adx;
    return `L ${from.x} ${kneeY} L ${to.x} ${to.y}`;
  }
  const kneeX = to.x - sx * ady;
  return `L ${kneeX} ${from.y} L ${to.x} ${to.y}`;
}

/**
 * Build the SVG `d` path for an edge through an ordered list of points (the
 * exit anchor, any dummy/waypoints, and the entry anchor), using the chosen
 * turn style between consecutive points. Callers add perpendicular stub points
 * at each end (see {@link withStubs}) so edges always leave/enter a node face
 * at 90° before any turn. Pure function of its inputs.
 */
export function pathThrough(points: Point[], style: EdgeStyle = "elbow45"): string {
  if (points.length === 0) return "";
  const first = points[0] as Point;
  if (points.length === 1) return `M ${first.x} ${first.y}`;

  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1] as Point;
    const cur = points[i] as Point;
    d += ` ${turn(prev, cur, style)}`;
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
