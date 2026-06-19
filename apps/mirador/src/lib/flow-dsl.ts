/**
 * mirador flow DSL — a tiny, forgiving line-based language for describing a
 * flowchart, parsed into a rama `FlowGraph`. It mirrors the Mermaid subset the
 * JOYCO logs actually use (boxes, stadium terminals, diamonds, cylinders,
 * directed edges, optional edge labels), so log illustrations can be authored
 * programmatically.
 *
 * Grammar (one statement per line, `#` starts a comment, blank lines ignored):
 *
 *   flow TD | flow LR          set the layout direction (top-down / left-right).
 *                              Optional; defaults to TD. Must precede edges.
 *   <node> --> <node>          a directed edge. Each side is a node ref (below).
 *   <node> -->|label| <node>   a directed edge carrying a label.
 *   <node>                     declare a node on its own line (optional — nodes
 *                              are also auto-declared the first time they appear
 *                              in an edge).
 *
 * A node ref is `id` plus an optional inline shape+label the FIRST time the id
 * appears (later refs can be just the id):
 *
 *   id["label"]    box (default)        id(["label"])  stadium / terminal
 *   id{"label"}    diamond / decision   id[("label")]  cylinder / store
 *
 * A role may be appended after a node decl as `:role` (primary|good|bad|
 * pending|streamed|neutral) to color it semantically, e.g. `B["slow"]:bad`.
 *
 * Errors are reported with a 1-based line number and a friendly message; the
 * caller keeps the last good graph rendered.
 */

import type { FlowDirection, FlowGraph, FlowNode, NodeShape, SemanticRole } from "rama";

export interface FlowParseError {
  line: number;
  message: string;
}

export interface FlowParseResult {
  graph: FlowGraph;
  error: FlowParseError | null;
}

const ROLES: ReadonlySet<string> = new Set([
  "primary",
  "good",
  "bad",
  "pending",
  "streamed",
  "neutral",
]);

/** Parse a single node ref like `A`, `A["label"]`, `B{"decide"}:bad`. */
interface NodeRef {
  id: string;
  shape?: NodeShape;
  label?: string;
  role?: SemanticRole;
}

/**
 * Match a node ref at the START of a string, returning the ref and the rest.
 * Shapes are tried longest-delimiter-first so `[(` (cylinder) wins over `[`.
 */
const SHAPE_DELIMS: Array<{ open: string; close: string; shape: NodeShape }> = [
  { open: "([", close: "])", shape: "stadium" },
  { open: "[(", close: ")]", shape: "cylinder" },
  { open: "{", close: "}", shape: "diamond" },
  { open: "[", close: "]", shape: "box" },
];

function parseNodeRef(input: string): { ref: NodeRef; rest: string } | null {
  const trimmed = input.trimStart();
  // id = leading run of word-ish chars.
  const idMatch = /^[A-Za-z0-9_]+/.exec(trimmed);
  if (!idMatch) return null;
  const id = idMatch[0];
  let cursor = trimmed.slice(id.length);

  let shape: NodeShape | undefined;
  let label: string | undefined;

  for (const { open, close, shape: s } of SHAPE_DELIMS) {
    if (cursor.startsWith(open)) {
      const end = cursor.indexOf(close, open.length);
      if (end === -1) return null; // unterminated shape → let caller error
      let inner = cursor.slice(open.length, end).trim();
      // strip optional surrounding quotes
      if (
        (inner.startsWith('"') && inner.endsWith('"')) ||
        (inner.startsWith("'") && inner.endsWith("'"))
      ) {
        inner = inner.slice(1, -1);
      }
      shape = s;
      label = inner || undefined;
      cursor = cursor.slice(end + close.length);
      break;
    }
  }

  // optional :role suffix
  let role: SemanticRole | undefined;
  const roleMatch = /^:([a-z]+)/.exec(cursor);
  if (roleMatch && ROLES.has(roleMatch[1])) {
    role = roleMatch[1] as SemanticRole;
    cursor = cursor.slice(roleMatch[0].length);
  }

  return { ref: { id, shape, label, role }, rest: cursor };
}

