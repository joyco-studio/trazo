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
  sourceCode: { getScope(node: AnyNode): AnyNode };
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

// ── Import-binding resolution (scope-aware) ──────────────────────────────────
// Resolution goes through ESLint's scope analysis rather than a name map, so a
// local that shadows an import (a `flow` parameter, `const git = …`) is NOT
// mistaken for the trazo tag, while aliased and namespace imports still resolve
// to their real export name.

/** Walk scopes outward from `scope` to find the variable `name` binds to here. */
function findVariable(scope: AnyNode, name: string): AnyNode | null {
  for (let s: AnyNode = scope; s; s = s.upper) {
    const variable = s.set?.get(name);
    if (variable) return variable;
  }
  return null;
}

/**
 * If `variable` is an import from one of `modules`, describe it: a named import
 * carries the export it binds; a namespace import binds the whole module object.
 * Returns null for locals, non-trazo imports, and default imports.
 */
function trazoImportOf(
  variable: AnyNode,
  modules: readonly string[],
): { kind: "named"; exported: string } | { kind: "namespace" } | null {
  const def = variable?.defs?.find((d: AnyNode) => d.type === "ImportBinding");
  if (!def) return null;
  const source = def.parent?.source?.value;
  if (typeof source !== "string" || !modules.includes(source)) return null;
  if (def.node?.type === "ImportNamespaceSpecifier") return { kind: "namespace" };
  if (def.node?.type === "ImportSpecifier") {
    // `imported` is the export name — an Identifier (`.name`) or, for a
    // string-literal import (`import { "x" as y }`), a Literal (`.value`).
    const exported = def.node.imported?.name ?? def.node.imported?.value;
    if (typeof exported === "string") return { kind: "named", exported };
  }
  return null;
}

/** Static string key of a member access — `.parseFlow` or `["parseFlow"]` — or null. */
function memberKey(node: AnyNode): string | null {
  if (!node.computed && node.property?.type === "Identifier") return node.property.name;
  if (node.computed && node.property?.type === "Literal" && typeof node.property.value === "string") {
    return node.property.value;
  }
  return null;
}

/**
 * Resolve the trazo export name a tag/callee node refers to, or null if it isn't
 * a trazo binding in this scope. Handles bare identifiers (named/aliased imports,
 * respecting shadowing) and namespace members — both `t.parseFlow` and the
 * equivalent computed `t["parseFlow"]`.
 */
function resolveTrazoExport(
  node: AnyNode,
  scope: AnyNode,
  modules: readonly string[],
): string | null {
  if (node?.type === "Identifier") {
    const info = trazoImportOf(findVariable(scope, node.name), modules);
    return info?.kind === "named" ? info.exported : null;
  }
  if (node?.type === "MemberExpression" && node.object?.type === "Identifier") {
    const info = trazoImportOf(findVariable(scope, node.object.name), modules);
    return info?.kind === "namespace" ? memberKey(node) : null;
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
      // `modules` extends the defaults; it never disables `@joycostudio/trazo`.
      const modules = [...DEFAULT_MODULES, ...(options.modules ?? [])];

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
        // flow`…`  /  git`…`  /  seq`…`  /  block`…`
        TaggedTemplateExpression(node: AnyNode) {
          const scope = context.sourceCode.getScope(node);
          if (resolveTrazoExport(node.tag, scope, modules) !== dsl.tag) return;
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
          const scope = context.sourceCode.getScope(node);
          if (resolveTrazoExport(node.callee, scope, modules) !== dsl.parser) return;
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
