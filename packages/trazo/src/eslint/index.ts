/**
 * trazo ESLint plugin — validates the flow, git, sequence, and block DSLs inside
 * tagged template literals and parser call arguments at lint time, so parse
 * errors surface in your editor before you run the code.
 *
 * Compatible with ESLint ≥ 9 flat config. Add it to your eslint.config.js:
 *
 * ```js
 * import trazo from "@joycostudio/trazo/eslint";
 *
 * export default [
 *   {
 *     plugins: { trazo },
 *     rules: {
 *       "trazo/valid-flow-dsl": "error",
 *       "trazo/valid-git-dsl": "error",
 *       "trazo/valid-sequence-dsl": "error",
 *       "trazo/valid-block-dsl": "error",
 *     },
 *   },
 * ];
 * // …or, equivalently, spread the ready-made config:
 * // export default [trazo.configs.recommended];
 * ```
 *
 * The rules detect DSL content in code that resolves to trazo's own exports:
 *  - Tagged template literals:  flow`…`  git`…`  seq`…`  block`…`
 *  - Parser call arguments:     parseFlow("…")  parseGit(`…`)  parseSequence(…)  parseBlock(…)
 *
 * Matching is binding-aware, not name-based: a rule only fires when the tag or
 * callee resolves to an import from the trazo package (default
 * `@joycostudio/trazo`, extendable via the `modules` option). This means
 *  - aliased imports work:      `import { flow as f } from "@joycostudio/trazo"` → f`…`
 *  - namespace imports work:    `import * as t from "@joycostudio/trazo"` → t.flow`…`, t.parseFlow("…")
 *  - unrelated `git`/`flow` tags from other libraries are left alone (no false positives).
 *
 * Templates with interpolated expressions are skipped — their final string is
 * only known at runtime, so it can't be validated statically.
 */

import { parseFlow } from "../parse-flow.js";
import { parseGit } from "../parse-git.js";
import { parseSequence } from "../parse-sequence.js";
import { parseBlock } from "../parse-block.js";
import type { ParseError } from "../types.js";

// ── Minimal ESLint v9 type stubs ─────────────────────────────────────────────
// ESLint is a peer dependency; we define just the shapes we use so callers
// don't need @types/eslint and the core package stays dependency-light.

interface Pos {
  line: number;
  column: number;
}

