---
"@joycostudio/trazo": minor
---

feat(trazo): themeable label casing + inline `code` in flow-node labels

- **`textCase` theme knob** (`"uppercase"` | `"none"`, default `"uppercase"`).
  Opt out of the JOYCO all-caps look to render labels exactly as authored. The
  casing flows into BOTH halves of the theme — the renderer's `text-transform`
  and the engine's measurement (`applyCase` replaces the hard-coded
  `.toUpperCase()`) — so boxes always size to what's drawn. Exposed as a knob in
  the playground theme editor; the `soft` preset now ships `textCase: "none"`.

- **Inline `code` in flow-node labels.** A label may contain
  `` `backtick` ``-delimited runs, rendered in a monospace chip: a rounded
  `<rect>` (`data-slot="label-code-chip"`) behind a mono `<tspan>`
  (`data-slot="label-code"`). Code is case-sensitive (exempt from `textCase`) and
  measured as constant-advance monospace so boxes reserve room for the chip. New
  themeable slots `--trazo-code` / `--trazo-code-foreground` (default `muted` /
  `foreground`).

Both are additive and non-breaking: unset `textCase` keeps uppercase, and a
label without backticks renders exactly as before.
