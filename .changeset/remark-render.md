---
"@joycostudio/trazo": minor
---

Add `remarkTrazoRender`, a companion transform to `@joycostudio/trazo/remark`.

`remarkTrazo` validates fenced trazo DSL; `remarkTrazoRender` (MDX-only) rewrites each fence into a configurable MDX JSX element — the ```` ```mermaid ```` → `<Mermaid>` pattern — so diagrams can be authored as fences and rendered by a consumer-owned component.

- Rewrites `flow`/`git`/`seq`/`block` fences into `<ComponentName lang="…">{`<dsl body>`}</ComponentName>` (component name configurable, default `TrazoDiagram`); the DSL body is passed as a string child and `lang` carries the canonical kind.
- Forwards fence info-string meta as props: `title="…"` → string prop, a bare flag (`ascii`) → `ascii={true}`.
- Optional per-document auto-numbering via `numberAttr` (e.g. `index={1}`, `index={2}`, … in document order; non-trazo fences don't count).
- Validates as it rewrites (shared `severity` semantics): a malformed fence fails the build with a source-accurate line and never emits an unrenderable element.
- Framework-agnostic — no React or layout import; it only produces JSX mdast nodes. `TRAZO_FENCE_LANGS` entries now expose a `kind`, and a `TrazoDslKind` type is exported.
