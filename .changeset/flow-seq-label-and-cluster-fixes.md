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
  message band reserves the FULL extra badge height, so a tall label sits at the
  same top offset a single-line one would (never reaching up into the previous
  event or the header).
- **Edge-label quotes stripped.** `A ===|"base of"| B` now yields the label
  `base of`, mirroring node labels (`A["x"]` → `x`). The quotes still let an
  inner `|` through, so `|"a | b"|` yields `a | b`; bare `|base of|` is unchanged.
- **Parallel bidirectional pairs.** Two nodes on adjacent ranks with edges in
  BOTH directions, each the sole node on its rank (a 1↔1 sync, e.g. commit /
  scroll-deltas between two threads), now render as two parallel lines through
  the shared gap with both labels centered BETWEEN the boxes (Mermaid parity),
  instead of arcing the reverse edge out on a lateral corridor that stranded its
  label at the far edge. A back-edge into a fanned-out decision (its target rank
  has siblings) keeps the lateral loop arc. The inter-node gap reserves room for
  the WIDER of the pair's two labels (a labeled reverse edge widens the gap too),
  so neither badge is drawn clipped under the node boxes.
- **Subgraph containment.** Two Sugiyama-cluster bugs are fixed: (1) an edge-less
  group member no longer strands at the rank-0 source column — it's pulled into
  its cluster's rank band, so two subgraphs lay out side by side instead of one
  box stretching across the other; (2) an ungrouped node that feeds a
  downward-closed cluster and shared its top rank is now lifted ABOVE the box
  (pointing down into it, Mermaid-style) instead of rendering inside it.
- **Subgraph title never clipped.** A container box narrower than its own title
  widens to fit the title (`GROUP_PAD` gutter each side) and grows the viewBox.
- **Sequence diagrams read balanced, not left-leaning.** Participant columns now
  spread so every straight-message label's centered badge fits within its OWN
  span — adjacent AND multi-column (an A→C label no longer crosses the outer
  lifelines or leaves the viewBox) — and reserve a self-message's loop+label
  reach so it clears the next column, instead of packing tight-left with every
  wide label overhanging.
- **Reversed (`start`) arrowheads.** New `arrow: "start"` (`ArrowEnds`) and DSL
  tokens `<--` / `<==`: the edge still flows `from → to` for layout but the head
  points back at the source (`parent ← child`), for "based on" / child→parent
  relations that read right-to-left. Renderer emits `marker-start`.
