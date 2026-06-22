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
  SequenceNote,
  SequenceParticipant,
} from "./types.js";
import {
  BADGE_H,
  badgeWidth,
  curveBetween,
  GROUP_PAD,
  measureMultiline,
  pathThrough,
  roleColorKey,
  sizeShape,
} from "./geometry.js";

/** Vertical gap (px) between a message label badge and the arrow it sits above. */
const LABEL_ABOVE_GAP = 4;

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

  // ── 2. Header nodes (a participant box per column) ────────────────────────
  // A participant renders TWICE: a header band at the top and a closing band at
  // the bottom (mirrors Mermaid), so the lifelines read as bracketed columns and
  // the diagram has a clear bottom edge instead of dangling lines.
  const headerCenterY = padding + headerHeight / 2;
  const headerNodeAt = (i: number, centerY: number, suffix: string): PositionedNode => {
    const id = order[i] as NodeId;
    const p = partById.get(id) as SequenceParticipant;
    const size = headerSize[i] as { w: number; h: number };
    const role = p.role ?? "neutral";
    const node: PositionedNode = {
      id: suffix ? `${id}${suffix}` : id,
      x: colX[i] as number,
      y: centerY,
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
  };
  const nodes: PositionedNode[] = order.map((_, i) => headerNodeAt(i, headerCenterY, ""));

  // ── 3. Timeline: interleave messages AND notes by their global `seq` ──────
  // Each is one event occupying its own vertical band; a running Y cursor walks
  // the timeline so a note pushes the events after it down (instead of floating
  // in a side column). Events with a `seq` sort by it; any without fall back to
  // "messages in array order, then notes" — a stable, deterministic tie-break.
  const headerBottom = padding + headerHeight;
  type Event =
    | { type: "msg"; key: number; m: SequenceMessage }
    | { type: "note"; key: number; n: SequenceNote };
  const events: Event[] = [];
  messages.forEach((m, i) => events.push({ type: "msg", key: m.seq ?? i, m }));
  (graph.notes ?? []).forEach((n, i) =>
    events.push({ type: "note", key: n.seq ?? messages.length + i, n }),
  );
  // Stable sort by global order; ties keep insertion order (messages before notes).
  events.sort((a, b) => a.key - b.key);

  const xOf = (id: NodeId): number => colX[colOf.get(id) as number] as number;
  const SELF_LOOP = 28;
  // Track horizontal extent (self-loops, wide label badges, notes) for the viewBox.
  let maxX = colX.length > 0 ? (colX[colX.length - 1] as number) : padding;
  const track = (x: number): void => {
    if (x > maxX) maxX = x;
  };
  const edges: PositionedEdge[] = [];
  const noteBoxes: PositionedGroup[] = [];
  let noteCount = 0;

  // Walk the timeline. A message band is `rowGap` tall and its arrow sits at the
  // band's mid; a self-message needs a little more; a note band is its box
  // height + gap, and the box is centered on the lifelines it spans.
  let cursorY = headerBottom + padding;
  for (const ev of events) {
    if (ev.type === "msg") {
      const m = ev.m;
      const isSelf = m.from === m.to;
      const y = cursorY + rowGap / 2;
      if (isSelf) {
        edges.push(selfMessage(m, xOf(m.from), y, rowGap, edgeStyle, SELF_LOOP, track));
        cursorY += rowGap * 1.4; // reserve room for the loop's downward leg
      } else {
        edges.push(straightMessage(m, xOf(m.from), xOf(m.to), y, edgeStyle, track));
        cursorY += rowGap;
      }
    } else {
      const note = ev.n;
      const cols = note.over.map((id) => colOf.get(id)).filter((c): c is number => c !== undefined);
      if (cols.length === 0) continue;
      const lo = Math.min(...cols);
      const hi = Math.max(...cols);
      const size = measureMultiline(note.text);
      // Span the covered lifelines (+pad), but never narrower than the text. A
      // single-participant note centers its box on that lifeline.
      const spanLeft = colX[lo] as number;
      const spanRight = colX[hi] as number;
      const spanMid = (spanLeft + spanRight) / 2;
      const w = Math.max(spanRight - spanLeft + GROUP_PAD * 2, size.width + GROUP_PAD * 2);
      const h = size.height + GROUP_PAD * 2;
      const x = spanMid - w / 2;
      const box: PositionedGroup = {
        id: `__note_${noteCount++}`,
        label: note.text,
        x,
        y: cursorY,
        w,
        h,
        variant: "note",
      };
      box.labelWidth = size.width;
      noteBoxes.push(box);
      if (x + w > maxX) maxX = x + w;
      cursorY += h + rowGap / 2;
    }
  }
  const timelineBottom = cursorY;

  // ── 4. Lifelines (drop from the header to the closing band) ───────────────
  // The lifeline runs from the bottom of the top header to the top of the
  // closing header band, so it's bracketed by a participant box at each end.
  const closingTop = timelineBottom;
  const lifelineBottom = closingTop;
  const lifelines: Lifeline[] = order.map((id, i) => ({
    id,
    x1: colX[i] as number,
    y1: headerBottom,
    x2: colX[i] as number,
    y2: lifelineBottom,
  }));

  // ── 4b. Closing header band (mirrors the top header) ──────────────────────
  const closingCenterY = closingTop + headerHeight / 2;
  for (let i = 0; i < order.length; i++) {
    nodes.push(headerNodeAt(i, closingCenterY, "__end"));
  }
  const closingBottom = closingTop + headerHeight;

  const groups: PositionedGroup[] | undefined =
    noteBoxes.length > 0 ? noteBoxes : undefined;

  // ── 5. Bounds ──────────────────────────────────────────────────────────────
  const lastIdx = order.length - 1;
  const lastHalf = lastIdx >= 0 ? (headerSize[lastIdx] as { w: number }).w / 2 : 0;
  const width = Math.max(maxX + padding, (colX[lastIdx] ?? padding) + lastHalf + padding);
  const height = closingBottom + padding;

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
  track: (x: number) => void,
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
    // Widest line, so a multi-line message label sizes its badge correctly.
    const labelWidth = measureMultiline(m.label).width;
    edge.labelWidth = labelWidth;
    // Sit the label ABOVE the arrow (not on top of it, which would hide a long
    // horizontal message line). Centered on the message span.
    const mid = (fromX + toX) / 2;
    edge.labelPoint = { x: mid, y: y - BADGE_H / 2 - LABEL_ABOVE_GAP };
    // Reserve the badge's right edge so a wide label isn't cropped by the viewBox.
    track(mid + badgeWidth(labelWidth) / 2);
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
    const labelWidth = measureMultiline(m.label).width;
    edge.labelWidth = labelWidth;
    // Label ABOVE the loop (between the lifeline and the loop's top), so it never
    // sits on the loop arrow. Anchored just right of the lifeline so it clears it.
    const lx = x + loop / 2 + badgeWidth(labelWidth) / 2;
    edge.labelPoint = { x: lx, y: y - BADGE_H / 2 - LABEL_ABOVE_GAP };
    track(lx + badgeWidth(labelWidth) / 2);
  }
  return edge;
}

