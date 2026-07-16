---
"@joycostudio/trazo": patch
---

fix(trazo): inline `code` chips inherit the node's foreground by default

Inline `` `code` `` runs in flow-node labels now default to **transparent
chip background** and **inherit the parent label's per-node role foreground**,
instead of a boxed chip in a fixed global color. The `--trazo-code` /
`--trazo-code-foreground` overrides still work: set them (via the `code` /
`code-foreground` theme tokens or raw CSS) to restore a boxed, distinctly
colored chip.

The fix lives entirely in the two `var()` chains — `--trazo-code` now falls
back to `transparent`, and `--trazo-code-foreground` to `inherit`. Because a
`var()` fallback is a raw token stream, `inherit` substitutes literally into
`fill: inherit`, which picks up the surrounding `<text>`'s `nodeForeground`;
and since `fill` is an inherited SVG property, even a browser that rejects the
fallback lands on the same parent color. So a `` `getCart()` `` on a `:primary`
node reads primary, and on a `:warning` node reads warning — legible against
each node fill with no visible box.

Overriding ONLY the chip background (`code`) to restore a boxed chip now
derives a readable text color from the fill's lightness (like the other paired
surface tokens), so a dark code box no longer risks inheriting a dark node
foreground and reading dark-on-dark. A `transparent` / `var()` code fill isn't
a literal color, so it derives nothing and keeps the per-node `inherit` default.

Non-breaking: labels with no code runs are unchanged, and any consumer that
explicitly set `--trazo-code` / `--trazo-code-foreground` keeps its boxed chip.
