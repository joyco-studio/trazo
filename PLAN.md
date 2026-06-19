# trazo — rename + viewer + edge/label polish + rich git example

Monorepo now at ~/Documents/JOYCO/trazo (GitHub joyco-studio/trazo, main tracks origin).
Seven asks, grouped:

## 1. Rename
- Package `rama` → `trazo`: `packages/rama/package.json` name, the dir stays `packages/rama` OR rename to `packages/trazo` (rename dir for cleanliness). Update workspace globs if needed.
- All imports `from "rama"` / `"rama/react"` → `"trazo"` / `"trazo/react"` in mirador (page.tsx, inspector.tsx, flow-dsl.ts, dsl.ts) and the package's own re-export comments.
- `tsup`/exports stay `.` + `./react`.
- mirador app display name → "Trazo Playground" (metadata title, header h1, README). Keep the package name `mirador` or rename to `playground`? → keep dir `apps/mirador`, change the *product/display* name to "Trazo Playground".
- Root package.json name already `trazo`. Update root README references rama→trazo, mirador→Trazo Playground.

## 2. Preview pan/zoom/fit (ref: atlas-cropper)
New client component `apps/mirador/src/components/graph-viewport.tsx` wrapping `<Graph>`:
- Hand-rolled (atlas has no lib). Model: `<g transform="translate(panX,panY) scale(zoom)">` inside an outer fixed-size `<svg>` OR a div-wrapper with CSS transform around the Graph svg. Cleanest: outer container div sized to the pane; inner wrapper gets `transform: translate(pan) scale(zoom)`.
- **Fit-to-container** (= reset): `fitZoom = max(0.05, min((vpW-margin)/gw, (vpH-margin)/gh))`; pan centers content: `((vpW - gw*fit)/2, (vpH - gh*fit)/2)`. Run on mount + when graph dims change + on Reset button + when switching mode.
- **Wheel zoom** cursor-anchored (atlas math): `imgX=(cursorX-pan.x)/old; pan.x=cursorX-imgX*new`. Plain wheel = pan (trackpad), no modifier needed since this is a dedicated canvas (atlas required Ctrl; here the preview owns scroll → zoom on wheel, pan on drag). overscroll-behavior contain.
- **Drag pan** via pointer events (down→move→up), cursor grab/grabbing, disable text selection during drag.
- Controls (bottom-left or top-right of preview, on-brand kit Buttons): zoom −, zoom %, zoom +, and a Reset/recenter (fit). aria-labels on icon buttons. ZOOM_MIN .05 / MAX 5.
- Graph svg must size to its intrinsic width/height (not max-w-full) so fit math has a real content size.

## 3. Perpendicular edge exits + edge-style mode (engine)
In `packages/rama/src/geometry.ts` (exitAnchor/entryAnchor + path builders) and layouts:
- **Always exit/enter perpendicular (90°) to the box face**, then turn. Currently flow anchors/paths can leave at an angle. Add a short perpendicular "stub" off each node face before the elbow logic: from exit anchor, go straight along the face-normal by a small stub, THEN do elbow/45° turns, THEN a perpendicular stub into the target face.
- **edgeStyle option** `'elbow45' | 'orthogonal'` on `FlowLayoutOptions` + `LayoutOptions` (default `'elbow45'`). orthogonal = 90° elbows only (the existing `elbow45` keeps the 45° diagonal). Thread through `pathThrough`/`curveBetween` (pass style param). Keep determinism + tests.
- mirador: a toggle in the preview chrome (segmented/switch from kit) to flip edgeStyle live; re-layout on change.

## 4. Git labels as sliced-corner Badge (SVG, in renderer)
In `packages/rama/src/react/graph.tsx` git label rendering:
- Draw a sliced-corner `<path>` behind each git commit label (and optionally flow edge labels). Chamfer geometry from hub Badge: top-left + bottom-right cut at c=6px → `M c,0 L W,0 L W,H-c L W-c,H L 0,H L 0,c Z`.
- Badge fill = a muted/card token (`var(--color-muted, …)` w/ fallback) or primary for emphasis; text uppercase mono, ~10px font, padding ~10px/4px. Need the label width (have labelWidth) + a height const → size the badge rect, place it behind the text at x=node.x+NODE_HALF+LABEL_GAP. Keep pure SVG / SSR-safe.
- The layout width calc already reserves labelWidth; bump it to include badge padding so nothing crops.

## 5. Git commit square border = bg color
In graph.tsx git node `<rect>`: change `stroke={FG}` → `stroke="var(--color-background, var(--background, #0a0a0a))"` so the square reads as a chip lifted off the lane lines (border matches page bg). Slightly wider stroke maybe (1.5).

## 6. Rich git example (branch names, authors, hashes) — model + DSL + renderer + seed
- **types.ts** `Commit`: add optional `author?: string`, `hash?: string` (short). Keep `branch`, `message`. `PositionedNode`: carry author/hash through.
- **git DSL** (`apps/mirador/src/lib/dsl.ts`): extend `commit` syntax to accept author/hash, e.g. `commit <hash> (<author>) : <message>` or a small key syntax. Keep it forgiving + backward compatible. Auto-generate short hash if absent.
- **renderer**: show branch ref labels (refs exist) as badges at branch tips; render hash (mono, dim) + author near commit. Don't overcrowd — hash + message in the label badge, author secondary. (Tune.)
- **seed**: reconstruct the phantom-merge-conflicts story: main A→B; elvira/checkout e1→e2 (author Elvira); homero/receipts (stacked off e2) h1→h2 (author Homero); squash S on main; then the rebased h1'→h2'. Annotate so the "left behind e1/e2" punchline reads. This replaces or augments SEED_PROGRAM with a richer default.

## Verify
- rama: tsc, vitest (determinism + new edgeStyle/anchor + author/hash), tsup.
- mirador: build, SSR curl (flow seed svg in HTML, colored, sliced-badge paths present, perpendicular exits), pan/zoom/fit interactive (manual dev check).
- Commit in logical chunks; push (PR-protected main — bypass works but note it).

## Open decisions resolved with user
- #4 sliced badge → SVG path (pure renderer). #3 → per-layout option + UI toggle, always perpendicular exit. #6 → extend Commit + DSL + renderer.
