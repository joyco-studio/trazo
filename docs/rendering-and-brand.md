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
root via `className="[--trazo-success:green]"`, or anywhere above the graph —
with **no inline style and no knowledge of which shadcn token a slot maps to**.
The slots are trazo's own stable vocabulary: `--trazo-lane-1…6`,
`--trazo-primary`, `--trazo-success`, `--trazo-error`, `--trazo-warning`,
`--trazo-info`, `--trazo-neutral`, plus a `-foreground` variant of each for
label text, and `--trazo-bg` / `--trazo-accent` / `--trazo-muted` for surfaces.

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
- **Roles** (flow) — `ROLE_VARS`: `primary→primary`, `success→chart-2`,
  `error→destructive`, `warning→chart-4`, `info→chart-3`,
  `neutral→muted-foreground`.
- **Accent** — `"accent"` key → a neutral light gray, the default flow edge
  color. Its own `--trazo-edge` slot (→ `muted-foreground`), deliberately NOT
  the `neutral` role slot: a theme that paints neutral node boxes (JOYCO uses
  black) must not drag every default edge along with them.
- **Sequence messages** adopt their **source participant's role** color (the
  `role-*` palette), the same way a flow `==>` edge tints to its source node's
  role. A message from a participant left at the default (no `:role`) keeps the
  neutral `accent` color — so an untouched diagram is unchanged and a themed
  neutral (JOYCO's black) never renders the arrows invisible. Emitted by
  `layout-sequence.ts`; block cells already carry `role-*` per cell.
- **Label color** — `LANE_FG_VARS` / `ROLE_FG_VARS` pair each fill with a
  readable text color (its own `-foreground` slot → shadcn `*-foreground` token
  → WCAG-picked black/white hex matching that slot's fallback fill). Keeps labels
  legible on the box regardless of the page foreground.

`nodeColor(key)` resolves any key: `"accent"` → gray, `role-*` → role palette,
else → lane palette. `nodeForeground(key)` mirrors it for label text.

### Theming example

```tsx
// Recolor specific slots — no inline style, no shadcn token names:
<Graph graph={g} className="[--trazo-success:#16a34a] [--trazo-error:#dc2626]" />

// Or a reusable named theme in app CSS:
.trazo-ocean { --trazo-primary: #0369a1; --trazo-lane-2: #0891b2; }
```

## The `TrazoTheme` object (`src/theme.ts`)

CSS-var theming covers colors; the **theme object** adds the geometry/style
knobs and packages everything as one authorable unit (what the playground's
theme editor edits). A theme has two halves, resolved at a single point each:

- **Layout half** → `themeFlowOptions(theme, base?)` / `themeGitOptions(theme,
  base?)` produce layout options: `padding` density preset (sm/default/lg
  scales padding + gaps together), `lanesMode`
  (angular = elbow45 | orthogonal | rounded | bezier → `edgeStyle`), git
  `laneGap` 0–10 (extra `laneWidth`), and `textCase`
  (uppercase | none — see below). Explicit `base` options win over the theme.
- **Paint half** → `<Graph theme={theme}>` calls `resolveThemePaint(theme)`
  (pure, SSR-safe): `tokens` become `--trazo-*` vars on the root `style`,
  `laneStyle` (solid/dashed/dotted) maps to stroke dasharray (+ round linecap
  for dots), `roundness` (none/sm/default/lg) is the box `rx`, `border`
  (none/default/large) is the chip-lift stroke width, `background`
  (none/solid/texture) draws a `canvas` rect (+ a 45° hatch drawn as ONE path —
  deliberately not an SVG `<pattern>`, so there is no DOM id to collide when
  several graphs share a page), and `textCase` sets `uppercase` (the label
  `text-transform`).
- New surface slots: `--trazo-canvas` (backdrop fill; defaults to `background`),
  `--trazo-canvas-hatch` (texture lines; defaults to `border`), and the inline-
  code chip pair `--trazo-code` (chip fill; defaults to `muted`) /
  `--trazo-code-foreground` (chip text; defaults to `foreground`).
- `theme.frame` ({ label, number }) is **reserved**: the playground renders the
  framed chips as HTML around the diagram today; declaring it on the theme
  keeps in-SVG embedding a non-breaking future step.
- `joycoTheme` (exported) is the house preset: padding sm, roundness none,
  angular lanes, solid, textured canvas, lane gap 0, border large. Its colors
  are intentionally unset — a JOYCO app's own shadcn tokens already carry the
  brand.
- Semantic roles now include `secondary`, `ghost`, `muted`, `info` (each with a
  `-foreground` slot). The keyword list is exported as `SEMANTIC_ROLES` (single
  source for the DSL parsers).

## Label casing (`textCase`)

Labels default to **uppercase** (the JOYCO look). A theme can opt out with
`textCase: "none"` to render text exactly as authored. Casing lives in BOTH
halves of the theme and they MUST agree or boxes crop:

- **Renderer** applies it as CSS `text-transform` — `labelStyleFor(uppercase)`
  in `graph.tsx` picks `UPPERCASE` (transform + tracking) or `LABEL_TRACKING`
  (tracking only). The `letter-spacing: 0.02em` tracking is applied in EITHER
  casing, so the two variants differ only in `text-transform`.
- **Engine** measures the same casing — `applyCase(text, textCase)` in
  `geometry.ts` replaces the old hard-coded `.toUpperCase()`. The casing flows in
  through the layout options (`LayoutOptions.textCase` /
  `FlowLayoutOptions.textCase`), set by `themeGitOptions` / `themeFlowOptions`.

Because the renderer transforms visually while the engine measures the cased
string, a lowercase-heavy label reserves LESS width under `"none"` than under
`"uppercase"` (caps are wider) — the box sizes to what is drawn either way.

## Inline `code` in flow-node labels

A flow node label may contain `` `backtick` ``-delimited inline code, rendered
in a monospace chip. The whole path is pure and SSR-safe:

- **Parse** — `parseInlineRuns(line)` in `geometry.ts` splits a display line into
  prose and `code` runs, consuming the backticks (an unclosed tick stays literal
  prose; empty `` `` `` spans are dropped). The label stays a flat string
  end-to-end (backticks survive parsing/layout); both the engine and the renderer
  parse it, so there is no rich data model to thread.
- **Measure** — code has no bundled glyph table, but a monospace font's advance
  is CONSTANT, so `measureRun` models a code run as `chars × 0.6em + 2×pad`
  (`CODE_CHIP_PAD_X`). `measureMultiline` sums runs per line, so boxes reserve
  room for the chip. Code is exempt from casing AND from the sans tracking.
- **Render** — `renderFlowLabel` in `graph.tsx` lays a coded line out run-by-run
  from a computed start-x (SVG `<tspan>`s can't have backgrounds), drawing a
  rounded `<rect>` (`data-slot="label-code-chip"`, fill `--trazo-code`) behind a
  monospace `<tspan>` (`data-slot="label-code"`, `--font-mono`, fill
  `--trazo-code-foreground`, `text-transform:none`). It uses the SAME per-run
  widths the engine reserved, so text and chips line up. A line with no code
  keeps the simple single centered `<tspan>` (unchanged geometry).

> Scope: inline code is a flow-node-label feature. Git commit badges, group /
> note titles, lane and edge labels do not parse backticks.

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
