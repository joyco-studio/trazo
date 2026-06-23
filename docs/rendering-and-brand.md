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
renderer maps them to CSS variables via the `themed(slot, token, hex)` helper,
which builds a **three-layer chain**:

```
var(--trazo-primary, var(--color-primary, var(--primary, #002cea)))
└─ override knob ──┘  └─ shadcn default (── adopts app brand ──)┘  └ hex ┘
```

**Layer 1 — `--trazo-<slot>` (the theming entry point).** Unset by default, so
it falls through. An app re-themes the graph by setting these — in CSS, on the
root via `className="[--trazo-good:red]"`, or anywhere above the graph — with
**no inline style and no knowledge of which shadcn token a slot maps to**. The
slots are trazo's own stable vocabulary: `--trazo-lane-1…6`, `--trazo-primary`,
`--trazo-good`, `--trazo-bad`, `--trazo-pending`, `--trazo-streamed`,
`--trazo-neutral`, plus a `-foreground` variant of each for label text, and
`--trazo-bg` / `--trazo-accent` / `--trazo-muted` for surfaces.

**Layer 2 — the stock shadcn token (the default brand match).** The renderer
defaults each slot to a stock shadcn token (`primary`, `chart-1…5`,
`destructive`, `muted-foreground`) so an *unthemed* graph adopts the consuming
app's brand out of the box. In the JOYCO UI kit `--primary` *is* the brand blue,
so a JOYCO app renders on-brand with zero config. The `--color-*` alias is tried
before the raw `--<token>` because Tailwind v4 keeps `--color-*` inside
`@theme inline` and **tree-shakes** it unless a utility references it — a
renderer that used `var(--color-chart-1)` alone went **colorless** in apps that
never referenced that utility; the raw token always survives.

**Layer 3 — the hex.** Last-resort literal so illustrations are never colorless
in an app with no shadcn tokens at all. **Keep all three layers for any new
color** — build it with `themed()`.

Palettes (in `graph.tsx`):

- **Lanes** (git) — `LANE_VARS`, **6 distinct slots** `lane-1…6` (defaulting to
  `primary` then `chart-1…5`); `laneIndex` cycles mod 6 for a clean loop.
- **Roles** (flow) — `ROLE_VARS`: `primary→primary`, `good→chart-2`,
  `bad→destructive`, `pending→chart-4`, `streamed→chart-3`,
  `neutral→muted-foreground`.
- **Accent** — `"accent"` key → a neutral light gray (`--trazo-neutral` →
  `muted-foreground`); the default flow edge color.
- **Label color** — `LANE_FG_VARS` / `ROLE_FG_VARS` pair each fill with a
  readable text color (its own `-foreground` slot → shadcn `*-foreground` token
  → WCAG-picked black/white hex matching that slot's fallback fill). Keeps labels
  legible on the box regardless of the page foreground.

`nodeColor(key)` resolves any key: `"accent"` → gray, `role-*` → role palette,
else → lane palette. `nodeForeground(key)` mirrors it for label text.

### Theming example

```tsx
// Recolor specific slots — no inline style, no shadcn token names:
<Graph graph={g} className="[--trazo-good:#16a34a] [--trazo-bad:#dc2626]" />

// Or a reusable named theme in app CSS:
.trazo-ocean { --trazo-primary: #0369a1; --trazo-lane-2: #0891b2; }
```

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
