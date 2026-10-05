/**
 * Import the small, spatial Excalidraw vocabulary used by explanatory drawings.
 * This is an authored drawing, not a flow graph: positions and paint order are
 * preserved while the renderer replaces Excalidraw colors with Trazo roles.
 */

import { SEMANTIC_ROLES } from "./types.js";
import type { DrawingPrimitive, Point, PositionedGraph, SemanticRole } from "./types.js";

export interface ExcalidrawDocument {
  elements: unknown[];
}

export interface ExcalidrawImportOptions {
  /** Map source stroke hex values to Trazo roles. Keys are case-insensitive. */
  roleByColor?: Record<string, SemanticRole>;
}

const PADDING = 24;

/** Common Excalidraw palette colors used in the reference illustration. */
const DEFAULT_ROLES: Readonly<Record<string, SemanticRole>> = {
  "#2f9e44": "success",
  "#6741d9": "primary",
  "#f08c00": "warning",
  "#e03131": "error",
  "#1971c2": "info",
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function number(value: unknown, field: string, id: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Excalidraw element ${id}: invalid ${field}`);
  }
  return value;
}

function size(value: unknown, field: string, id: string): number {
  const n = number(value, field, id);
  if (n < 0) throw new Error(`Excalidraw element ${id}: negative ${field}`);
  return n;
}

function opacityOf(value: unknown, id: string): number {
  if (value === undefined) return 1;
  const n = number(value, "opacity", id);
  if (n < 0 || n > 100) throw new Error(`Excalidraw element ${id}: opacity must be 0–100`);
  return n / 100;
}

function elementId(element: Record<string, unknown>, index: number): string {
  return typeof element.id === "string" && element.id !== "" ? element.id : `[${index}]`;
}

function pointsOf(value: unknown, x: number, y: number, id: string): Point[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`Excalidraw element ${id}: path needs at least two points`);
  }
  return value.map((point, index) => {
    if (!Array.isArray(point) || point.length < 2) {
      throw new Error(`Excalidraw element ${id}: invalid point ${index}`);
    }
    return {
      x: x + number(point[0], `point ${index} x`, id),
      y: y + number(point[1], `point ${index} y`, id),
    };
  });
}

/** Excalidraw leaves a small visual gap at bound shapes; Trazo connectors meet the border. */
function rectangleBindingPoint(
  value: unknown,
  point: Point,
  byId: Map<string, Record<string, unknown>>,
): Point {
  const binding = record(value);
  const target = typeof binding?.elementId === "string" ? byId.get(binding.elementId) : undefined;
  if (target?.type !== "rectangle") return point;

  const id = binding!.elementId as string;
  const x = number(target.x, "x", id);
  const y = number(target.y, "y", id);
  const w = size(target.width, "width", id);
  const h = size(target.height, "height", id);
  const fixed = binding?.fixedPoint;
  if (Array.isArray(fixed) && fixed.length >= 2 &&
      typeof fixed[0] === "number" && Number.isFinite(fixed[0]) &&
      typeof fixed[1] === "number" && Number.isFinite(fixed[1])) {
    const [fx, fy] = fixed as [number, number];
    const onBorder = Math.min(fx, 1 - fx, fy, 1 - fy) <= 0.001;
    if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1 && onBorder) {
      return { x: x + w * fx, y: y + h * fy };
    }
  }

  // Older bindings may omit a usable fixed point. Project their saved endpoint
  // to the closest border, preserving the authored attachment side.
  const px = Math.max(x, Math.min(x + w, point.x));
  const py = Math.max(y, Math.min(y + h, point.y));
  if (point.x < x || point.x > x + w || point.y < y || point.y > y + h) {
    return { x: px, y: py };
  }
  const sides = [
    { distance: point.x - x, x, y: py },
    { distance: x + w - point.x, x: x + w, y: py },
    { distance: point.y - y, x: px, y },
    { distance: y + h - point.y, x: px, y: y + h },
  ];
  const nearest = sides.reduce((best, side) => side.distance < best.distance ? side : best);
  return { x: nearest.x, y: nearest.y };
}

type PathArrowHead = Extract<DrawingPrimitive, { kind: "path" }>["arrowHead"];

function arrowHeadOf(element: Record<string, unknown>): PathArrowHead {
  const start = element.startArrowhead != null;
  const end = element.endArrowhead != null;
  return start && end ? "both" : start ? "start" : end ? "end" : "none";
}

function strokeStyleOf(value: unknown, id: string): "solid" | "dashed" | "dotted" {
  if (value === undefined) return "solid";
  if (value === "solid" || value === "dashed" || value === "dotted") return value;
  throw new Error(`Excalidraw element ${id}: unsupported strokeStyle ${String(value)}`);
}

/**
 * Convert an Excalidraw JSON document (or its parsed object) into an inline
 * Trazo drawing. Live rectangles, text, lines, and arrows are supported.
 */
export function importExcalidraw(
  document: string | ExcalidrawDocument,
  options: ExcalidrawImportOptions = {},
): PositionedGraph {
  let input: unknown = document;
  if (typeof document === "string") {
    try {
      input = JSON.parse(document) as unknown;
    } catch {
      throw new Error("Excalidraw document: invalid JSON");
    }
  }
  const root = record(input);
  if (root === null || !Array.isArray(root.elements)) {
    throw new Error("Excalidraw document: expected an elements array");
  }

  const roles: Record<string, SemanticRole> = { ...DEFAULT_ROLES };
  for (const [color, role] of Object.entries(options.roleByColor ?? {})) {
    if (!SEMANTIC_ROLES.includes(role)) {
      throw new Error(`Excalidraw import: invalid role ${String(role)} for ${color}`);
    }
    roles[color.toLowerCase()] = role;
  }
  const roleOf = (color: unknown): SemanticRole =>
    typeof color === "string" ? (roles[color.toLowerCase()] ?? "neutral") : "neutral";

  const active = root.elements.filter((value) => record(value)?.isDeleted !== true);
  const byId = new Map<string, Record<string, unknown>>();
  for (const value of active) {
    const element = record(value);
    if (element !== null && typeof element.id === "string") byId.set(element.id, element);
  }

  const drawing: DrawingPrimitive[] = active.map((value, index) => {
    const element = record(value);
    if (element === null) throw new Error(`Excalidraw element [${index}]: expected an object`);
    const id = elementId(element, index);
    const type = element.type;
    if (type !== "rectangle" && type !== "text" && type !== "line" && type !== "arrow") {
      throw new Error(`Excalidraw element ${id}: unsupported type ${String(type)}`);
    }
    if (element.angle !== undefined && number(element.angle, "angle", id) !== 0) {
      throw new Error(`Excalidraw element ${id}: rotation is unsupported`);
    }
    const x = number(element.x, "x", id);
    const y = number(element.y, "y", id);
    const opacity = opacityOf(element.opacity, id);
    const ownRole = roleOf(element.strokeColor);

    if (type === "rectangle") {
      return {
        kind: "rectangle",
        id,
        x,
        y,
        w: size(element.width, "width", id),
        h: size(element.height, "height", id),
        role: ownRole,
        opacity,
        filled: element.backgroundColor !== "transparent",
      };
    }
    if (type === "text") {
      if (typeof element.text !== "string") {
        throw new Error(`Excalidraw element ${id}: invalid text`);
      }
      const container = typeof element.containerId === "string"
        ? byId.get(element.containerId)
        : undefined;
      const role = container?.type === "rectangle" ? roleOf(container.strokeColor) : ownRole;
      const onRoleFill = container?.type === "rectangle" && container.backgroundColor !== "transparent";
      const align = element.textAlign;
      const verticalAlign = element.verticalAlign;
      if (align !== undefined && align !== "left" && align !== "center" && align !== "right") {
        throw new Error(`Excalidraw element ${id}: unsupported textAlign ${String(align)}`);
      }
      if (verticalAlign !== undefined && verticalAlign !== "top" && verticalAlign !== "middle" && verticalAlign !== "bottom") {
        throw new Error(`Excalidraw element ${id}: unsupported verticalAlign ${String(verticalAlign)}`);
      }
      return {
        kind: "text",
        id,
        x,
        y,
        w: size(element.width, "width", id),
        h: size(element.height, "height", id),
        text: element.text,
        role,
        onRoleFill,
        opacity,
        align: (align as "left" | "center" | "right" | undefined) ?? "left",
        verticalAlign: (verticalAlign as "top" | "middle" | "bottom" | undefined) ?? "top",
      };
    }
    const points = pointsOf(element.points, x, y, id);
    points[0] = rectangleBindingPoint(element.startBinding, points[0]!, byId);
    points[points.length - 1] = rectangleBindingPoint(
      element.endBinding,
      points[points.length - 1]!,
      byId,
    );
    return {
      kind: "path",
      id,
      points,
      role: ownRole,
      opacity,
      arrowHead: type === "arrow" ? arrowHeadOf(element) : "none",
      strokeStyle: strokeStyleOf(element.strokeStyle, id),
    };
  });

  if (drawing.length === 0) {
    return { nodes: [], edges: [], drawing, width: PADDING * 2, height: PADDING * 2, laneCount: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of drawing) {
    const points = element.kind === "path"
      ? element.points
      : [{ x: element.x, y: element.y }, { x: element.x + element.w, y: element.y + element.h }];
    for (const point of points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  const dx = PADDING - minX;
  const dy = PADDING - minY;
  const normalized = drawing.map((element): DrawingPrimitive => element.kind === "path"
    ? { ...element, points: element.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) }
    : { ...element, x: element.x + dx, y: element.y + dy });

  return {
    nodes: [],
    edges: [],
    drawing: normalized,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2,
    laneCount: 0,
  };
}
