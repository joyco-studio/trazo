# @joycostudio/trazo

## 0.1.0

### Minor Changes

- caba2c4: Add DSL string authoring and an ESLint plugin.

  - Export the `parseGit` and `parseFlow` parsers so diagrams can be authored from
    DSL strings instead of hand-built graph objects.
  - Add `git` and `flow` tagged template literals that parse inline and throw on
    error, returning a graph ready for `layout` / `layoutGit` / `layoutFlow`.
  - `FlowGraph` gains an optional `direction` field that the parser populates from
    the source (`flow TD` / `flow LR`); `layoutFlow` falls back to it when
    `FlowLayoutOptions.direction` is not set, so the declared direction flows
    through automatically.
  - New `@joycostudio/trazo/eslint` subpath: an ESLint ≥ 9 flat-config plugin with
    `trazo/valid-git-dsl` and `trazo/valid-flow-dsl` rules (and a `recommended`
    config) that validate DSL strings at lint time, surfacing parse errors on the
    offending line in the editor.
