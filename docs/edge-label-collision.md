# Edge-label collision (the dagre "label dummy node" problem)

> Status: **known limitation, not yet implemented**. Documented for posterity
> after the mermaid comparison audit (2026-07). No real diagram has hit it yet.

## The problem

A flow edge label renders as a badge centered on `labelPoint` — a point ON the
edge's polyline (the midpoint of its longest 45° diagonal, or the arc-length
midpoint for orthogonal edges; see `edgeLabelPoint` in `geometry.ts`). The
**layout does not reserve space for that badge**: nodes are packed by their own
sizes only, so in a sufficiently dense graph a wide edge label can overlap a
neighboring node box or another edge's label.

What trazo DOES guarantee today (three mitigations, all in `layout-flow.ts`):

1. **Canvas containment** — every label badge is folded into `width`/`height`;
   a label can never be clipped by the viewBox (geometry shifts if a badge
   would spill past the origin).
2. **Sibling leveling** — labels on edges fanning out of the same source snap
   to one shared main-axis level, so a decision's branch labels read as a row
   instead of crowding downstream boxes.
3. **Self-loop labels** sit on their own reserved corridor (the packing
   reserves `loopPad` per loop), so they can't collide with rank siblings.

What it does NOT guarantee: a label on a long edge passing BESIDE a node in an
adjacent column can overlap that node's box. The label is painted after nodes,
so the failure mode is a badge sitting on top of a box.

## How dagre (mermaid's layout engine) solves it

dagre treats each labeled edge as if it had a **virtual "label node"** in the
middle of the edge:

- During rank assignment, a labeled edge gets an extra rank inserted between
  its endpoints (`edge.minlen` is doubled), and a dummy node whose `width`/
  `height` are the LABEL's measured size is placed on that intermediate rank
  (`util.normalizeRanks` + `addBorderSegments`; the dummy carries
  `dummy: "edge-label"`).
- Ordering and coordinate assignment then treat that dummy like any real node:
  the barycenter sweeps keep it from crossing others, and the cross-axis pack
  **reserves its width**, pushing real nodes aside.
- After positioning, the label's x/y is simply the dummy's final center.

Net effect: labels participate in collision avoidance, at the cost of an extra
rank per labeled edge (taller diagrams) and more dummies (slower ordering).

## How trazo would implement it

The pipeline already has the machinery — dummy nodes for multi-rank edges
(step 2 of `layoutFlow`). The change would be:

1. When an edge has a `label` and `maxLabelDummies` behavior is enabled, mark
   ONE of its dummy-chain nodes (the middle one; create a chain if the edge
   spans a single rank) as the label carrier, sized
   `badgeWidth(measureMultiline(label).width) × BADGE_H` instead of `w: 0`.
2. Let ordering/packing run unchanged — the carrier now reserves space.
3. Set `labelPoint` to the carrier's final center instead of the
   diagonal-midpoint heuristic, and skip the sibling-leveling pass for edges
   with carriers (the carrier IS the position).

Determinism is unaffected (carrier choice is a fixed function of the chain).

## Why it's deferred

- The JOYCO logs' diagrams are small (5–15 nodes); the audit could not produce
  a real overlap without contriving a dense 10×10 bipartite graph with long
  labels on inner edges.
- The cost is visual: an extra rank per labeled edge makes every labeled
  diagram taller — a bad default for the logs' compact style. It should ship
  behind a `FlowLayoutOptions` flag if/when a real diagram hits the overlap.

If you hit a label-on-box overlap in a real diagram: this is the fix, and this
doc is the spec.
