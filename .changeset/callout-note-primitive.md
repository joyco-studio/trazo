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
- **Layout:** notes are placed purely from resolved real-node centers as a
  post-pass, so they have **zero** effect on real-node positions — removing every
  `note` line yields byte-identical layout. The note chip + leader fold into the
  same "labels grow the canvas" bounds pass, so they're never clipped. Multiple
  notes on a side stack outward.
- **Renderer:** the note draws as a filled chip under `data-slot="annotation"`
  (styleable via `classNames.annotation`) and the leader as a neutral connector
  with an arrowhead at the target face.

Additive and non-breaking: a flow graph with no `note` lines is completely
unchanged.
