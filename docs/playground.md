# Trazo Playground (`apps/playground`)

A Next.js (App Router) app to author and preview diagrams against the engine,
SSR-first. JOYCO on-brand chrome (the bento/console aesthetic from `@joyco/ui`).

## Layout

- **Header / footer** — bento bars; the JOYCO icon (`public/joyco-icon-128.png`,
  also the favicon via `app/icon.png`), brand title, view-source hint.
- **Left pane** — the editor: a textarea for the DSL, a git/flowchart mode
  toggle (Tabs, **flowchart first / default**), an error or status line.
- **Right pane** — the live preview inside a pan/zoom viewport, plus the
  edge-style (45°) toggle and dimensions readout.

The page reads as a grid of bento cells: transparent `Cluster` containers, each
leaf child owns its `bg-*`, `gap-px` seams over a muted field, no borders, radius
0. (See the JOYCO `joyco-ui` skill for the kit conventions.)

## Files

| File | Role |
| --- | --- |
| `src/app/page.tsx` | **Server component.** Parses the SEED, lays it out, renders the SSR `<Graph>`, passes seed + layout to the inspector. **This is where the default diagram is chosen.** |
| `src/components/inspector.tsx` | **Client island.** Mode tabs, per-mode source, debounced re-layout, edge-style state, renders `<GraphViewport><Graph/></GraphViewport>`. |
| `src/components/graph-viewport.tsx` | Pan/zoom/fit/reset wrapper (see below). |
| `src/lib/dsl.ts` | Git DSL + `SEED_PROGRAM` (the git seed). |
| `src/lib/flow-dsl.ts` | Flow DSL + `SEED_FLOW` (the flow seed). |

## The pan/zoom/fit viewport

`graph-viewport.tsx` — hand-rolled (no library), modeled on `atlas-cropper`:

- An outer container (fills the pane, `overflow-hidden`, `overscroll-contain`,
  `touch-none`) and an inner wrapper with
  `transform: translate(panX, panY) scale(zoom)`, `transform-origin: 0 0`.
- **Fit-to-view = reset:** `fitZoom = min(1, max(MIN, min((vpW-margin)/gw,
  (vpH-margin)/gh)))`, centered pan. Runs on mount + container resize
  (ResizeObserver) + new graph + the Fit button. Capped at 1 (never upscales to
  fit).
- **Wheel zoom**, cursor-anchored. **Drag pan** via pointer events.
- **Controls** (kit `Button` + lucide icons): zoom −, % readout, zoom +, Fit.
- **SSR-safe:** initial transform is identity (zoom 1, pan 0) so the server HTML
  matches the first client render; fit is applied post-mount.

## Mode toggle + theme editor

- **Mode** (git / flowchart / sequence / block) lives in the inspector. Each
  mode keeps its own source so switching tabs never loses work. Server seeds
  **flow** by default.
- **Theme editor** (`theme-panel.tsx`, a right-hand sheet) replaced the old 45°
  switch: it edits ONE `TrazoTheme` — presets (`joyco` default / `soft`, in
  `lib/themes.ts`), the knobs (padding, roundness, lanes mode, lane style,
  lane gap, background, border), the framed label/number chips, and every color
  token (role pairs, surfaces, git lanes). Any edit forks the preset into
  "custom" (copy-on-write). Export copies JSON (for `<Graph theme>`) or a
  `--trazo-*` CSS block.
- The layout half applies via `themeFlowOptions`/`themeGitOptions` inside
  `build()`; the paint half via `<Graph theme>`. **The server page lays out the
  seed with the SAME `DEFAULT_THEME`** (`lib/themes.ts`), or hydration would
  mismatch — keep both sides in sync when changing the default.
- The lib's `joycoTheme` is colorless; the playground's `JOYCO_PRESET` pins the
  explicit mock palette (canvas #171717 + hatch, primary #0011ff, neutral black,
  warning yellow, error orange-red, success green) so the default is the exact
  "cara visible" and exports carry real color codes.
- The `frame` chips render as HTML over the preview pane (not in the SVG);
  the theme schema reserves `frame` so in-SVG rendering stays a non-breaking
  future step.

## Documents (multi-graph + localStorage)

`src/hooks/use-graph-docs.ts` — each mode holds a LIST of documents, so you can
start a fresh diagram from the seed (`+`) without losing the one you were
editing, switch between them (numbered pills next to the mode tabs), and delete
the current one (`×`; the last doc resets to the seed instead of disappearing).

Everything persists to localStorage (`trazo-playground-docs-v1`, debounced).
Hydration-safe by construction: the initial render is exactly the SSR seeds;
the persisted state is swapped in post-mount, and the hook bumps `restoredAt`
so the inspector re-layouts the restored source once. If the stored payload is
malformed (schema drift), it's ignored and the next edit overwrites it.

## Running

```bash
pnpm --filter playground dev      # http://localhost:3000
# engine changes need packages/trazo rebuilt first (or run its tsup --watch)
```