interface Loc {
  start: Pos;
  end: Pos;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

interface RuleContext {
  options: unknown[];
  report(descriptor: { node: AnyNode; message: string; loc?: Loc }): void;
}

interface RuleModule {
  meta: {
    type: "problem" | "suggestion" | "layout";
    docs: { description: string };
    schema: unknown[];
  };
  create(context: RuleContext): Record<string, (node: AnyNode) => void>;
}

// ── DSL registry ─────────────────────────────────────────────────────────────
// One entry per language, wiring the tagged-template tag name and the parser
// function name (both as exported from the trazo package) to the parser itself.

interface DslSpec {
  /** Human label used in the reported message, e.g. "flow DSL". */
  label: string;
  /** Exported tagged-template name, e.g. `flow` in flow`…`. */
  tag: string;
  /** Exported parser function name, e.g. `parseFlow` in parseFlow("…"). */
  parser: string;
  /** The parser; returns the last good graph plus an optional error. */
  parse(source: string): { error: ParseError | null };
}

const FLOW_DSL: DslSpec = { label: "flow DSL", tag: "flow", parser: "parseFlow", parse: parseFlow };
const GIT_DSL: DslSpec = { label: "git DSL", tag: "git", parser: "parseGit", parse: parseGit };
const SEQUENCE_DSL: DslSpec = { label: "sequence DSL", tag: "seq", parser: "parseSequence", parse: parseSequence };
const BLOCK_DSL: DslSpec = { label: "block DSL", tag: "block", parser: "parseBlock", parse: parseBlock };

/** The package specifiers whose exports we treat as trazo's DSL API. */
const DEFAULT_MODULES: readonly string[] = ["@joycostudio/trazo"];

// ── Import-binding resolution ─────────────────────────────────────────────────

interface TrazoBindings {
  /** Local name → the trazo export it was imported as (named/aliased). */
  namedByLocal: Map<string, string>;
  /** Local names of `import * as ns from "@joycostudio/trazo"`. */
  namespaces: Set<string>;
}

/**
 * Scan a Program's top-level imports and collect every local binding that
 * points at one of the trazo `modules`. Runs once per file (in the `Program`
 * visitor) before any usage node is visited, since imports precede usages in
 * source order.
 */
function collectTrazoBindings(program: AnyNode, modules: readonly string[]): TrazoBindings {
  const namedByLocal = new Map<string, string>();
  const namespaces = new Set<string>();

  for (const stmt of program.body ?? []) {
    if (stmt.type !== "ImportDeclaration") continue;
    if (typeof stmt.source?.value !== "string") continue;
    if (!modules.includes(stmt.source.value)) continue;

    for (const spec of stmt.specifiers ?? []) {
      if (spec.type === "ImportNamespaceSpecifier") {
        namespaces.add(spec.local.name);
      } else if (spec.type === "ImportSpecifier") {
        // `imported` is the export name; `local` is the (possibly aliased) binding.
        const exported = spec.imported?.name ?? spec.imported?.value;
        if (typeof exported === "string") namedByLocal.set(spec.local.name, exported);
      }
      // ImportDefaultSpecifier is ignored — the DSL API has no default export.
    }
  }

  return { namedByLocal, namespaces };
}

/**
 * Resolve the trazo export name a tag/callee node refers to, or null if it
 * isn't a trazo binding. Handles bare identifiers (`flow`, aliased) and
 * namespace members (`t.flow`).
 */
function resolveTrazoExport(node: AnyNode, bindings: TrazoBindings): string | null {
  if (node?.type === "Identifier") {
    return bindings.namedByLocal.get(node.name) ?? null;
  }
  if (
    node?.type === "MemberExpression" &&
    !node.computed &&
    node.object?.type === "Identifier" &&
    node.property?.type === "Identifier" &&
    bindings.namespaces.has(node.object.name)
  ) {
    return node.property.name;
  }
  return null;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Given the loc of the first quasi in a tagged template and a 1-based DSL
 * error line, return the corresponding source location so the editor
 * underlines the right line.
 *
 * The quasi's start position is the opening backtick character — the content
 * starts on the same line, so DSL line N maps to JS line = quasiLine + N - 1.
 */
function dslLoc(quasiStartLine: number, dslLine: number): Loc {
  const line = quasiStartLine + dslLine - 1;
  return { start: { line, column: 0 }, end: { line, column: Number.MAX_SAFE_INTEGER } };
}

/**
 * Extract a static string from a TemplateElement (the cooked value, falling
 * back to raw). Returns null if the value is null (invalid escape sequence).
 */
function cookedOf(quasi: AnyNode): string | null {
  return quasi.value.cooked ?? null;
}

// ── Rule factory ─────────────────────────────────────────────────────────────

function makeRule(dsl: DslSpec): RuleModule {
  return {
    meta: {
      type: "problem",
      docs: {
        description: `Validate trazo ${dsl.label} in ${dsl.tag}\`…\` and ${dsl.parser}() calls`,
      },
      schema: [
        {
          type: "object",
          properties: {
            modules: { type: "array", items: { type: "string" }, uniqueItems: true },
          },
          additionalProperties: false,
        },
      ],
    },
    create(context) {
      const options = (context.options[0] ?? {}) as { modules?: string[] };
      const modules = options.modules ?? DEFAULT_MODULES;
      let bindings: TrazoBindings = { namedByLocal: new Map(), namespaces: new Set() };

      function check(source: string, node: AnyNode, quasiStartLine?: number): void {
        const { error } = dsl.parse(source);
        if (!error) return;
        const descriptor: { node: AnyNode; message: string; loc?: Loc } = {
          node,
          message: `trazo ${dsl.label} line ${error.line}: ${error.message}`,
        };
        if (quasiStartLine !== undefined) descriptor.loc = dslLoc(quasiStartLine, error.line);
        context.report(descriptor);
      }

      return {
        Program(node: AnyNode) {
          bindings = collectTrazoBindings(node, modules);
        },

        // flow`…`  /  git`…`  /  seq`…`  /  block`…`
        TaggedTemplateExpression(node: AnyNode) {
          if (resolveTrazoExport(node.tag, bindings) !== dsl.tag) return;
          // Skip templates with interpolated expressions — can't analyse statically.
          if (node.quasi.expressions.length > 0) return;
          const quasi = node.quasi.quasis[0];
          if (!quasi) return;
          const source = cookedOf(quasi);
          if (source === null) return;
          check(source, node, quasi.loc?.start.line);
        },

        // parseFlow("…")  /  parseGit(`…`)  /  parseSequence(…)  /  parseBlock(…)
        CallExpression(node: AnyNode) {
          if (resolveTrazoExport(node.callee, bindings) !== dsl.parser) return;
          const arg = node.arguments?.[0];
          if (!arg) return;

          if (arg.type === "Literal" && typeof arg.value === "string") {
            check(arg.value, node, arg.loc?.start.line);
            return;
          }
          if (arg.type === "TemplateLiteral" && arg.expressions.length === 0 && arg.quasis[0]) {
            const source = cookedOf(arg.quasis[0]);
            if (source === null) return;
            check(source, node, arg.quasis[0].loc?.start.line);
          }
        },
      };
    },
  };
}

// ── Plugin export ─────────────────────────────────────────────────────────────

const rules = {
  "valid-flow-dsl": makeRule(FLOW_DSL),
  "valid-git-dsl": makeRule(GIT_DSL),
  "valid-sequence-dsl": makeRule(SEQUENCE_DSL),
  "valid-block-dsl": makeRule(BLOCK_DSL),
};

const plugin = {
  meta: {
    name: "@joycostudio/trazo",
  },
  rules,
  /** Convenience: a ready-to-spread flat config that enables every rule. */
  configs: {
    recommended: {
      plugins: {} as Record<string, unknown>,
      rules: {
        "trazo/valid-flow-dsl": "error" as const,
        "trazo/valid-git-dsl": "error" as const,
        "trazo/valid-sequence-dsl": "error" as const,
        "trazo/valid-block-dsl": "error" as const,
      },
    },
  },
};

// Wire the plugin reference into its own recommended config so users can
// spread `trazo.configs.recommended` directly without separately registering
// the plugin.
plugin.configs.recommended.plugins["trazo"] = plugin;

export default plugin;
