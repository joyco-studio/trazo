---
"@joycostudio/trazo": patch
---

Reference only stock shadcn tokens for diagram colors so the renderer adopts a
consuming app's brand out of the box.

- **Lanes/roles now use `primary` + `chart-1…5` + `destructive` /
  `muted-foreground`** instead of JOYCO-specific brand tokens (`joyco-blue`,
  `mint-green`, `mustard-yellow`). `LANE_VARS` is led by `--primary` then cycles
  through `--chart-1…5`; `ROLE_VARS` maps `good→chart-2`, `pending→chart-4`,
  `streamed→chart-3`, `bad→destructive`, `neutral→muted-foreground`. In the
  JOYCO UI kit `--primary` is the brand blue, so JOYCO apps stay on-brand with
  zero config; vanilla shadcn apps render in their own palette. The layered
  `var(--color-x, var(--x, #hex))` fallback discipline is preserved, so output
  is never colorless in an app with no shadcn tokens.
- **Readable label text on colored boxes.** Flow node labels now use
  `nodeForeground()` — the fill's paired `*-foreground` token (shadcn ships
  these for `primary`/`destructive`) with a WCAG-picked black/white hex
  fallback per slot — instead of the page `--foreground`. This fixes
  low-contrast labels where a dark box met a near-black page foreground in light
  themes.

No type or API changes; `types.ts` token-key contract (`lane-N`, `role-X`,
`accent`) is unchanged. The visible difference is which CSS variables resolve
the colors and that box labels are now contrast-correct.
