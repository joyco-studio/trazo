---
"@joycostudio/trazo": minor
---

Diagram linting across TS/JSX and Markdown/MDX.

- **ESLint plugin** (`@joycostudio/trazo/eslint`) now covers all four DSLs — added `valid-sequence-dsl` and `valid-block-dsl` alongside the existing flow/git rules.
- **Binding-aware matching.** The ESLint rules no longer fire on bare `flow`/`git` identifier names; they resolve the tag/callee to an actual import from `@joycostudio/trazo`, so aliased imports (`flow as f`) and namespace imports (`t.flow\`…\``) are validated while unrelated same-named tags from other libraries are left alone. A `modules` rule option extends the recognised specifiers.
- **New remark plugin** (`@joycostudio/trazo/remark`) validates fenced `flow`/`git`/`seq`/`block` code blocks in Markdown/MDX at build time, failing on a parse error with a source-accurate line (or `severity: "warn"` for editor-only diagnostics). Framework-agnostic and dependency-light.
