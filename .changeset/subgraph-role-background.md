---
"@joycostudio/trazo": minor
---

Flow subgraphs now accept an optional trailing `:role` on their header
(`subgraph G ["Label"] :success`) that tints the container: the box fills with
the role's color at a low opacity and the border matches that same color at
full opacity. Only the semantic role keywords (`primary`, `success`, `error`,
`warning`, `info`, `neutral`, …) are accepted — the engine still never emits a
literal color, so the tint resolves through the existing `--trazo-<role>` token
chain and follows the active theme. A subgraph with no `:role` keeps the default
transparent box with a neutral gray outline, so existing diagrams are unchanged.
