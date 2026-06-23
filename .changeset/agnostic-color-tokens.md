---
"@joycostudio/trazo": minor
---

Make diagram colors themeable through a `--trazo-*` CSS-variable layer, and
reference only stock shadcn tokens by default so the renderer adopts a consuming
app's brand out of the box.

- **`--trazo-*` theming entry point.** Every color now resolves through a
  three-layer chain `var(--trazo-<slot>, var(--<shadcn-token>, <hex>))` built by
  a `themed()` helper. `--trazo-*` is unset by default (falls through to the
  shadcn token), so an app re-themes the graph by setting these vars — in CSS,
  on the root via `className="[--trazo-success:#16a34a]"`, or anywhere above the
  graph — with no inline style and no knowledge of which shadcn token a slot maps
  to. Slots: `--trazo-lane-1…6`, `--trazo-primary` / `success` / `error` /
  `warning` / `streamed` / `neutral`, a `-foreground` variant of each for label
  text, and
  `--trazo-bg` / `--trazo-accent` / `--trazo-muted` for surfaces.
- **Stock shadcn defaults.** Each slot defaults to a stock shadcn token
  (`primary` + `chart-1…5`, `destructive`, `muted-foreground`) instead of
  JOYCO-specific brand tokens (`joyco-blue`, `mint-green`, `mustard-yellow`). In
  the JOYCO UI kit `--primary` is the brand blue, so JOYCO apps stay on-brand
  with zero config; vanilla shadcn apps render in their own palette. The layered
  fallback (incl. the Tailwind v4 `--color-*` alias and a final hex) is
  preserved, so output is never colorless in an app with no shadcn tokens.
- **Contrast-correct labels.** Flow node labels use `nodeForeground()` — the
  fill's paired `*-foreground` slot with a WCAG-picked black/white hex fallback
  per fill — instead of the page `--foreground`. Fixes low-contrast labels where
  a dark box met a near-black page foreground in light themes.
- **Lane cycle fix.** `LANE_VARS` is now 6 distinct slots and `laneIndex` cycles
  mod 6, removing the prior duplicate entries (old indices 6–7 reused the CSS
  chains of 0–1, clashing at those positions in any real shadcn app).
- **`neutral` foreground fallback** corrected from `#ededed` to `#0a0a0a` (~7:1
  contrast on the `#a1a1a1` neutral fill, up from ~2:1).

**Breaking — semantic roles renamed.** `good` → `success`, `bad` → `error`,
`pending` → `warning` (`primary`, `streamed`, `neutral` unchanged). This changes
the `SemanticRole` type, the DSL `:role` suffix (`:good` → `:success`, etc.
across the `flow` / `seq` / `block` parsers), the emitted color-token keys
(`role-good` → `role-success`), and the corresponding `--trazo-*` /
`--color-role-*` override slots. No back-compat aliases — old names no longer
parse. Update any diagram sources and theme overrides accordingly.

The `node.color` token-key *shape* (`lane-N`, `role-X`, `accent`) is otherwise
unchanged.
