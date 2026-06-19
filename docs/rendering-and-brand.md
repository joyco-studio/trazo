# Rendering & JOYCO brand conventions

All in `packages/trazo/src/react/graph.tsx` (the renderer) plus a few shared
constants in `geometry.ts`. The renderer is a pure prop→SVG function; everything
below is a styling decision encoded there.

## The JOYCO graph aesthetic

- **Git commits are SQUARES, not dots** — no radius, centered on x/y.
- **Flowchart boxes have no corner radius** (stadium keeps its pill caps).
- **Node borders are the surface color** so a node reads as a chip lifted off
  the lane/edge lines passing behind it. (Git squares and flow
  box/stadium/diamond/cylinder all use `stroke = BG`.) `BG` resolves
  `var(--trazo-bg, var(--color-background, …))` — so if the graph is drawn on a
  non-`--background` surface (a `--card`/`--muted` panel), set `--trazo-bg` to
  that surface on a wrapper or the seam shows as a ring. The playground's preview
  pane is `bg-card`, so it sets `[--trazo-bg:var(--color-card)]`.
- **The git label badge has no border** (fill only) — only the squares/boxes use
  the `BG` chip-lift stroke.
- **Edges turn abruptly** — straight, then a sharp **45° diagonal elbow**
  (`edgeStyle: "elbow45"`, default) or a **90° right-angle** (`"orthogonal"`).
  No eased curves. Miter joins, slightly heavier stroke.
- **Edges always leave/enter a node face perpendicular (90°)** via a short stub,
  *then* turn. (Implemented as stub points in `layout-flow.ts`.)
- **Labels are UPPERCASE** (CSS `text-transform`) with `0.02em` letter-spacing.
- **Git commit labels render as a sliced-corner badge** matching the hub Badge:
  top-left + bottom-right corners chamfered 6px, `bg-accent` surface, with the
  hash (dim mono) + subject + author (dim).

## Git orientation & label side

- `layoutGit` takes `orientation: "vertical" | "horizontal"` (default `vertical`)
  and `labelSide: "left" | "right"` (default `right`). Vertical flows commits
  top→bottom (lanes = columns); horizontal flows them left→right (lanes = rows).
- `labelSide` is the cross-axis side of the badge: vertical → right/left of the
  square; horizontal → below (`right`) / above (`left`). The **engine** computes
  the badge's top-left corner as `node.labelAnchor` (so the renderer never
  re-derives placement). A leading badge (`left`/above) that would spill past the
  origin is normalized: the layout shifts all geometry so the leading badge edge
  sits at `padding`. The default vertical/right output is unchanged.
- The renderer draws the badge at `labelAnchor` when present and falls back to
  the legacy right-of-square placement when it's absent.

## Color tokens — the fallback strategy (important)

The engine emits **token keys** (`"lane-N"`, `"role-X"`, `"accent"`); the
renderer maps them to CSS variables. Each mapping is a **layered fallback**:

```
var(--color-joyco-blue, var(--joyco-blue, #002cea))
```

**Why the fallbacks exist:** in Tailwind v4 the `--color-*` aliases live inside
`@theme inline` and are **tree-shaken** unless a utility class references them.
A renderer that used `var(--color-chart-1)` alone rendered **colorless** in apps
that didn't happen to reference that utility. The chain resolves to the raw
token (`--chart-1`, which survives) and finally a hard-coded hex — so
illustrations are never colorless in *any* consuming app (the playground, the
hub, a standalone script). **Keep this pattern for any new color.**

Palettes (in `graph.tsx`):

- **Lanes** (git) — `LANE_VARS`, led by **joyco-blue** as primary, then vivid
  contrast colors (mint, mustard, charts), cycled.
- **Roles** (flow) — `ROLE_VARS`: `primary→joyco-blue`, `good→mint-green`,
  `bad→destructive`, `pending→mustard-yellow`, `streamed→chart-3`,
  `neutral→muted-foreground`.
- **Accent** — `"accent"` key → a neutral light gray (`muted-foreground`); the
  default flow edge color.

`nodeColor(key)` resolves any key: `"accent"` → gray, `role-*` → role palette,
else → lane palette.

## Label width & the letter-spacing tracking fix

Labels render with `letter-spacing: 0.02em`, but `measure()` only sums glyph
advances — so a label was ~1.5 chars wider than reserved and **overflowed its
box/badge**. The fix is `measureLabel(text)` in `geometry.ts`, which re-adds
`(chars - 1) * 0.02 * fontSize` of tracking. All label sizing (git label, flow
node label, flow edge label) goes through `measureLabel` so widths match what's
drawn. **If you change the rendered `letter-spacing`, update `LABEL_TRACKING_EM`
in `geometry.ts` to match**, or labels will crop again.

## Sliced-corner badge geometry

`badgePath(x, y, w, h)` in `graph.tsx` builds the chamfered rect (hub Badge
geometry): top-left + bottom-right cut at `BADGE_CHAMFER` (6px); the other two
corners stay square. As a path: `M c,0 L W,0 L W,H-c L W-c,H L 0,H L 0,c Z`.

## Edge paint order

Colored (`==>`) edges paint **on top of** neutral accent edges. `graph.tsx`
partitions edges (`orderEdgesByPaint`) into accent-first, colored-last, with
input order preserved within each group (stable, deterministic).
