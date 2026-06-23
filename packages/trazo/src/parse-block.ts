/**
 * Public block DSL parser — a tiny line-based language for a block-grid
 * wireframe (Mermaid's `block-beta`), parsed into a `BlockGraph`.
 *
 * Grammar (one statement per line, `#` starts a comment, blank lines ignored):
 *
 *   block                      optional header keyword (ignored).
 *   columns 2                  set the grid width (number of columns).
 *   A["Nav"] :2                a cell with a column span of 2.
 *   B["Skeleton"]              a span-1 cell.
 *
 * A cell ref mirrors the flow node syntax: `id["label"]`, `id(["label"])`,
 * `id{"label"}`, `id[("label")]`, with an optional `:role` and an optional
 * trailing `:N` span (a bare number). Cells flow left→right and wrap.
 */

import type {
  BlockCell,
  BlockGraph,
  NodeShape,
  ParseError,
  SemanticRole,
} from "./types.js";

export interface BlockParseResult {
  graph: BlockGraph;
  error: ParseError | null;
}

const ROLES: ReadonlySet<string> = new Set([
  "primary",
  "success",
  "error",
  "warning",
  "streamed",
  "neutral",
]);

const SHAPE_DELIMS: ReadonlyArray<{ open: string; close: string; shape: NodeShape }> = [
  { open: "([", close: "])", shape: "stadium" },
  { open: "[(", close: ")]", shape: "cylinder" },
  { open: "{", close: "}", shape: "diamond" },
  { open: "[", close: "]", shape: "box" },
];

function indexOutsideQuotes(s: string, needle: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== "\\")) inQuote = !inQuote;
    if (!inQuote && s.startsWith(needle, i)) return i;
  }
  return -1;
}

function normalizeBreaks(label: string): string {
  // `\n` lowercase-only; `<br>` case-insensitive (Mermaid compatibility).
  return label.replace(/\\n/g, "\n").replace(/<br\s*\/?>/gi, "\n");
}

/** Parse a cell ref with optional shape/label, `:role`, and `:N` span. */
function parseCell(input: string): BlockCell | null {
  const trimmed = input.trim();
  const idMatch = /^[A-Za-z0-9_]+/.exec(trimmed);
  if (!idMatch) return null;
  const id = idMatch[0]!;
  let cursor = trimmed.slice(id.length);

  let shape: NodeShape | undefined;
  let label: string | undefined;
  for (const delim of SHAPE_DELIMS) {
    if (cursor.startsWith(delim.open)) {
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
  let span: number | undefined;
  // Trailing `:role` and/or `:N` (in any order, whitespace allowed).
  while (true) {
    cursor = cursor.trimStart();
    const roleMatch = /^:([a-z]+)/.exec(cursor);
    if (roleMatch && ROLES.has(roleMatch[1] ?? "")) {
      role = roleMatch[1] as SemanticRole;
      cursor = cursor.slice(roleMatch[0].length);
      continue;
    }
    const spanMatch = /^:(\d+)/.exec(cursor);
    if (spanMatch) {
      span = Number.parseInt(spanMatch[1] ?? "1", 10);
      cursor = cursor.slice(spanMatch[0].length);
      continue;
    }
    break;
  }
  if (cursor.trim() !== "") return null; // trailing garbage

  const cell: BlockCell = { id };
  if (shape !== undefined) cell.shape = shape;
  if (label !== undefined) cell.label = label;
  if (role !== undefined) cell.role = role;
  if (span !== undefined) cell.span = span;
  return cell;
}

export function parseBlock(source: string): BlockParseResult {
  const cells: BlockCell[] = [];
  let columns = 1;

  const graphOf = (): BlockGraph => ({ kind: "block", columns, cells });
  const fail = (line: number, message: string): BlockParseResult => ({
    graph: graphOf(),
    error: { line, message },
  });

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i] ?? "";
    const commentIdx = indexOutsideQuotes(line, "#");
    const raw = (commentIdx === -1 ? line : line.slice(0, commentIdx)).trim();
    if (raw === "") continue;

    if (/^block(?:-beta)?$/i.test(raw)) continue;

    const colMatch = /^columns\s+(\d+)$/i.exec(raw);
    if (colMatch) {
      columns = Math.max(1, Number.parseInt(colMatch[1] ?? "1", 10));
      continue;
    }

    const cell = parseCell(raw);
    if (!cell) return fail(lineNumber, `could not parse "${raw}" — expected a cell or "columns N"`);
    cells.push(cell);
  }

  return { graph: graphOf(), error: null };
}
