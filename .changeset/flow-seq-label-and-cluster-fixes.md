---
"@joycostudio/trazo": minor
---

fix(trazo): multi-line sequence labels, subgraph containment, sequence balance, edge-label quotes, reversed arrows

A batch of layout + parser fixes surfaced by the JOYCO hub mermaid→trazo audit
(logs 07/08/12/14). All additive and non-breaking. (Flow-edge multi-line labels
already landed in #17; this extends the same badge machinery to sequence
messages and adds the rest.)

- **Multi-line sequence message labels.** A `<br/>`/`\n` in a sequence message
  label now sets `PositionedEdge.labelHeight` and lifts the label by its real
  (multi-line) badge height, so the renderer stacks the rows in a taller badge
  instead of clipping — the same treatment flow edge labels got in #17. The
  message band grows when a tall label would overrun the event above it.
- **Edge-label quotes stripped.** `A ===|"base of"| B` now yields the label
  `base of`, mirroring node labels (`A["x"]` → `x`). The quotes still let an
  inner `|` through, so `|"a | b"|` yields `a | b`; bare `|base of|` is unchanged.
- **Subgraph containment.** Two Sugiyama-cluster bugs are fixed: (1) an edge-less
  group member no longer strands at the rank-0 source column — it's pulled into
  its cluster's rank band, so two subgraphs lay out side by side instead of one
  box stretching across the other; (2) an ungrouped node that feeds a
  downward-closed cluster and shared its top rank is now lifted ABOVE the box
  (pointing down into it, Mermaid-style) instead of rendering inside it.
- **Subgraph title never clipped.** A container box narrower than its own title
  widens to fit the title (`GROUP_PAD` gutter each side) and grows the viewBox.
- **Sequence diagrams read balanced, not left-leaning.** Adjacent participant
  columns now spread to fit the widest straight-message label between them (a
  centered badge sits within the pair span) and reserve a self-message's
  loop+label reach so it clears the next column — instead of packing tight-left
  with every wide label overhanging.
- **Reversed (`start`) arrowheads.** New `arrow: "start"` (`ArrowEnds`) and DSL
  tokens `<--` / `<==`: the edge still flows `from → to` for layout but the head
  points back at the source (`parent ← child`), for "based on" / child→parent
  relations that read right-to-left. Renderer emits `marker-start`.
