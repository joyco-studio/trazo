# rama

Deterministic git-graph layout engine. Pure-TS core + optional React SVG renderers.

## The frozen contract

This package's **public API is frozen** (`src/types.ts`, `src/index.ts`,
`src/react/`). The layout engine and the renderers are built against it
independently. Don't change a signature without treating it as a breaking
change to every consumer.

### Core — `rama` (".")

```ts
import { layout, measure } from "rama";
import type { CommitGraph, PositionedGraph, FontSpec } from "rama";

const graph: PositionedGraph = layout(input /* CommitGraph */, options?);
const w: number = measure("commit subject", { family: "PublicSans", size: 13 });
```

Invariants:

- **Pure TS.** No DOM, no canvas, no `window`. Runs in Node so the server and
  client produce identical layouts.
- **Deterministic.** Equal `CommitGraph` (same commits, same order) → equal
  `PositionedGraph`.
- **`measure` reads a bundled glyph-advance table** for the brand body font
  (Public Sans). No canvas. Unknown glyphs fall back to the table's average
  advance, so widths never depend on the runtime.

### React — `rama/react`

```ts
import { Graph } from "rama/react";
```

- React is an **optional peer dependency** — `import "rama"` pulls in nothing.
- `<Graph graph={…} />` is a **pure function of its props**. It must render
  both as a Server Component (zero client JS — for hub illustrations) and when
  hydrated (for mirador's live preview), byte-identically. No hooks, no
  effects, no browser globals.
- Geometry is fully resolved by `layout()`; the renderer only maps a
  `PositionedGraph` to `<svg>`. Style via the JOYCO `data-slot` convention.

## Build

`pnpm build` (tsup → ESM + d.ts). Exports map: `.` and `./react`.
`sideEffects: false`.
