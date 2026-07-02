---
"@joycostudio/trazo": minor
---

feat(trazo): robustness — self-loops, label bounds, auto-wrap, git fixes

- `layoutFlow` now routes self-loops (`A --> A`) as a wrap-around corridor
  beside the node (forward face → reserved cross-end corridor → cross-end
  face) instead of silently dropping them. Multiple loops on one node nest at
  `nodeGap` intervals, and the cross-axis packing reserves corridor space so a
  loop never collides with its rank sibling.
- Edge label badges are now folded into `width`/`height`: a label wider than
  the graph grows the canvas (and shifts geometry when it would spill past the
  origin) instead of being clipped by the viewBox — restoring the documented
  contract that the canvas bounds ALL geometry including labels.
- New `FlowLayoutOptions.maxNodeWidth`: word-wraps node labels (mermaid-style)
  so one long label no longer produces an extremely wide box. Pure,
  deterministic, glyph-table measured; hard `\n` breaks preserved; a single
  over-budget word stays whole. Off by default.
- New `LayoutOptions.maxLabelWidth` (git): ellipsis-truncates the commit
  MESSAGE (hash and author are never cut) so the badge caps at a max width —
  what real git UIs do to long subjects. Off by default.
- Fix (git DSL): auto-generated commit/merge ids (`c1…`, `m1…`) now skip ids
  the user already wrote. A user commit literally named `m2` used to silently
  fuse with the second merge's auto id, dropping a commit and scrambling the
  row order.
