/**
 * Deterministic layout for a sequence diagram.
 *
 * Pure TypeScript: no DOM, no canvas, no `window`. Equal `SequenceGraph` (same
 * participants/messages/notes, same order) always produces a deeply-equal
 * `PositionedGraph`. Every position is a fixed function of the caller's input
 * array order — participant columns by declaration order, message rows by
 * message order — so there is no dependence on hash-map iteration, time, or
 * randomness.
 *
 * A sequence diagram is a regular GRID, not a layered graph:
 *  - participants  → columns (a fixed x per lifeline),
 *  - messages      → rows (an increasing y per message),
 *  - lifelines     → the vertical dashed line dropping from each header,
 *  - notes         → a box spanning the participants it covers.
 *
 * The result reuses the shared `PositionedGraph` shape so the existing `<Graph>`
 * renderer draws it: headers are `PositionedNode` boxes, messages are
 * `PositionedEdge`s (`kind: "message"`, `arrowHead: "end"`, async → `dashed`),
 * lifelines populate `graph.lifelines`, and notes are `PositionedGroup`s with
 * `variant: "note"`.
 */

import type {
  Lifeline,
  NodeId,
  PositionedEdge,
  PositionedGraph,
  PositionedGroup,
  PositionedNode,
  SequenceGraph,
  SequenceLayoutOptions,
  SequenceMessage,
  SequenceParticipant,
} from "./types.js";
import {
  curveBetween,
  GROUP_PAD,
  measureMultiline,
  pathThrough,
  roleColorKey,
  sizeShape,
} from "./geometry.js";

const DEFAULTS = {
  columnGap: 120,
  rowGap: 48,
  headerHeight: 40,
  padding: 24,
  edgeStyle: "orthogonal" as const,
} as const;

export function layoutSequence(
  graph: SequenceGraph,
  options?: SequenceLayoutOptions,
): PositionedGraph {
  const columnGap = options?.columnGap ?? DEFAULTS.columnGap;
  const rowGap = options?.rowGap ?? DEFAULTS.rowGap;
  const headerHeight = options?.headerHeight ?? DEFAULTS.headerHeight;
  const padding = options?.padding ?? DEFAULTS.padding;
  const edgeStyle = options?.edgeStyle ?? DEFAULTS.edgeStyle;

  // ── 0. Index participants (declaration order) + auto-register from messages ──
  const partById = new Map<NodeId, SequenceParticipant>();
  const order: NodeId[] = [];
  const register = (id: NodeId, p?: SequenceParticipant): void => {
    if (partById.has(id)) return;
    partById.set(id, p ?? { id });
    order.push(id);
  };
  for (const p of graph.participants) register(p.id, p);
  // Participants first seen in a message get a column too, in first-seen order.
  for (const m of graph.messages) {
    register(m.from);
    register(m.to);
  }
  const colOf = new Map<NodeId, number>();
  order.forEach((id, i) => colOf.set(id, i));

  // Drop messages whose endpoints aren't participants (defensive; all are
  // registered above, so this only guards malformed input).
  const messages = graph.messages.filter(
    (m) => colOf.has(m.from) && colOf.has(m.to),
  );

  // ── 1. Column x: place headers left→right so adjacent boxes clear ─────────
  const headerSize = order.map((id) => {
    const p = partById.get(id) as SequenceParticipant;
    return sizeShape("box", p.label ?? id);
  });
  const colX: number[] = [];
  {
    let prevRight = padding;
    for (let i = 0; i < order.length; i++) {
      const w = (headerSize[i] as { w: number }).w;
      const half = w / 2;
      // Center sits a clear gap past the previous box's right edge (and at least
      // half its own width past the padding for the first column).
      const center = i === 0 ? padding + half : Math.max(prevRight + columnGap, prevRight + half);
      colX[i] = center;
      prevRight = center + half;
    }
  }

  // ── 2. Header nodes ───────────────────────────────────────────────────────
  const headerCenterY = padding + headerHeight / 2;
  const nodes: PositionedNode[] = order.map((id, i) => {
    const p = partById.get(id) as SequenceParticipant;
    const size = headerSize[i] as { w: number; h: number };
    const role = p.role ?? "neutral";
    const node: PositionedNode = {
      id,
      x: colX[i] as number,
      y: headerCenterY,
      color: roleColorKey(role),
      shape: "box",
      role,
      w: size.w,
      h: headerHeight,
    };
    const label = p.label ?? id;
    node.label = label;
    node.labelWidth = measureMultiline(label).width;
    return node;
  });

  // ── 3. Rows: each message gets a row by its input order ───────────────────
  const headerBottom = padding + headerHeight;
  const rowY = (r: number): number => headerBottom + padding + r * rowGap;
  const lastRowY = messages.length > 0 ? rowY(messages.length - 1) : headerBottom + padding;
  const lifelineBottom = lastRowY + rowGap;

  // ── 4. Lifelines ─────────────────────────────────────────────────────────
  const lifelines: Lifeline[] = order.map((id, i) => ({
    id,
    x1: colX[i] as number,
    y1: headerBottom,
    x2: colX[i] as number,
    y2: lifelineBottom,
  }));

  // ── 5. Messages → edges ───────────────────────────────────────────────────
  // Track how far a self-loop or label bulges right so the viewBox can grow.
  let maxX = colX.length > 0 ? (colX[colX.length - 1] as number) : padding;
  const SELF_LOOP = 28;
  const xOf = (id: NodeId): number => colX[colOf.get(id) as number] as number;
  const edges: PositionedEdge[] = messages.map((m, r) => {
    const fromX = xOf(m.from);
    const toX = xOf(m.to);
    const y = rowY(r);
    return m.from === m.to
      ? selfMessage(m, fromX, y, rowGap, edgeStyle, SELF_LOOP, (x) => {
          if (x > maxX) maxX = x;
        })
      : straightMessage(m, fromX, toX, y, edgeStyle);
  });

  // ── 6. Notes → group boxes (variant "note") ───────────────────────────────
  // Notes are stacked in a column below the header band; a running cursor sums
  // each prior note's OWN height (notes may differ in height) so they never
  // overlap, and the lowest note grows the diagram height (`maxY`).
  let groups: PositionedGroup[] | undefined;
  let maxY = lifelineBottom;
  if (graph.notes && graph.notes.length > 0) {
    const out: PositionedGroup[] = [];
    let cursorY = headerBottom + padding;
    graph.notes.forEach((note, ni) => {
      const cols = note.over.map((id) => colOf.get(id)).filter((c): c is number => c !== undefined);
      if (cols.length === 0) return;
      const lo = Math.min(...cols);
      const hi = Math.max(...cols);
      const size = measureMultiline(note.text);
      const left = (colX[lo] as number) - GROUP_PAD;
      const right = (colX[hi] as number) + GROUP_PAD;
      const w = Math.max(right - left, size.width + GROUP_PAD * 2);
      const h = size.height + GROUP_PAD * 2;
      const box: PositionedGroup = {
        id: `__note_${ni}`,
        label: note.text,
        x: left,
        y: cursorY,
        w,
        h,
        variant: "note",
      };
      box.labelWidth = size.width;
      out.push(box);
      if (left + w > maxX) maxX = left + w;
      if (cursorY + h > maxY) maxY = cursorY + h;
      cursorY += h + GROUP_PAD;
    });
    if (out.length > 0) groups = out;
  }

  // ── 7. Bounds ──────────────────────────────────────────────────────────────
  const lastIdx = order.length - 1;
  const lastHalf = lastIdx >= 0 ? (headerSize[lastIdx] as { w: number }).w / 2 : 0;
  const width = Math.max(maxX + padding, (colX[lastIdx] ?? padding) + lastHalf + padding);
  // Height covers the lifelines AND the deepest note box.
  const height = maxY + padding;

  const result: PositionedGraph = {
    nodes,
    edges,
    width,
    height,
    laneCount: order.length,
    lifelines,
  };
  if (groups !== undefined) result.groups = groups;
  return result;
}

