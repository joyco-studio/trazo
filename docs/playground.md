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

## Mode + edge-style toggles

- **Mode** (git / flowchart) lives in the inspector. Each mode keeps its own
  source so switching tabs never loses work. Server seeds **flow** by default.
- **Edge style** (45° on/off) flips `edgeStyle` between `"elbow45"` and
  `"orthogonal"`, threaded into both `layoutGit` and `layoutFlow`. Re-layouts
  immediately.

## Running

```bash
pnpm --filter playground dev      # http://localhost:3000
# engine changes need packages/trazo rebuilt first (or run its tsup --watch)
```
