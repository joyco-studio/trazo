---
"@joycostudio/trazo": minor
---

feat(trazo): `note` callout/annotation primitive for flow diagrams

Add a first-class annotation to the flow DSL and layout engine so you can hang a
free-floating margin note (with a leader arrow) off any node **without** pulling
it into the Sugiyama rank flow — previously the only workaround was a real node +
edge, which forks the pipeline.

- **DSL:** `note <targetId> <above|below|left|right> "<text>" [:role]`. The text
  obeys the same quoting / `<br/>` / inline `` `code` `` / `textCase` rules as a
  node label; an optional trailing `:role` tints the chip. Forward references to
  the target resolve at layout time; a note with an unknown target is dropped
  (same forgiving policy as an edge to an unknown node). `note` stays usable as an
  ordinary node id anywhere the full statement doesn't match.
- **Types:** new `FlowNote` / `NoteSide`, `FlowGraph.notes`, a `kind: "note"`
  discriminator on `PositionedNode`, a `"note"` `EdgeKind`, and a `calloutGap`
  `FlowLayoutOptions` knob (default 24).
- **Layout:** notes are excluded from ranking (they can never change which rank a
  real node lands in) and placed from resolved real-node centers as a post-pass,
  **centered on the target's cross-axis** so the leader is a straight
  perpendicular arrow (vertical for `above`/`below`, horizontal for
  `left`/`right`). The chip + leader fold into the same "labels grow the canvas"
  bounds pass, so a note is never clipped — one that would spill off-canvas shifts
  the whole graph (a pure translation that keeps it aligned). Multiple notes on a
  side stack outward. No collision routing: a note placed where a real node
  already sits (e.g. `below` a mid-pipeline node in `TD`) may overlap it — put it
  on a side with room.
- **Renderer:** the note draws as a filled chip under `data-slot="annotation"`
  (styleable via `classNames.annotation`) and the leader as a neutral connector
  with an arrowhead at the target face.

Additive and non-breaking: a flow graph with no `note` lines is completely
unchanged.
