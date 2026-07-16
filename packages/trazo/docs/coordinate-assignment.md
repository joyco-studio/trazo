# Cross-axis coordinate assignment (Brandes–Köpf)

Status: **implemented** · Owner: layout engine · Supersedes: iterative PAVA
median refinement in `layout-flow.ts`.

## The problem

Sugiyama layout runs in phases: rank assignment → ordering within ranks →
**coordinate assignment** → edge routing. The coordinate-assignment phase turns
a *fixed left-to-right ordering* of each rank into actual cross-axis coordinates
(x in `TD`, y in `LR`), subject to two hard constraints — keep the given order,
never let two rank-siblings overlap — and one soft goal: **co-aligned nodes
should share a cross coordinate so their connecting edge is a straight line.**

The previous implementation did this with an *iterative* scheme: an initial
left-aligned pack, then a fixed number (`REFINE_SWEEPS = 2`) of alternating
down/up median-alignment sweeps solved per-layer with a weighted PAVA
(pool-adjacent-violators), plus bespoke cluster passes.

That scheme is mathematically an averaging iteration, and it has the classic
failure mode of iterative coordinate assignment: **slow convergence on
unpinned chains.** A chain of differently-sized nodes inside a subgraph — where
the group-aware path anchors each member to *both* neighbours at once, i.e.
`x_i ← (x_{i-1} + x_{i+1}) / 2` — diffuses like heat: it needs O(n²) sweeps to
straighten. With only 2 sweeps the members drift a few px off a common column,
and `elbow45` faithfully renders that drift as visible 45° jogs. (An *ungrouped*
chain straightened fine, because that path uses one-sided directional sweeps
that propagate alignment along the whole chain in a single pass — which is why
the bug was group-specific and easy to miss.)

## The decision

Replace the iterative refinement (and the cluster even-spacing / spine-anchor
hacks it needed) with **Brandes–Köpf "Fast and Simple Horizontal Coordinate
Assignment"** — the field-standard method, and the one `dagre` (hence Mermaid)
uses. It is:

- **Non-iterative** — a single deterministic pass, O(N). No sweep count to tune,
  no convergence rate, no oscillation.
- **Block-based** — it groups co-alignable nodes into vertical *blocks* and
  places each block once. Chains, long-edge dummy chains, and cluster spines
  come out straight *by construction*, not by converging.
- **Balanced** — it runs the alignment+compaction four times
  (leftmost/rightmost × align-up/align-down) and combines the four candidate
  coordinates per node by median, so nodes centre nicely over their neighbours
  (what the old refinement sweeps approximated).

References:
- Brandes & Köpf, *Fast and Simple Horizontal Coordinate Assignment*, GD 2002.
- Brandes, Walter & Zink, *Erratum* (arXiv:2008.01252, 2020) — corrects the
  original conflict-handling; this implementation follows the corrected version.
- Rüegg et al. (KIELER), *Size- and Port-Aware Horizontal Node Coordinate
  Assignment*, GD 2015 — the variable-node-width extension `dagre` also uses;
  here it is folded in via a size-aware separation function.

## How "snap chains straight" and "iterate to converge" relate

They are not two patches to combine — they are two partial views of one
algorithm. "Snap a chain straight" is the degenerate case of block alignment
(a chain is one block). "Iterate to converge" is obviated: BK does not iterate,
so there is nothing to converge. Adopting block alignment subsumes both.

## Trazo-specific constraints preserved

Classic BK assumes uniform node sizes and no clustering. Trazo carries extra
structure that the implementation threads through:

1. **Variable node widths** — the separation between two rank-siblings is
   `halfWidth(a) + halfWidth(b) + nodeGap` (+ extras below), not a constant.
   BK compaction uses this size-aware `sep` directly, so wide and narrow nodes
   never overlap.
2. **Subgraph contiguity + boundary gaps** — ordering already keeps a group's
   members contiguous; `sep` adds `groupBoundaryGap` between neighbours of
   different groups so two container boxes never crowd. No BK change needed.
3. **Cluster spine straightness vs. external feeders** — a grouped member must
   align to its *spine* (same-group neighbour), not to an external edge's
   routing dummy that happens to share its rank. BK's vertical-alignment step is
   given a **same-group candidate filter**: a grouped vertex with any same-group
   neighbour in the pass direction aligns only among those. This replaces the
   old `sameGroupAnchors` + `REAL_ALIGN_WEIGHT` machinery.
4. **Self-loop corridors** — `loopPad` reserved past a node's trailing side
   folds into `sep`, so a loop never collides with the next sibling.
5. **Long / cross-group edges straighten in the gutter** — dummy-only ("inner")
   segments win type-1 conflicts, so long edges route as straight vertical
   corridors through their own empty column.

Everything before (ranking, ordering) and after (edge routing, group boxes,
label/note normalisation, the negative-space shift) is unchanged: BK only
produces the cross coordinate, exactly where the old refinement did.

## Implementation shape

- `bk-align.ts` — a self-contained, unit-testable module. Pure function over a
  minimal interface (`layers`, proper adjacency, `isDummy`, `group`, `sep`) →
  `Map<id, cross>`. No DOM, no trazo types; deterministic given its inputs.
- `layout-flow.ts` — builds *proper* adjacency (adjacent-rank segments only;
  back-edges and same-rank edges are excluded — they route laterally and never
  constrain columns), sets the main-axis centre via the existing rank spacing,
  then calls `assignCross` for the cross-axis and writes it onto each vertex.

## Increment history

1. Single-direction vertical alignment into blocks + one size-aware compaction.
2. Full four-pass leftmost/rightmost × up/down with median balancing.
3. Same-group filter, `loopPad`/boundary-gap in `sep`, removal of the old
   cluster even-spacing pass; validated against the property test suite and the
   Chromium-render-pipeline example.
