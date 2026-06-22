/**
 * trazo ESLint plugin — validates the git and flow DSLs inside tagged template
 * literals and string arguments at lint time, so parse errors surface in your
 * editor before you run the code.
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
 *       "trazo/valid-git-dsl": "error",
 *       "trazo/valid-flow-dsl": "error",
 *     },
 *   },
 * ];
 * ```
 *
 * The rules detect DSL content in:
 *  - Tagged template literals: git`...` and flow`...`
 *  - String / template-literal arguments: parseGit("...") and parseFlow("...")
 *
 * Templates with interpolated expressions are skipped (can't be statically
 * validated).
 */

import { parseGit } from "../parse-git.js";
import { parseFlow } from "../parse-flow.js";

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
  report(descriptor: { node: AnyNode; message: string; loc?: Loc }): void;
}

interface RuleModule {
  meta: {
    type: "problem" | "suggestion" | "layout";
    docs: { description: string };
    schema: [];
  };
  create(context: RuleContext): Record<string, (node: AnyNode) => void>;
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

// ── Rule: valid-git-dsl ──────────────────────────────────────────────────────

const validGitDsl: RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Validate trazo git DSL in git`...` and parseGit() calls" },
    schema: [],
  },
  create(context) {
    function check(source: string, node: AnyNode, quasiStartLine?: number): void {
      const { error } = parseGit(source);
      if (!error) return;
      const descriptor: { node: AnyNode; message: string; loc?: Loc } = {
        node,
        message: `trazo git DSL line ${error.line}: ${error.message}`,
      };
      if (quasiStartLine !== undefined) descriptor.loc = dslLoc(quasiStartLine, error.line);
      context.report(descriptor);
    }

    return {
      // git`...`
      TaggedTemplateExpression(node: AnyNode) {
        if (node.tag?.type !== "Identifier" || node.tag.name !== "git") return;
        // Skip templates with interpolated expressions — can't analyse statically.
        if (node.quasi.expressions.length > 0) return;
        const quasi = node.quasi.quasis[0];
        if (!quasi) return;
        const source = cookedOf(quasi);
        if (source === null) return;
        check(source, node, quasi.loc?.start.line);
      },

      // parseGit("...") or parseGit(`...`)
      CallExpression(node: AnyNode) {
        if (node.callee?.type !== "Identifier" || node.callee.name !== "parseGit") return;
        const arg = node.arguments?.[0];
        if (!arg) return;

        if (arg.type === "Literal" && typeof arg.value === "string") {
          check(arg.value, node, arg.loc?.start.line);
          return;
        }
        if (
          arg.type === "TemplateLiteral" &&
          arg.expressions.length === 0 &&
          arg.quasis[0]
        ) {
          const source = cookedOf(arg.quasis[0]);
          if (source === null) return;
          check(source, node, arg.quasis[0].loc?.start.line);
        }
      },
    };
  },
};

// ── Rule: valid-flow-dsl ─────────────────────────────────────────────────────

const validFlowDsl: RuleModule = {
  meta: {
    type: "problem",
    docs: { description: "Validate trazo flow DSL in flow`...` and parseFlow() calls" },
    schema: [],
  },
  create(context) {
    function check(source: string, node: AnyNode, quasiStartLine?: number): void {
      const { error } = parseFlow(source);
      if (!error) return;
      const descriptor: { node: AnyNode; message: string; loc?: Loc } = {
        node,
        message: `trazo flow DSL line ${error.line}: ${error.message}`,
      };
      if (quasiStartLine !== undefined) descriptor.loc = dslLoc(quasiStartLine, error.line);
      context.report(descriptor);
    }

    return {
      // flow`...`
      TaggedTemplateExpression(node: AnyNode) {
        if (node.tag?.type !== "Identifier" || node.tag.name !== "flow") return;
        if (node.quasi.expressions.length > 0) return;
        const quasi = node.quasi.quasis[0];
        if (!quasi) return;
        const source = cookedOf(quasi);
        if (source === null) return;
        check(source, node, quasi.loc?.start.line);
      },

      // parseFlow("...") or parseFlow(`...`)
      CallExpression(node: AnyNode) {
        if (node.callee?.type !== "Identifier" || node.callee.name !== "parseFlow") return;
        const arg = node.arguments?.[0];
        if (!arg) return;

        if (arg.type === "Literal" && typeof arg.value === "string") {
          check(arg.value, node, arg.loc?.start.line);
          return;
        }
        if (
          arg.type === "TemplateLiteral" &&
          arg.expressions.length === 0 &&
          arg.quasis[0]
        ) {
          const source = cookedOf(arg.quasis[0]);
          if (source === null) return;
          check(source, node, arg.quasis[0].loc?.start.line);
        }
      },
    };
  },
};

// ── Plugin export ─────────────────────────────────────────────────────────────

const plugin = {
  meta: {
    name: "@joycostudio/trazo",
  },
  rules: {
    "valid-git-dsl": validGitDsl,
    "valid-flow-dsl": validFlowDsl,
  },
  /** Convenience: a ready-to-spread flat config that enables both rules. */
  configs: {
    recommended: {
      plugins: {} as Record<string, unknown>,
      rules: {
        "trazo/valid-git-dsl": "error" as const,
        "trazo/valid-flow-dsl": "error" as const,
      },
    },
  },
};

// Wire the plugin reference into its own recommended config so users can
// spread `trazo.configs.recommended` directly without separately registering
// the plugin.
plugin.configs.recommended.plugins["trazo"] = plugin;

export default plugin;
