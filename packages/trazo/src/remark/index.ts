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
 * To actually *render* those fences (not just validate), pair it with — or use
 * instead — {@link remarkTrazoRender}, the companion transform that rewrites each
 * trazo fence into a configurable MDX JSX element (the ```` ```mermaid `` →
 * `<Mermaid>` pattern), forwarding fence meta as props and optionally numbering
 * diagrams. The consumer owns the React component; the transform only builds the
 * JSX node. `remarkTrazoRender` is MDX-only (it emits `mdxJsxFlowElement`); the
 * validator also works on plain Markdown.
 *
 * Framework-agnostic: no React, no layout, no dependency on `unist-util-visit`
 * (the mdast tree is walked directly).
 */

import { parseFlow } from "../parse-flow.js";
import { parseGit } from "../parse-git.js";
import { parseSequence } from "../parse-sequence.js";
import { parseBlock } from "../parse-block.js";
import type { ParseError } from "../types.js";

// ── DSL lang map ──────────────────────────────────────────────────────────────
// Maps a fence info string (lowercased) to the DSL parser and a human label.
// Exported so a rendering transform can share the exact same lang set.

/** The four canonical DSL kinds, emitted as the `lang` attribute by the renderer. */
export type TrazoDslKind = "flow" | "git" | "seq" | "block";

interface RemarkDsl {
  label: string;
  /** Canonical kind, independent of the fence alias (`flowchart` → `flow`). */
  kind: TrazoDslKind;
  parse(source: string): { error: ParseError | null };
}

/** Fence languages recognised as trazo diagrams, mapped to their parser. */
export const TRAZO_FENCE_LANGS: Readonly<Record<string, RemarkDsl>> = {
  flow: { label: "flow DSL", kind: "flow", parse: parseFlow },
  flowchart: { label: "flow DSL", kind: "flow", parse: parseFlow },
  git: { label: "git DSL", kind: "git", parse: parseGit },
  seq: { label: "sequence DSL", kind: "seq", parse: parseSequence },
  sequence: { label: "sequence DSL", kind: "seq", parse: parseSequence },
  block: { label: "block DSL", kind: "block", parse: parseBlock },
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
  /** The fence info-string tokens after the language (e.g. `title="x" ascii`). */
  meta?: string | null;
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

// ── Render transform ──────────────────────────────────────────────────────────
// Companion to the validator: rewrites each trazo fence into a configurable MDX
// JSX element (mermaid's ```` ```mermaid `` → `<Mermaid>` pattern), leaving the
// actual React component to the consumer. MDX-only — it emits `mdxJsxFlowElement`
// nodes, which the plain-Markdown validator never needs.

