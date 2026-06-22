/**
 * Public sequence DSL parser — a tiny, forgiving line-based language for a
 * sequence diagram, parsed into a `SequenceGraph`.
 *
 * Grammar (one statement per line, `#` starts a comment, blank lines ignored):
 *
 *   sequence                     optional header keyword (ignored).
 *   participant A ["Alice"]:good declare a participant (label/role optional).
 *   A ->> B : message            a synchronous message.
 *   A -->> B : message           an asynchronous message (dashed).
 *   A ->> A : note               a self-message (from === to).
 *   Note over A,B : text         a note spanning participants A..B.
 *
 * Participants are also auto-declared the first time they appear in a message,
 * in first-appearance order (which sets their column order). Labels may be
 * quoted; `\n` / `<br>` inside a label become line breaks. Errors carry a
 * 1-based line number and the caller keeps the last good graph.
 */

import type {
  MessageKind,
  ParseError,
  SemanticRole,
  SequenceGraph,
  SequenceMessage,
  SequenceNote,
  SequenceParticipant,
} from "./types.js";

export interface SequenceParseResult {
  graph: SequenceGraph;
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

/** Index of `needle` in `s` outside any double-quoted span, or -1. */
function indexOutsideQuotes(s: string, needle: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && (i === 0 || s[i - 1] !== "\\")) inQuote = !inQuote;
    if (!inQuote && s.startsWith(needle, i)) return i;
  }
  return -1;
}

/** Convert `\n` and `<br>` in a label to real newlines (multi-line support). */
function normalizeBreaks(label: string): string {
  // `\n` lowercase-only; `<br>` case-insensitive (Mermaid compatibility).
  return label.replace(/\\n/g, "\n").replace(/<br\s*\/?>/gi, "\n");
}

/** Strip optional surrounding quotes and unescape `\"`. */
function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\"/g, '"');
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  return t;
}

/**
 * Message arrow tokens, longest first so `-->>` is matched before `->>`.
 * `async` selects a dashed line.
 */
const ARROW_TOKENS: ReadonlyArray<{ token: string; async: boolean }> = [
  { token: "-->>", async: true },
  { token: "->>", async: false },
];

function findArrow(raw: string): { index: number; token: string; async: boolean } | null {
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"' && (i === 0 || raw[i - 1] !== "\\")) inQuote = !inQuote;
    if (inQuote) continue;
    for (const t of ARROW_TOKENS) {
      if (raw.startsWith(t.token, i)) return { index: i, token: t.token, async: t.async };
    }
  }
  return null;
}

/** Parse a participant ref: `id`, `id ["label"]`, with an optional `:role`. */
function parseParticipantRef(
  input: string,
): { id: string; label?: string; role?: SemanticRole } | null {
  const trimmed = input.trim();
  const idMatch = /^[A-Za-z0-9_]+/.exec(trimmed);
  if (!idMatch) return null;
  const id = idMatch[0]!;
  let cursor = trimmed.slice(id.length).trim();

  let label: string | undefined;
  if (cursor.startsWith("[")) {
    const end = indexOutsideQuotes(cursor.slice(1), "]");
    if (end !== -1) {
      const inner = unquote(cursor.slice(1, 1 + end));
      if (inner) label = normalizeBreaks(inner);
      cursor = cursor.slice(1 + end + 1).trim();
    }
  }

  let role: SemanticRole | undefined;
  const roleMatch = /^:([a-z]+)/.exec(cursor);
  if (roleMatch && ROLES.has(roleMatch[1] ?? "")) {
    role = roleMatch[1] as SemanticRole;
    cursor = cursor.slice(roleMatch[0].length).trim();
  }
  if (cursor !== "") return null; // trailing garbage
  const ref: { id: string; label?: string; role?: SemanticRole } = { id };
  if (label !== undefined) ref.label = label;
  if (role !== undefined) ref.role = role;
  return ref;
}

export function parseSequence(source: string): SequenceParseResult {
  const participants = new Map<string, SequenceParticipant>();
  const order: string[] = [];
  const messages: SequenceMessage[] = [];
  const notes: SequenceNote[] = [];

  const graphOf = (): SequenceGraph => {
    const graph: SequenceGraph = {
      kind: "sequence",
      participants: order.map((id) => participants.get(id) as SequenceParticipant),
      messages,
    };
    if (notes.length > 0) graph.notes = notes;
    return graph;
  };

  const fail = (line: number, message: string): SequenceParseResult => ({
    graph: graphOf(),
    error: { line, message },
  });

  const upsert = (ref: { id: string; label?: string; role?: SemanticRole }): void => {
    const existing = participants.get(ref.id);
    if (!existing) {
      const p: SequenceParticipant = { id: ref.id };
      if (ref.label !== undefined) p.label = ref.label;
      if (ref.role !== undefined) p.role = ref.role;
      participants.set(ref.id, p);
      order.push(ref.id);
      return;
    }
    if (ref.label !== undefined && existing.label === undefined) existing.label = ref.label;
    if (ref.role !== undefined && existing.role === undefined) existing.role = ref.role;
  };

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i] ?? "";
    const commentIdx = indexOutsideQuotes(line, "#");
    const raw = (commentIdx === -1 ? line : line.slice(0, commentIdx)).trim();
    if (raw === "") continue;

    // Header keyword (ignored).
    if (/^sequence(?:diagram)?$/i.test(raw)) continue;

    // `participant A ["Alice"]:role`
    const partMatch = /^participant\s+(.+)$/i.exec(raw);
    if (partMatch) {
      const ref = parseParticipantRef(partMatch[1]!);
      if (!ref) return fail(lineNumber, `invalid participant declaration`);
      upsert(ref);
      continue;
    }

    // `Note over A,B : text`
    const noteMatch = /^note\s+over\s+([^:]+):(.*)$/i.exec(raw);
    if (noteMatch) {
      const ids = noteMatch[1]!
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      if (ids.length === 0) return fail(lineNumber, `note is missing a participant`);
      notes.push({ over: ids, text: normalizeBreaks(unquote(noteMatch[2]!.trim())) });
      continue;
    }

    // Message: `A ->> B : label` / `A -->> B : label`
    const arrow = findArrow(raw);
    if (arrow) {
      const left = parseParticipantRef(raw.slice(0, arrow.index));
      if (!left) return fail(lineNumber, `left side of ${arrow.token} is not a participant`);
      let rest = raw.slice(arrow.index + arrow.token.length).trim();
      let label: string | undefined;
      const colon = indexOutsideQuotes(rest, ":");
      if (colon !== -1) {
        label = normalizeBreaks(unquote(rest.slice(colon + 1).trim()));
        rest = rest.slice(0, colon).trim();
      }
      const right = parseParticipantRef(rest);
      if (!right) return fail(lineNumber, `right side of ${arrow.token} is not a participant`);
      upsert(left);
      upsert(right);
      // `kind` carries the LINE STYLE (sync/async). Self-ness is geometry the
      // layout derives from `from === to`, so a self-message keeps its
      // sync/async distinction (and an async self-call still renders dashed).
      const kind: MessageKind = arrow.async ? "async" : "sync";
      const message: SequenceMessage = { from: left.id, to: right.id, kind };
      if (label !== undefined && label !== "") message.label = label;
      messages.push(message);
      continue;
    }

    return fail(lineNumber, `could not parse "${raw}" — expected a participant, message, or note`);
  }

  return { graph: graphOf(), error: null };
}
