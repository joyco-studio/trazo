/**
 * Public flow DSL parser — a tiny, forgiving line-based language for describing
 * a flowchart, parsed into a `FlowGraph`.
 *
 * Grammar (one statement per line, `#` starts a comment, blank lines ignored):
 *
 *   flow TD | flow LR          set the layout direction (default: TD).
 *   <node> --> <node>          neutral edge (accent color).
 *   <node> ==> <node>          colored edge (source node's role color).
 *   <node> -->|label| <node>   edge with a label (works with ==> too).
 *   <node>                     bare node declaration.
 *
 * Node ref syntax: `id["label"]`, `id(["label"])`, `id{"label"}`, `id[("label")]`
 * with an optional `:role` suffix (primary|good|bad|pending|streamed|neutral).
 *
 * The parsed direction is stored on `graph.direction` so `layoutFlow` can pick
 * it up automatically without extra options.
 */

import type { FlowDirection, FlowGraph, FlowNode, NodeShape, ParseError, SemanticRole } from "./types.js";

export interface FlowParseResult {
  graph: FlowGraph;
  error: ParseError | null;
}

const ROLES: ReadonlySet<string> = new Set([
  "primary",
  "good",
  "bad",
  "pending",
  "streamed",
  "neutral",
]);

interface NodeRef {
  id: string;
  shape?: NodeShape;
  label?: string;
  role?: SemanticRole;
}

const SHAPE_DELIMS: ReadonlyArray<{ open: string; close: string; shape: NodeShape }> = [
  { open: "([", close: "])", shape: "stadium" },
  { open: "[(", close: ")]", shape: "cylinder" },
  { open: "{", close: "}", shape: "diamond" },
  { open: "[", close: "]", shape: "box" },
];

function parseNodeRef(input: string): { ref: NodeRef; rest: string } | null {
  const trimmed = input.trimStart();
  const idMatch = /^[A-Za-z0-9_]+/.exec(trimmed);
  // noUncheckedIndexedAccess: idMatch[0] is the full match and is always
  // defined when exec returns non-null.
  if (!idMatch) return null;
  const id = idMatch[0]!;
  let cursor = trimmed.slice(id.length);

  let shape: NodeShape | undefined;
  let label: string | undefined;

  for (const delim of SHAPE_DELIMS) {
    if (cursor.startsWith(delim.open)) {
      const end = cursor.indexOf(delim.close, delim.open.length);
      if (end === -1) return null;
      let inner = cursor.slice(delim.open.length, end).trim();
      if (
        (inner.startsWith('"') && inner.endsWith('"')) ||
        (inner.startsWith("'") && inner.endsWith("'"))
      ) {
        inner = inner.slice(1, -1);
      }
      shape = delim.shape;
      if (inner) label = inner;
      cursor = cursor.slice(end + delim.close.length);
      break;
    }
  }

  let role: SemanticRole | undefined;
  const roleMatch = /^:([a-z]+)/.exec(cursor);
  if (roleMatch && ROLES.has(roleMatch[1] ?? "")) {
    role = roleMatch[1] as SemanticRole;
    cursor = cursor.slice(roleMatch[0].length);
  }

  // Conditionally include optional properties to satisfy exactOptionalPropertyTypes.
  const ref: NodeRef = { id };
  if (shape !== undefined) ref.shape = shape;
  if (label !== undefined) ref.label = label;
  if (role !== undefined) ref.role = role;
  return { ref, rest: cursor };
}

export function parseFlow(source: string): FlowParseResult {
  const nodes = new Map<string, FlowNode>();
  const edges: FlowGraph["edges"] = [];
  let direction: FlowDirection = "TD";

  const graphOf = (): FlowGraph => ({
    kind: "flow",
    nodes: [...nodes.values()],
    edges,
    direction,
  });

  const fail = (line: number, message: string): FlowParseResult => ({
    graph: graphOf(),
    error: { line, message },
  });

  const upsert = (ref: NodeRef): void => {
    const existing = nodes.get(ref.id);
    if (!existing) {
      const node: FlowNode = { id: ref.id };
      if (ref.label !== undefined) node.label = ref.label;
      if (ref.shape !== undefined) node.shape = ref.shape;
      if (ref.role !== undefined) node.role = ref.role;
      nodes.set(ref.id, node);
      return;
    }
    if (ref.label !== undefined && existing.label === undefined) existing.label = ref.label;
    if (ref.shape !== undefined && existing.shape === undefined) existing.shape = ref.shape;
    if (ref.role !== undefined && existing.role === undefined) existing.role = ref.role;
  };

  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    // noUncheckedIndexedAccess: loop stays within bounds; assertion is safe.
    const raw = ((lines[i] ?? "").split("#")[0] ?? "").trim();
    if (raw === "") continue;

    const dirMatch = /^(?:flow(?:chart)?\s+)?(TD|LR)$/i.exec(raw);
    if (dirMatch) {
      direction = (dirMatch[1] ?? "TD").toUpperCase() as FlowDirection;
      continue;
    }
    if (/^flow(?:chart)?$/i.test(raw)) continue;

    const coloredIdx = raw.indexOf("==>");
    const plainIdx = raw.indexOf("-->");
    const arrowIdx = coloredIdx !== -1 ? coloredIdx : plainIdx;
    if (arrowIdx !== -1) {
      const colored = coloredIdx !== -1;
      const left = parseNodeRef(raw.slice(0, arrowIdx));
      const arrow = colored ? "==>" : "-->";
      if (!left) return fail(lineNumber, `left side of ${arrow} is not a valid node`);
      let afterArrow = raw.slice(arrowIdx + 3).trimStart();

      let edgeLabel: string | undefined;
      if (afterArrow.startsWith("|")) {
        const close = afterArrow.indexOf("|", 1);
        if (close === -1) return fail(lineNumber, `edge label is missing a closing "|"`);
        const lbl = afterArrow.slice(1, close).trim();
        if (lbl) edgeLabel = lbl;
        afterArrow = afterArrow.slice(close + 1).trimStart();
      }

      const right = parseNodeRef(afterArrow);
      if (!right) return fail(lineNumber, `right side of ${arrow} is not a valid node`);
      if (right.rest.trim() !== "") {
        return fail(lineNumber, `unexpected "${right.rest.trim()}" after the edge target`);
      }

      upsert(left.ref);
      upsert(right.ref);
      const edge: FlowGraph["edges"][number] = { from: left.ref.id, to: right.ref.id };
      if (edgeLabel !== undefined) edge.label = edgeLabel;
      if (colored) edge.colored = true;
      edges.push(edge);
      continue;
    }

    const node = parseNodeRef(raw);
    if (!node || node.rest.trim() !== "") {
      return fail(lineNumber, `could not parse "${raw}" — expected a node or an --> edge`);
    }
    upsert(node.ref);
  }

  return { graph: graphOf(), error: null };
}
