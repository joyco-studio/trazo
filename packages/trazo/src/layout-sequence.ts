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
  badgeHeight,
  badgeWidth,
  curveBetween,
  GROUP_PAD,
  measureMultiline,
  measurePlainMultiline,
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

  // Self-loop bulge width (px) — the horizontal reach of the squared loop drawn
  // in `selfMessage`. Declared here so column spacing can reserve room for a
  // self-message's loop + label before the next column.
  const SELF_LOOP = 28;

  // ── 1. Column x: place headers left→right, spaced so message LABELS FIT ────
  // A fixed `columnGap` packs the lifelines tight to the left, so every message
  // label wider than the gap overhangs both lifelines and the whole diagram
  // reads as leaning left. Mermaid instead spreads the columns to fit the traffic
  // between them; mirror that. For each straight message reserve enough that its
  // centered label badge fits WITHIN its OWN span — not just adjacent pairs: a
  // wide A→C badge is centered on the full A–C span, so if that span is narrower
  // than the badge it crosses the outer lifelines (and its left edge can leave
  // the viewBox, which `track` only guards on the right). A self-message instead
  // reserves its loop + right-of-loop label reach so it clears the next column.
  const headerSize = order.map((id) => {
    const p = partById.get(id) as SequenceParticipant;
    return sizeShape("box", p.label ?? id);
  });
  // Per RIGHT column: the min span each message ending there needs (its left
  // column + badge width), applied when the right column is placed (its left
  // column is already final). Keyed by the right end so adjacent AND multi-span
  // messages are handled by the same rule.
  const spanNeed: Array<Array<{ from: number; width: number }>> = order.map(() => []);
  const selfReach: number[] = new Array(order.length).fill(0);
  for (const m of messages) {
    const a = colOf.get(m.from) as number;
    const b = colOf.get(m.to) as number;
    // Messages render verbatim (no inline-code chips) — measure plain.
    const bw = m.label !== undefined ? badgeWidth(measurePlainMultiline(m.label).width) : 0;
    if (a === b) {
      // Loop bulges SELF_LOOP right of the lifeline; its label badge sits just
      // past the loop. Reserve that whole reach past the lifeline center.
      selfReach[a] = Math.max(selfReach[a] as number, SELF_LOOP + bw);
    } else if (bw > 0) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      (spanNeed[hi] as Array<{ from: number; width: number }>).push({ from: lo, width: bw });
    }
  }
  const colX: number[] = [];
  for (let i = 0; i < order.length; i++) {
    const half = (headerSize[i] as { w: number }).w / 2;
    if (i === 0) {
      colX[i] = padding + half;
      continue;
    }
    const prevCenter = colX[i - 1] as number;
    const prevHalf = (headerSize[i - 1] as { w: number }).w / 2;
    // Base spacing off the previous column: the clear gap, or the previous
    // column's self-loop reach + this box's half so its loop+label clears here.
    let center = prevCenter + Math.max(
      prevHalf + Math.max(columnGap, half),
      prevHalf + (selfReach[i - 1] as number) + half,
    );
    // Then push right until every message ending at column i has its full span
    // (colX[i] - colX[from]) at least its badge width, so the centered label sits
    // within its own two lifelines. `colX[from]` is already final (from < i).
    for (const s of spanNeed[i] as Array<{ from: number; width: number }>) {
      const required = (colX[s.from] as number) + s.width;
      if (center < required) center = required;
    }
    colX[i] = center;
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
  // A message adopts its SOURCE participant's role color when that participant
  // has an EXPLICIT role — mirroring a flow `==>` edge tinting to its source
  // node's role. A sender left at the default (no `:role`) keeps the neutral
  // `accent` edge color, so an untouched diagram is unchanged and a themed
  // neutral (e.g. JOYCO's black) never turns the arrows invisible on the canvas.
  const messageColor = (fromId: NodeId): string => {
    const role = partById.get(fromId)?.role;
    return role !== undefined ? roleColorKey(role) : "accent";
  };
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
      // A message label sits ABOVE its arrow. Reserve the FULL extra height a
      // multi-line (`<br/>`) badge adds over a single line: lower the arrow by
      // exactly that much AND grow the band by the same amount. The label's TOP
      // edge then lands at the SAME offset above the band a single-line badge
      // would — never reaching further up into the previous event (or the header
      // for the first message). Single-line labels give `extraLift === 0`:
      // spacing unchanged. (`badgeHeight >= BADGE_H`, so `extraLift >= 0`.)
      const labelH = m.label !== undefined ? measurePlainMultiline(m.label).height : 0;
      const extraLift = Math.max(0, badgeHeight(labelH) - BADGE_H);
      const y = cursorY + rowGap / 2 + extraLift;
      const color = messageColor(m.from);
      if (isSelf) {
        edges.push(selfMessage(m, xOf(m.from), y, rowGap, edgeStyle, SELF_LOOP, color, track));
        cursorY += rowGap * 1.4 + extraLift; // reserve room for the loop's downward leg
      } else {
        edges.push(straightMessage(m, xOf(m.from), xOf(m.to), y, edgeStyle, color, track));
        cursorY += rowGap + extraLift;
      }
    } else {
      const note = ev.n;
      const cols = note.over.map((id) => colOf.get(id)).filter((c): c is number => c !== undefined);
      if (cols.length === 0) continue;
      const lo = Math.min(...cols);
      const hi = Math.max(...cols);
      // Notes render verbatim (renderGroup), so measure plain — backticks are
      // literal glyphs, not inline-code chips.
      const size = measurePlainMultiline(note.text);
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
  color: string,
  track: (x: number) => void,
): PositionedEdge {
  const from = { x: fromX, y };
  const to = { x: toX, y };
  const edge: PositionedEdge = {
    from: m.from,
    to: m.to,
    path: curveBetween(from, to, edgeStyle),
    kind: "message",
    color,
    arrowHead: "end",
  };
  if (m.kind === "async") edge.dashed = true;
  if (m.label !== undefined) {
    edge.label = m.label;
    // Widest line, so a multi-line message label sizes its badge correctly.
    // Messages render verbatim as edge labels, so measure plain (backticks
    // literal, not inline-code chips).
    const label = measurePlainMultiline(m.label);
    edge.labelWidth = label.width;
    // labelHeight drives the renderer's multi-line badge; a `<br/>` message
    // stacks its rows and grows the chip via `badgeHeight`.
    edge.labelHeight = label.height;
    // Sit the label ABOVE the arrow (not on top of it, which would hide a long
    // horizontal message line). Centered on the message span. A `<br/>` label's
    // badge is taller, so offset by HALF the real (multi-line) badge height.
    const mid = (fromX + toX) / 2;
    edge.labelPoint = { x: mid, y: y - badgeHeight(label.height) / 2 - LABEL_ABOVE_GAP };
    // Reserve the badge's right edge so a wide label isn't cropped by the viewBox.
    track(mid + badgeWidth(label.width) / 2);
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
  color: string,
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
    color,
    arrowHead: "end",
  };
  if (m.kind === "async") edge.dashed = true;
  if (m.label !== undefined) {
    edge.label = m.label;
    // Messages render verbatim as edge labels, so measure plain (backticks
    // literal, not inline-code chips).
    const label = measurePlainMultiline(m.label);
    edge.labelWidth = label.width;
    // labelHeight drives the renderer's multi-line badge (stacked `<br/>` rows).
    edge.labelHeight = label.height;
    // Label ABOVE the loop (between the lifeline and the loop's top), so it never
    // sits on the loop arrow. Anchored just right of the lifeline so it clears it.
    // A `<br/>` label's badge is taller — offset by half its real height.
    const lx = x + loop / 2 + badgeWidth(label.width) / 2;
    edge.labelPoint = { x: lx, y: y - badgeHeight(label.height) / 2 - LABEL_ABOVE_GAP };
    track(lx + badgeWidth(label.width) / 2);
  }
  return edge;
}