export interface RemarkTrazoRenderOptions {
  /** JSX component name each fence becomes. Default `"TrazoDiagram"`. */
  componentName?: string;
  /**
   * Override the recognised fence languages. Defaults to the keys of
   * {@link TRAZO_FENCE_LANGS} (`flow`, `flowchart`, `git`, `seq`, `sequence`, `block`).
   */
  langs?: readonly string[];
  /**
   * When set, stamp a per-document, document-order sequential number on each
   * emitted element under this prop name (`index={1}`, `index={2}`, …). Null (the
   * default) disables numbering.
   */
  numberAttr?: string | null;
  /**
   * Forward the fence info-string meta after the language as JSX props —
   * `title="…"` → string prop, a bare flag (`ascii`) → `ascii={true}`. Default true.
   */
  passthroughMeta?: boolean;
  /**
   * Parse-error handling, matching {@link remarkTrazo}: `"error"` (default) fails
   * the build with a source-accurate position; `"warn"` records a non-fatal
   * message and leaves the fence as a code block (never an unrenderable element).
   */
  severity?: "error" | "warn";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsxNode = any;

/** A plain string JSX attribute: `name="value"`. */
function stringAttr(name: string, value: string): JsxNode {
  return { type: "mdxJsxAttribute", name, value };
}

/** A boolean-true JSX attribute: bare `name` (`value: null`) → `name={true}` once lowered. */
function booleanAttr(name: string): JsxNode {
  return { type: "mdxJsxAttribute", name, value: null };
}

/** A numeric JSX attribute: `name={n}`, carried as an expression with its estree. */
function numberAttr(name: string, n: number): JsxNode {
  const raw = String(n);
  return {
    type: "mdxJsxAttribute",
    name,
    value: {
      type: "mdxJsxAttributeValueExpression",
      value: raw,
      data: {
        estree: {
          type: "Program",
          sourceType: "module",
          body: [
            { type: "ExpressionStatement", expression: { type: "Literal", value: n, raw } },
          ],
        },
      },
    },
  };
}

/** Thrown by {@link metaAttributes} for malformed fence meta (e.g. an unterminated quote). */
class MetaSyntaxError extends Error {}

const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r";
const isKeyChar = (c: string): boolean => /[A-Za-z0-9_-]/.test(c);

/**
 * Parse a fence's meta string (the tokens after the language) into JSX
 * attributes: `key="v"` / `key='v'` / `key=v` become string props, bare words
 * become boolean-true props. Keys in `reserved` (the ones the transform sets
 * itself) are skipped so they can't be duplicated.
 *
 * A single-pass tokenizer (not a global regex): a `key="…` with no closing quote
 * is a {@link MetaSyntaxError}, not a silent fallback into stray boolean props.
 */
function metaAttributes(meta: string | null | undefined, reserved: Set<string>): JsxNode[] {
  if (!meta) return [];
  const attrs: JsxNode[] = [];
  const n = meta.length;
  let i = 0;
  while (i < n) {
    while (i < n && isSpace(meta.charAt(i))) i++;
    if (i >= n) break;

    const keyStart = i;
    while (i < n && isKeyChar(meta.charAt(i))) i++;
    if (i === keyStart) {
      throw new MetaSyntaxError(`unexpected "${meta.charAt(i)}" in fence meta`);
    }
    const name = meta.slice(keyStart, i);

    let value: string | undefined;
    if (meta.charAt(i) === "=") {
      i++; // consume '='
      const quote = meta.charAt(i);
      if (quote === '"' || quote === "'") {
        const close = meta.indexOf(quote, i + 1);
        if (close === -1) {
          throw new MetaSyntaxError(`unterminated ${quote} quote in meta attribute "${name}"`);
        }
        value = meta.slice(i + 1, close);
        i = close + 1;
      } else {
        const valueStart = i;
        while (i < n && !isSpace(meta.charAt(i))) i++;
        value = meta.slice(valueStart, i);
      }
    }

    if (reserved.has(name)) continue;
    attrs.push(value === undefined ? booleanAttr(name) : stringAttr(name, value));
  }
  return attrs;
}

/**
 * remark plugin attacher (MDX-only). Rewrites every trazo fenced code block into
 * a `<ComponentName lang="…" …meta>{`<dsl body>`}</ComponentName>` MDX element,
 * validating as it goes (per `severity`) so a malformed fence never emits an
 * unrenderable element. Rendering lives in the consumer's component; this only
 * produces the JSX node — no React, no layout, framework-agnostic.
 */
export function remarkTrazoRender(options: RemarkTrazoRenderOptions = {}) {
  const componentName = options.componentName ?? "TrazoDiagram";
  const numbering = options.numberAttr ?? null;
  // `lang` is set by the transform to the canonical DSL kind — numbering under
  // that name would append a second, numeric `lang` (`lang={1}`), breaking the
  // component. Fail fast on the misconfiguration.
  if (numbering === "lang") {
    throw new Error('remarkTrazoRender: `numberAttr` cannot be "lang" — it is reserved for the DSL kind.');
  }
  const passthroughMeta = options.passthroughMeta ?? true;
  const severity = options.severity ?? "error";
  const allowed = options.langs ? new Set(options.langs.map((l) => l.toLowerCase())) : null;
  const reserved = new Set(["lang", ...(numbering ? [numbering] : [])]);

  return function transformer(tree: MdastNode, file: VFile): void {
    let firstFatal: (VFileMessage & Error) | null = null;
    let count = 0;

    const inScope = (node: MdastNode): RemarkDsl | null => {
      const dsl = dslForLang(node.lang);
      if (!dsl) return null;
      if (allowed && !allowed.has((node.lang ?? "").trim().split(/\s+/)[0]!.toLowerCase())) {
        return null;
      }
      return dsl;
    };

    // Preorder, in-place: recurse into a container before advancing to the next
    // sibling so numbering follows true document order (a fence nested in a list
    // is numbered before a later top-level fence).
    const visit = (node: MdastNode): void => {
      if (!node.children) return;
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]!;
        const dsl = child.type === "code" ? inScope(child) : null;
        if (!dsl) {
          visit(child);
          continue;
        }

        const { error } = dsl.parse(child.value ?? "");
        if (error) {
          const fenceLine = child.position?.start.line ?? 1;
          const message = file.message(
            `trazo ${dsl.label} line ${error.line}: ${error.message}`,
            { line: fenceLine + error.line, column: 1 },
          ) as VFileMessage & Error;
          message.fatal = severity === "error";
          if (severity === "error" && !firstFatal) firstFatal = message;
          // Leave the fence as a code block — never emit an unrenderable element.
          continue;
        }

        const attributes: JsxNode[] = [stringAttr("lang", dsl.kind)];
        if (passthroughMeta) {
          try {
            attributes.push(...metaAttributes(child.meta, reserved));
          } catch (metaError) {
            // A meta typo (e.g. an unterminated quote) is a clear error, not a
            // set of stray boolean props — report it and leave the fence as code.
            const fenceLine = child.position?.start.line ?? 1;
            const message = file.message(
              `trazo ${dsl.label} fence meta: ${(metaError as Error).message}`,
              { line: fenceLine, column: 1 },
            ) as VFileMessage & Error;
            message.fatal = severity === "error";
            if (severity === "error" && !firstFatal) firstFatal = message;
            continue;
          }
        }
        if (numbering) attributes.push(numberAttr(numbering, ++count));

        const element: JsxNode = {
          type: "mdxJsxFlowElement",
          name: componentName,
          attributes,
          children: [{ type: "text", value: child.value ?? "" }],
        };
        node.children[i] = element;
      }
    };

    visit(tree);
    if (firstFatal) throw firstFatal;
  };
}

export default remarkTrazo;
