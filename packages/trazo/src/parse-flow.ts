/**
 * Public flow DSL parser — a tiny, forgiving line-based language for describing
 * a flowchart, parsed into a `FlowGraph`.
 *
 * Grammar (one statement per line, `#` starts a comment, blank lines ignored):
 *
 *   flow TD | flow LR          set the layout direction (default: TD).
 *   <node> --> <node>          neutral directed edge (accent color).
 *   <node> ==> <node>          colored directed edge (source node's role color).
 *   <node> <-- <node>          reversed arrow: head at the SOURCE (`from ← to`),
 *                              still `from → to` for layout (a "based on" edge).
 *   <node> <== <node>          reversed colored arrow.
 *   <node> --- <node>          undirected edge (no arrowhead, neutral).
 *   <node> === <node>          undirected colored edge.
 *   <node> <--> <node>         bidirectional edge (arrowhead at both ends).
 *   <node> <==> <node>         bidirectional colored edge.
 *   <node> -->|label| <node>   edge with a label (works with every arrow above).
 *   <node>                     bare node declaration.
 *   subgraph G ["Label"]       open a cluster; nodes declared until `end` join it.
 *   end                        close the current cluster.
 *   note <id> <side> "<text>"  a margin annotation on <id>, one of the four
 *                              sides above|below|left|right, with a leader arrow
 *                              pointing at that face. An optional trailing
 *                              `:role` tints the note chip. Excluded from ranking
 *                              (never moves a real node).
 *
 * Subgraphs are single-level (no nesting). A node belongs to at most one group
 * (the first that declares it wins). Multi-line labels: a literal `\n` or `<br>`
 * inside a label becomes a line break.
 *
 * Node ref syntax: `id["label"]`, `id(["label"])`, `id{"label"}`, `id[("label")]`
 * with an optional `:role` suffix (primary|success|error|warning|info|neutral).
 *
 * Labels may contain any characters including `#`, `]`, `-->`, `==>`, and `|`.
 * Use `\"` to embed a double-quote inside a label (backslash-escape).
 *
 * The parsed direction is stored on `graph.direction` so `layoutFlow` can pick
 * it up automatically without extra options.
 */

import type {
  ArrowEnds,
  FlowDirection,
  FlowGraph,
  FlowGroup,
  FlowNode,
  FlowNote,
  NodeShape,
  NoteSide,
  ParseError,
  SemanticRole,
} from "./types.js";
import { SEMANTIC_ROLES } from "./types.js";

export interface FlowParseResult {
  graph: FlowGraph;
  error: ParseError | null;
}

const ROLES: ReadonlySet<string> = new Set(SEMANTIC_ROLES);

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

/**
 * Returns the index of the first occurrence of `needle` in `s` that is not
 * inside a double-quoted span. Backslash-escaped quotes (`\"`) are honoured
 * and do not toggle the in-quote state. Returns -1 if not found.
 */
function indexOutsideQuotes(s: string, needle: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== "\\")) inQuote = !inQuote;
    if (!inQuote && s.startsWith(needle, i)) return i;
  }
  return -1;
}

/**
 * Arrow tokens, longest first so a longer token is preferred when several match
 * at the same position (`<-->` before `<--`/`-->`, `---`/`===` before
 * `-->`/`==>`). `colored` selects the source-role color; `arrow` selects which
 * ends get a head. `<--`/`<==` are REVERSED arrows: the edge still flows
 * `from → to` for layout, but the head points back at the source (`from ← to`),
 * for "based on" / child→parent relations that read right-to-left.
 */
const ARROW_TOKENS: ReadonlyArray<{ token: string; colored: boolean; arrow: ArrowEnds }> = [
  { token: "<==>", colored: true, arrow: "both" },
  { token: "<-->", colored: false, arrow: "both" },
  { token: "<==", colored: true, arrow: "start" },
  { token: "<--", colored: false, arrow: "start" },
  { token: "-->", colored: false, arrow: "end" },
  { token: "==>", colored: true, arrow: "end" },
  { token: "---", colored: false, arrow: "none" },
  { token: "===", colored: true, arrow: "none" },
];

