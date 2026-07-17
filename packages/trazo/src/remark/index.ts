/**
 * trazo remark plugin — validates the flow, git, sequence, and block DSLs inside
 * fenced code blocks in Markdown / MDX, so a malformed diagram fails the build
 * (or shows an editor warning) instead of rendering broken at runtime.
 *
 * This is the MDX counterpart to the `@joycostudio/trazo/eslint` plugin: the
 * ESLint rules validate `flow`…` `` tagged templates and `parseFlow("…")` calls
 * in TS/JS, while this remark plugin validates the same DSLs written as fenced
 * code blocks in prose:
 *
 * ````md
 * ```flow
 * flow LR
 * A(["Start"]):primary ==> B["Process"]
 * ```
 * ````
 *
 * Wire it into any unified / remark / MDX pipeline. With fumadocs-mdx:
 *
 * ```ts
 * // source.config.ts
 * import { remarkTrazo } from "@joycostudio/trazo/remark";
 * export default defineConfig({ mdxOptions: { remarkPlugins: [remarkTrazo] } });
 * ```
 *
 * A fence's info string (`lang`) selects the DSL — `flow`/`flowchart`, `git`,
 * `seq`/`sequence`, `block`. Blocks in any other language are ignored, so it
 * never touches your normal syntax-highlighted code samples.
 *
 * Framework-agnostic: no React, no layout, no dependency on `unist-util-visit`
 * (the mdast tree is walked directly). It only reads nodes and attaches VFile
 * messages, so it composes with any other remark plugins (e.g. a separate
 * transform that renders the same fences into live SVG).
 */

import { parseFlow } from "../parse-flow.js";
import { parseGit } from "../parse-git.js";
import { parseSequence } from "../parse-sequence.js";
import { parseBlock } from "../parse-block.js";
import type { ParseError } from "../types.js";

// ── DSL lang map ──────────────────────────────────────────────────────────────
// Maps a fence info string (lowercased) to the DSL parser and a human label.
// Exported so a rendering transform can share the exact same lang set.

interface RemarkDsl {
  label: string;
  parse(source: string): { error: ParseError | null };
}

/** Fence languages recognised as trazo diagrams, mapped to their parser. */
export const TRAZO_FENCE_LANGS: Readonly<Record<string, RemarkDsl>> = {
  flow: { label: "flow DSL", parse: parseFlow },
  flowchart: { label: "flow DSL", parse: parseFlow },
  git: { label: "git DSL", parse: parseGit },
  seq: { label: "sequence DSL", parse: parseSequence },
  sequence: { label: "sequence DSL", parse: parseSequence },
  block: { label: "block DSL", parse: parseBlock },
};

/**
 * Look up the DSL for a fence info string, or null if it isn't a trazo
 * language. Only the first token of the info string is considered (so
 * ```` ```flow title="x" ```` still resolves to `flow`).
 */
export function dslForLang(lang: string | null | undefined): RemarkDsl | null {
  if (!lang) return null;
  const key = lang.trim().split(/\s+/)[0]?.toLowerCase();
  return (key && TRAZO_FENCE_LANGS[key]) || null;
}

// ── Minimal mdast / vfile type stubs ─────────────────────────────────────────
// Kept local so the core package needs neither @types/mdast nor vfile.

interface Point {
  line: number;
  column: number;
}

interface Position {
  start: Point;
  end: Point;
}

interface MdastNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MdastNode[];
  position?: Position;
}

interface VFileMessage {
  fatal?: boolean | null;
}

interface VFile {
  message(reason: string, place?: Point | Position | null): VFileMessage;
}

export interface RemarkTrazoOptions {
  /**
   * How to surface a DSL parse error.
   *  - `"error"` (default): a fatal VFile message + a thrown positioned error,
   *    so bundlers/CI fail the build on a broken diagram.
   *  - `"warn"`: a non-fatal VFile message only (editor squiggle, no build break).
   */
  severity?: "error" | "warn";
  /**
   * Override the recognised fence languages. Defaults to the keys of
   * {@link TRAZO_FENCE_LANGS} (`flow`, `flowchart`, `git`, `seq`, `sequence`, `block`).
   */
  langs?: readonly string[];
}

// ── Plugin ────────────────────────────────────────────────────────────────────

/**
 * remark plugin attacher. Validates every trazo fenced code block and, by
 * default, fails the build on the first parse error with a source-accurate
 * position; every error found is also recorded as a VFile message.
 */
export function remarkTrazo(options: RemarkTrazoOptions = {}) {
  const severity = options.severity ?? "error";
  const allowed = options.langs
    ? new Set(options.langs.map((l) => l.toLowerCase()))
    : null;

  return function transformer(tree: MdastNode, file: VFile): void {
    let firstFatal: (VFileMessage & Error) | null = null;

    walk(tree, (node) => {
      if (node.type !== "code") return;
      const dsl = dslForLang(node.lang);
      if (!dsl) return;
      if (allowed && !allowed.has((node.lang ?? "").trim().split(/\s+/)[0]!.toLowerCase())) return;

      const { error } = dsl.parse(node.value ?? "");
      if (!error) return;

      // The fence's opening line holds the info string; DSL content begins on
      // the next line, so DSL line N maps to absolute line = fenceLine + N.
      const fenceLine = node.position?.start.line ?? 1;
      const point: Point = { line: fenceLine + error.line, column: 1 };
      const message = file.message(
        `trazo ${dsl.label} line ${error.line}: ${error.message}`,
        point,
      ) as VFileMessage & Error;
      message.fatal = severity === "error";
      if (severity === "error" && !firstFatal) firstFatal = message;
    });

    // Throwing the first fatal message rejects the unified run so the build
    // fails; the remaining errors stay attached to `file.messages` for report.
    if (firstFatal) throw firstFatal;
  };
}

/** Depth-first mdast walk — avoids an `unist-util-visit` dependency. */
function walk(node: MdastNode, visit: (node: MdastNode) => void): void {
  visit(node);
  if (node.children) for (const child of node.children) walk(child, visit);
}

export default remarkTrazo;
