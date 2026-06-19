# trazo

Deterministic code-to-diagram layout engine — flowcharts and git graphs.
Pure-TS core + optional React SVG renderers.

## The contract

The public API lives in `src/types.ts`, `src/index.ts`, and `src/react/`. The
layout engine and the renderer are built against it independently — treat a
signature change as breaking for every consumer.

### Core — `trazo` (".")

```ts
import { layout, layoutFlow, layoutGit, measure } from "trazo";
import type { FlowGraph, CommitGraph, PositionedGraph, FontSpec } from "trazo";

// flowchart
const flow: PositionedGraph = layoutFlow(input /* FlowGraph */, options?);
// git DAG
const git: PositionedGraph = layoutGit(input /* CommitGraph */, options?);
// dispatcher (routes on input.kind === "flow")
const g: PositionedGraph = layout(input, options?);

const w: number = measure("Subject", { family: "PublicSans", size: 13 });
```

Invariants:

- **Pure TS.** No DOM, no canvas, no `window`. Runs in Node so the server and
  client produce identical layouts.
- **Deterministic.** Equal input (same nodes/commits, same order) → equal
  `PositionedGraph`.
- **`measure` reads a bundled glyph-advance table** for the brand body font
  (Public Sans). No canvas. Unknown glyphs fall back to the table's average
  advance, so widths never depend on the runtime.

### React — `trazo/react`

```ts
import { Graph } from "trazo/react";
```

- React is an **optional peer dependency** — `import "trazo"` pulls in nothing.
- `<Graph graph={…} />` is a **pure function of its props**. It renders both as
  a Server Component (zero client JS — for static/hub illustrations) and when
  hydrated (for the playground's live preview), byte-identically. No hooks, no
  effects, no browser globals.
- Geometry is fully resolved by the layout functions; the renderer only maps a
  `PositionedGraph` to `<svg>`. Style via the JOYCO `data-slot` convention
  (root is `data-slot="trazo-graph"`).

## Build

`pnpm build` (tsup → ESM + d.ts). Exports map: `.` and `./react`.
`sideEffects: false`.
