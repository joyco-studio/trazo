---
"@joycostudio/trazo": patch
---

fix(trazo): render multi-line flow edge labels (stack lines + reserve real badge height)

Flow edge labels are measured as multi-line by the layout engine (`\n` / `<br>`,
the same DSL feature node labels support) but the renderer drew them as a single
SVG `<text>` at a fixed badge height — so a multi-line edge label ran all its
lines together on one line, inside a badge sized only to the widest single line,
and overflowed the chip.

- **Renderer:** edge-label lines now stack into per-line `<tspan>` rows via the
  same helper node labels use, so both lines are readable.
- **Geometry:** new `badgeHeight()` primitive (vertical analog of `badgeWidth`) —
  a one-line label yields exactly the old `BADGE_H`, and each extra line grows
  the chip by one line-height. `PositionedEdge` gains a `labelHeight` field.
- **Layout:** the real badge height is now reserved everywhere the engine
  previously hardcoded `BADGE_H` for edge labels — the TD inter-rank gap and the
  canvas-bounds fold — so multi-line badges are contained in both `LR` and `TD`.
  Self-loop labels also switched to the plain (verbatim) measure, consistent with
  adjacent edges.
- **Sibling alignment:** fan-out labels snap to the shallowest sibling's level; a
  tall multi-line badge dragged up to a short sibling's level could poke into the
  source node. The aligned level is now floored so the group's tallest badge
  always clears the source's forward face by `LABEL_GAP`.

Single-line edge labels are unchanged.
