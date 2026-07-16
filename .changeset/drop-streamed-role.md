---
"@joycostudio/trazo": minor
---

Remove the deprecated `streamed` semantic role. It was an alias resolving to the
`info` slot; while still pre-1.0 we drop it outright rather than carry the alias.
Use `:info` (and the `--trazo-info` token) instead. `streamed` is no longer part
of the `SemanticRole` union or `SEMANTIC_ROLES`, and `:streamed` in a DSL is no
longer recognized as a role.
