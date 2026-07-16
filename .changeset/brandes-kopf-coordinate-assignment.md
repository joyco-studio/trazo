---
"@joycostudio/trazo": patch
---

Flow cross-axis coordinate assignment now uses **Brandes–Köpf block alignment**
in place of the previous bounded iterative PAVA refinement. Co-aligned runs — a
node chain, a long-edge dummy chain, or a cluster spine — are grouped into
vertical blocks and placed in a single deterministic pass, so they share one
cross coordinate and their connecting edges draw as straight lines. This fixes a
subtle drift where a chain of differently-sized nodes *inside a subgraph* landed
a few pixels off a common column (the group-aware averaging converged too slowly
under the old two-sweep limit), producing visible 45° jogs on edges that should
have been dead vertical. Ungrouped chains, fan-out centering, long-edge
straightening, cluster-spine straightness, and subgraph box separation are all
preserved; the change is layout-only and deterministic. See
`docs/coordinate-assignment.md`.