/**
 * The first arrow token in `raw` that is not inside a quoted span. Scans
 * left-to-right; at each position the longest matching token from `ARROW_TOKENS`
 * wins. Returns its index + the resolved `colored`/`arrow` semantics, or null
 * when the line has no arrow (a bare node declaration).
 */
function findArrow(
  raw: string,
): { index: number; token: string; colored: boolean; arrow: ArrowEnds } | null {
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"' && (i === 0 || raw[i - 1] !== "\\")) inQuote = !inQuote;
    if (inQuote) continue;
    for (const t of ARROW_TOKENS) {
      if (raw.startsWith(t.token, i)) {
        return { index: i, token: t.token, colored: t.colored, arrow: t.arrow };
      }
    }
  }
  return null;
}

/**
 * Convert explicit line breaks in a label to real newlines: a literal two-char
 * `\n` sequence (the DSL is single-line, so authors type a backslash-n) and a
 * `<br>` / `<br/>` tag (Mermaid compatibility). The layout sizes the box to the
 * widest line and the renderer stacks the lines as `<tspan>` rows.
 */
function normalizeBreaks(label: string): string {
  // `\n` is lowercase-only (so `\N` in a label like `C:\Newdir` is preserved);
  // `<br>` is case-insensitive for Mermaid compatibility.
  return label.replace(/\\n/g, "\n").replace(/<br\s*\/?>/gi, "\n");
}

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
      // Search for the closing delimiter outside any quoted span so that
      // labels like `id["step ] done"]` don't terminate early on the inner `]`.
      const searchIn = cursor.slice(delim.open.length);
      const relEnd = indexOutsideQuotes(searchIn, delim.close);
      if (relEnd === -1) return null;
      const end = delim.open.length + relEnd;
      let inner = cursor.slice(delim.open.length, end).trim();
      if (inner.startsWith('"') && inner.endsWith('"')) {
        inner = inner.slice(1, -1).replace(/\\"/g, '"');
      } else if (inner.startsWith("'") && inner.endsWith("'")) {
        inner = inner.slice(1, -1);
      }
      shape = delim.shape;
      if (inner) label = normalizeBreaks(inner);
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

const NOTE_SIDES: ReadonlySet<string> = new Set<NoteSide>(["above", "below", "left", "right"]);

/**
 * Parse the body of a `note <id> <side> …` line — the text after the side
 * keyword — into its label and optional trailing `:role`. The text is either a
 * `"double"` / `'single'` quoted span (quotes stripped, `\"` un-escaped) or a
 * bare run to end-of-line. A `:role` suffix (validated against {@link ROLES})
 * may follow the closing quote or trail a bare run. Returns null on an unclosed
 * quote or trailing junk after the text. `\n`/`<br>` breaks are normalized like
 * every other label. Pure.
 */
function parseNoteBody(rest: string): { label: string; role?: SemanticRole } | null {
  const s = rest.trim();
  if (s === "") return null;

  let label: string;
  let after: string;
  if (s.startsWith('"')) {
    // First unescaped closing quote (a `\"` inside the text does not close it).
    let close = -1;
    for (let i = 1; i < s.length; i++) {
      if (s[i] === '"' && s[i - 1] !== "\\") {
        close = i;
        break;
      }
    }
    if (close === -1) return null;
    label = s.slice(1, close).replace(/\\"/g, '"');
    after = s.slice(close + 1);
  } else if (s.startsWith("'")) {
    const close = s.indexOf("'", 1);
    if (close === -1) return null;
    label = s.slice(1, close);
    after = s.slice(close + 1);
  } else {
    // Bare text: peel an optional trailing `:role` token off the end so the
    // label doesn't swallow it; otherwise the whole run is the label.
    const roleAtEnd = /\s+:([a-z]+)\s*$/.exec(s);
    if (roleAtEnd && ROLES.has(roleAtEnd[1] ?? "")) {
      label = s.slice(0, roleAtEnd.index).trim();
      after = ` :${roleAtEnd[1]}`;
    } else {
      label = s;
      after = "";
    }
  }

  let role: SemanticRole | undefined;
  const roleMatch = /^\s*:([a-z]+)\s*$/.exec(after);
  if (roleMatch && ROLES.has(roleMatch[1] ?? "")) {
    role = roleMatch[1] as SemanticRole;
  } else if (after.trim() !== "") {
    return null; // unexpected trailing content after the note text
  }

  if (label === "") return null;
  const body: { label: string; role?: SemanticRole } = { label: normalizeBreaks(label) };
  if (role !== undefined) body.role = role;
  return body;
}

export function parseFlow(source: string): FlowParseResult {
  const nodes = new Map<string, FlowNode>();
  const edges: FlowGraph["edges"] = [];
  const groups = new Map<string, FlowGroup>();
  const notes: FlowNote[] = [];
  let direction: FlowDirection = "TD";
  // The cluster currently being declared (between `subgraph` and `end`).
  let currentGroup: string | undefined;

  const graphOf = (): FlowGraph => {
    const graph: FlowGraph = {
      kind: "flow",
      nodes: [...nodes.values()],
      edges,
      direction,
    };
    if (groups.size > 0) graph.groups = [...groups.values()];
    if (notes.length > 0) graph.notes = notes;
    return graph;
  };

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
      // A node first declared inside an open subgraph joins that group.
      if (currentGroup !== undefined) node.group = currentGroup;
      nodes.set(ref.id, node);
      return;
    }
    if (ref.label !== undefined && existing.label === undefined) existing.label = ref.label;
    if (ref.shape !== undefined && existing.shape === undefined) existing.shape = ref.shape;
    if (ref.role !== undefined && existing.role === undefined) existing.role = ref.role;
    // First group to claim a node wins (mirrors first-writer-wins above).
    if (currentGroup !== undefined && existing.group === undefined) existing.group = currentGroup;
  };

  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    // Strip comments only outside quoted spans so `id["label #1"]` survives.
    const line = lines[i] ?? "";
    const commentIdx = indexOutsideQuotes(line, "#");
    const raw = (commentIdx === -1 ? line : line.slice(0, commentIdx)).trim();
    if (raw === "") continue;

    const dirMatch = /^flow(?:chart)?\s+(TD|LR)$/i.exec(raw);
    if (dirMatch) {
      direction = (dirMatch[1] ?? "TD").toUpperCase() as FlowDirection;
      continue;
    }
    if (/^flow(?:chart)?$/i.test(raw)) continue;

    // ── Subgraph block ────────────────────────────────────────────────────
    // `end` closes the open cluster.
    if (/^end$/i.test(raw)) {
      if (currentGroup === undefined) return fail(lineNumber, `"end" with no open subgraph`);
      currentGroup = undefined;
      continue;
    }
    // `subgraph G ["Label"]` opens a cluster. Single-level only.
    const subgraphMatch = /^subgraph\s+([A-Za-z0-9_]+)\s*(.*)$/i.exec(raw);
    if (subgraphMatch) {
      if (currentGroup !== undefined) {
        return fail(lineNumber, `nested subgraphs are not supported`);
      }
      const groupId = subgraphMatch[1]!;
      const rest = (subgraphMatch[2] ?? "").trim();
      let groupLabel: string | undefined;
      if (rest !== "") {
        // Title is an optional `["Label"]` / `[Label]` / bare quoted string.
        let inner = rest;
        const boxed = /^\[(.*)\]$/.exec(rest);
        if (boxed) inner = boxed[1]!.trim();
        if (
          (inner.startsWith('"') && inner.endsWith('"')) ||
          (inner.startsWith("'") && inner.endsWith("'"))
        ) {
          inner = inner.slice(1, -1).replace(/\\"/g, '"');
        }
        if (inner) groupLabel = normalizeBreaks(inner);
      }
      const group: FlowGroup = { id: groupId };
      if (groupLabel !== undefined) group.label = groupLabel;
      // First declaration of a group id wins its label.
      if (!groups.has(groupId)) groups.set(groupId, group);
      currentGroup = groupId;
      continue;
    }

    // ── Annotation (`note`) ───────────────────────────────────────────────
    // `note <id> <side> "<text>" [:role]`. Matched strictly (the side keyword is
    // required) so a node literally named `note` — a valid id — still parses as a
    // node/edge on any other line. The target need not be declared yet; forward
    // references resolve at layout time (upsert is order-independent), and an
    // unknown target is dropped there, mirroring an edge to an unknown node.
    const noteMatch = /^note\s+([A-Za-z0-9_]+)\s+(above|below|left|right)\s+(.+)$/i.exec(raw);
    if (noteMatch) {
      const target = noteMatch[1]!;
      const side = (noteMatch[2] ?? "").toLowerCase() as NoteSide;
      const body = parseNoteBody(noteMatch[3] ?? "");
      if (!body) {
        return fail(lineNumber, `note on "${target}" has an invalid or empty "<text>"`);
      }
      // NOTE_SIDES is redundant with the regex alternation but keeps the side
      // union and the accepted keywords from silently drifting apart.
      if (!NOTE_SIDES.has(side)) return fail(lineNumber, `unknown note side "${side}"`);
      const note: FlowNote = { target, side, label: body.label };
      if (body.role !== undefined) note.role = body.role;
      notes.push(note);
      continue;
    }

    // Arrow detection skips quoted spans so `id["A --> B"]` isn't treated as
    // an edge and `id["x==>y"] --> id2` picks up the real `-->`. Scan the line
    // left-to-right and take the FIRST arrow token; at a given position the
    // LONGEST matching token wins so `<-->` isn't read as `-->` and `===` isn't
    // read as `==>`. `colored` follows the `=` family; `arrow` (none/end/both)
    // follows the head shape.
    const arrowMatch = findArrow(raw);
    if (arrowMatch) {
      const { index: arrowIdx, token, colored, arrow } = arrowMatch;
      const left = parseNodeRef(raw.slice(0, arrowIdx));
      if (!left) return fail(lineNumber, `left side of ${token} is not a valid node`);
      let afterArrow = raw.slice(arrowIdx + token.length).trimStart();

      let edgeLabel: string | undefined;
      if (afterArrow.startsWith("|")) {
        // Find the closing `|` outside any quoted span so that a label like
        // `|step "a|b"|` doesn't close on the inner `|`.
        const closeOffset = indexOutsideQuotes(afterArrow.slice(1), "|");
        if (closeOffset === -1) return fail(lineNumber, `edge label is missing a closing "|"`);
        const close = closeOffset + 1;
        // Strip a single pair of surrounding quotes, mirroring node labels
        // (`parseNodeRef`) — otherwise `|"base of"|` renders the quotes literally.
        // The quotes still let an inner `|` through (`indexOutsideQuotes` above),
        // so `|"a | b"|` yields `a | b`; bare `|base of|` is unchanged.
        let lbl = afterArrow.slice(1, close).trim();
        if (lbl.startsWith('"') && lbl.endsWith('"') && lbl.length >= 2) {
          lbl = lbl.slice(1, -1).replace(/\\"/g, '"');
        } else if (lbl.startsWith("'") && lbl.endsWith("'") && lbl.length >= 2) {
          lbl = lbl.slice(1, -1);
        }
        if (lbl) edgeLabel = normalizeBreaks(lbl);
        afterArrow = afterArrow.slice(close + 1).trimStart();
      }

      const right = parseNodeRef(afterArrow);
      if (!right) return fail(lineNumber, `right side of ${token} is not a valid node`);
      if (right.rest.trim() !== "") {
        return fail(lineNumber, `unexpected "${right.rest.trim()}" after the edge target`);
      }

      upsert(left.ref);
      upsert(right.ref);
      const edge: FlowGraph["edges"][number] = { from: left.ref.id, to: right.ref.id };
      if (edgeLabel !== undefined) edge.label = edgeLabel;
      if (colored) edge.colored = true;
      // Default arrow ("end") is left implicit so existing output is unchanged;
      // only record an explicit non-default head.
      if (arrow !== "end") edge.arrow = arrow;
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
