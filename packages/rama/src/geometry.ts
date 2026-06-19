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

import type { FlowDirection, NodeShape, Point } from "./types.js";
import { measure } from "./measure.js";

/** Font used to size flow-node labels — Public Sans, hub body size. */
const LABEL_FONT = { family: "PublicSans", size: 13 } as const;

/**
 * Git node visual geometry, shared between the layout (for bounds math) and the
 * renderer (for drawing), so the computed `width` always reserves room for the
 * label and nothing is cropped. Git commit markers are SQUARES of side
 * `2*NODE_HALF`; the label sits to their right, `LABEL_GAP` px after the edge.
 */
export const NODE_HALF = 5;
export const LABEL_GAP = 10;

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

  // Labels render UPPERCASE (JOYCO style), which is wider than the authored
  // case — measure the uppercased text so the shape reserves the right width.
  const labelWidth = label ? measure(label.toUpperCase(), LABEL_FONT) : 0;
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
 * Build the segment(s) from `from` to `to` in the JOYCO hard-edged style: run
 * straight along the dominant axis, then turn ABRUPTLY at exactly 45° to shift
 * across, then straight again — no easing. Returns the `L`/`M` commands AFTER
 * the implicit start point (caller emits the `M`).
 *
 * Given a vertical-dominant step (git/flow TD: |dy| ≥ |dx|): go straight to the
 * point `|dx|` before the target along y, cut a 45° diagonal of length `|dx|`
 * in both axes to land on the target's column, then straight to the target.
 * Horizontal-dominant (flow LR) is the mirror. Collinear → a single `L`.
 */
function elbow45(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 || dy === 0) {
    return `L ${to.x} ${to.y}`;
  }

  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);

  if (ady >= adx) {
    // vertical-dominant: straight down, 45° diagonal of size adx, straight down.
    const kneeY = to.y - sy * adx;
    return `L ${from.x} ${kneeY} L ${to.x} ${to.y}`;
  }
  // horizontal-dominant: straight across, 45° diagonal of size ady, straight.
  const kneeX = to.x - sx * ady;
  return `L ${kneeX} ${from.y} L ${to.x} ${to.y}`;
}

/**
 * Build the SVG `d` path for a git edge between two placed points using the
 * abrupt 45° elbow style (straight → sharp 45° turn → straight). Collinear
 * points yield a single straight line. The flow layout reuses the same style
 * via {@link pathThrough}.
 */
export function curveBetween(from: Point, to: Point): string {
  return `M ${from.x} ${from.y} ${elbow45(from, to)}`;
}

/**
 * Build an SVG `d` path through an ordered list of points (start anchor →
 * dummy points → end anchor), each hop using the same abrupt 45° elbow style
 * as {@link curveBetween}. Pure function of the input points.
 */
export function pathThrough(points: Point[]): string {
  if (points.length === 0) return "";
  const first = points[0] as Point;
  if (points.length === 1) return `M ${first.x} ${first.y}`;

  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1] as Point;
    const cur = points[i] as Point;
    d += ` ${elbow45(prev, cur)}`;
  }
  return d;
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
