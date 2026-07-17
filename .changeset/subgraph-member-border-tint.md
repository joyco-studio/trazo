---
"@joycostudio/trazo": patch
---

Flow nodes inside a role-tinted subgraph now blend into the tint instead of
showing a seam ring. A node's border is painted with the page background so the
chip reads as lifted off the lines behind it, but against a subgraph's
low-opacity role wash that page-background ring stood out as a mismatched seam.
Member nodes now get a decorative border overlay that re-applies the same role
wash over just the border band, so the ring resolves to `background + wash` —
the exact tinted backdrop — and the seam disappears. Nodes outside a tinted
subgraph, git nodes and roleless subgraphs are unchanged.