/** A straight horizontal message between two lifelines at row y. */
function straightMessage(
  m: SequenceMessage,
  fromX: number,
  toX: number,
  y: number,
  edgeStyle: SequenceLayoutOptions["edgeStyle"],
): PositionedEdge {
  const from = { x: fromX, y };
  const to = { x: toX, y };
  const edge: PositionedEdge = {
    from: m.from,
    to: m.to,
    path: curveBetween(from, to, edgeStyle),
    kind: "message",
    color: "accent",
    arrowHead: "end",
  };
  if (m.kind === "async") edge.dashed = true;
  if (m.label !== undefined) {
    edge.label = m.label;
    edge.labelPoint = { x: (fromX + toX) / 2, y };
    // Widest line, so a multi-line message label sizes its badge correctly.
    edge.labelWidth = measureMultiline(m.label).width;
  }
  return edge;
}

/** A self-message: a small squared loop off the right of a single lifeline. */
function selfMessage(
  m: SequenceMessage,
  x: number,
  y: number,
  rowGap: number,
  edgeStyle: SequenceLayoutOptions["edgeStyle"],
  loop: number,
  track: (x: number) => void,
): PositionedEdge {
  const drop = rowGap * 0.6;
  const points = [
    { x, y },
    { x: x + loop, y },
    { x: x + loop, y: y + drop },
    { x, y: y + drop },
  ];
  track(x + loop);
  const edge: PositionedEdge = {
    from: m.from,
    to: m.to,
    path: pathThrough(points, edgeStyle),
    kind: "message",
    color: "accent",
    arrowHead: "end",
  };
  if (m.kind === "async") edge.dashed = true;
  if (m.label !== undefined) {
    edge.label = m.label;
    edge.labelPoint = { x: x + loop, y: y + drop / 2 };
    // Widest line, so a multi-line self-message label sizes its badge correctly.
    edge.labelWidth = measureMultiline(m.label).width;
  }
  return edge;
}

