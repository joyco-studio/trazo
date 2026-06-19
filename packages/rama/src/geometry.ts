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

  const labelWidth = label ? measure(label, LABEL_FONT) : 0;
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
 * Build the SVG `d` path for a git edge between two placed points: a straight
 * vertical/horizontal line when collinear, a smooth cubic curve when not (the
 * control points sit at the perpendicular midpoint so it eases between
 * columns). This is the curve the git layout used inline; extracted here so
 * the flow layout can reuse the exact same easing between layers.
 */
export function curveBetween(from: Point, to: Point): string {
  const x1 = from.x;
  const y1 = from.y;
  const x2 = to.x;
  const y2 = to.y;

  if (x1 === x2 || y1 === y2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }

  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

/**
 * Build an SVG `d` path through an ordered list of points (start anchor →
 * dummy points → end anchor). Consecutive collinear points become a straight
 * `L`; otherwise a cubic Bézier eases between them (same control-point scheme
 * as {@link curveBetween}). Pure function of the input points.
 */
export function pathThrough(points: Point[]): string {
  if (points.length === 0) return "";
  const first = points[0] as Point;
  if (points.length === 1) return `M ${first.x} ${first.y}`;

  let d = `M ${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1] as Point;
    const cur = points[i] as Point;
    if (prev.x === cur.x || prev.y === cur.y) {
      d += ` L ${cur.x} ${cur.y}`;
    } else {
      const midY = (prev.y + cur.y) / 2;
      d += ` C ${prev.x} ${midY}, ${cur.x} ${midY}, ${cur.x} ${cur.y}`;
    }
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
