---
"@joycostudio/trazo": patch
---

fix(trazo): sequence `note over` paints on top of lifelines and messages

Sequence notes and flow subgraph containers are both modeled as groups and were
emitted in a single early layer, so the dashed lifeline (and message strokes)
painted on top of the opaque note panel. The groups layer now renders only
subgraph containers (which must sit under nodes/edges), while sequence notes
render in a later `data-slot="notes"` layer after the edges — so the note panel
covers the lifeline and any message strokes running behind it.