export function parseFlow(source: string): FlowParseResult {
  const nodes = new Map<string, FlowNode>();
  const edges: FlowGraph["edges"] = [];
  let direction: FlowDirection = "TD";

  const graphOf = (): FlowGraph => ({
    kind: "flow",
    nodes: [...nodes.values()],
    edges,
    // direction rides along via options at layout time; kept here for the app.
    ...({ direction } as Record<string, unknown>),
  });

  const fail = (line: number, message: string): FlowParseResult => ({
    graph: graphOf(),
    error: { line, message },
  });

  /** Merge a ref into the node table; first decl with a shape/label/role wins. */
  const upsert = (ref: NodeRef): void => {
    const existing = nodes.get(ref.id);
    if (!existing) {
      nodes.set(ref.id, {
        id: ref.id,
        ...(ref.label !== undefined ? { label: ref.label } : {}),
        ...(ref.shape !== undefined ? { shape: ref.shape } : {}),
        ...(ref.role !== undefined ? { role: ref.role } : {}),
      });
      return;
    }
    if (ref.label !== undefined && existing.label === undefined) existing.label = ref.label;
    if (ref.shape !== undefined && existing.shape === undefined) existing.shape = ref.shape;
    if (ref.role !== undefined && existing.role === undefined) existing.role = ref.role;
  };

  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const raw = lines[i].split("#")[0].trim();
    if (raw === "") continue;

    // Direction directive: `flow TD` / `flowchart LR` / bare `TD`.
    const dirMatch = /^(?:flow(?:chart)?\s+)?(TD|LR)$/i.exec(raw);
    if (dirMatch) {
      direction = dirMatch[1].toUpperCase() as FlowDirection;
      continue;
    }
    if (/^flow(?:chart)?$/i.test(raw)) continue; // bare `flow` keyword, no dir

    // Edge: <ref> --> [|label|] <ref>
    const arrowIdx = raw.indexOf("-->");
    if (arrowIdx !== -1) {
      const left = parseNodeRef(raw.slice(0, arrowIdx));
      if (!left) return fail(lineNumber, "left side of --> is not a valid node");
      let afterArrow = raw.slice(arrowIdx + 3).trimStart();

      // optional |label|
      let edgeLabel: string | undefined;
      if (afterArrow.startsWith("|")) {
        const close = afterArrow.indexOf("|", 1);
        if (close === -1) return fail(lineNumber, "edge label is missing a closing “|”");
        edgeLabel = afterArrow.slice(1, close).trim() || undefined;
        afterArrow = afterArrow.slice(close + 1).trimStart();
      }

      const right = parseNodeRef(afterArrow);
      if (!right) return fail(lineNumber, "right side of --> is not a valid node");
      if (right.rest.trim() !== "") {
        return fail(lineNumber, `unexpected “${right.rest.trim()}” after the edge target`);
      }

      upsert(left.ref);
      upsert(right.ref);
      edges.push({
        from: left.ref.id,
        to: right.ref.id,
        ...(edgeLabel !== undefined ? { label: edgeLabel } : {}),
      });
      continue;
    }

    // Bare node declaration.
    const node = parseNodeRef(raw);
    if (!node || node.rest.trim() !== "") {
      return fail(lineNumber, `could not parse “${raw}” — expected a node or an --> edge`);
    }
    upsert(node.ref);
  }

  return { graph: graphOf(), error: null };
}

/**
 * Seed flowchart for the initial render — a real fan-out/fan-in from JOYCO log
 * 07 ("Don't await. Forward."): a request fans out to parallel work that fans
 * back into a single streaming node. Produces a multi-layer graph with mixed
 * shapes and semantic roles so the first paint is a non-trivial illustration.
 */
export const SEED_FLOW = `# mirador — flowchart mode
# nodes: id["box"] ([stadium]) {diamond} [(cylinder)] ; optional :role
flow TD

A(["Request arrives"]):primary --> B["getCart() started"]:pending
A --> C["getFlags() started"]:pending
A --> D["Render shell immediately"]:streamed
B --> E["Stream data as promises settle"]:good
C --> E
D --> E
`;

/** The layout direction parsed from a flow source (the app reads this back). */
export function directionOf(graph: FlowGraph): FlowDirection {
  const d = (graph as unknown as { direction?: FlowDirection }).direction;
  return d === "LR" ? "LR" : "TD";
}
