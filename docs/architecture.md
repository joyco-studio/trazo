# Architecture

## Monorepo shape

```
trazo/                       # pnpm workspaces + turbo. GitHub: joyco-studio/trazo
├── packages/trazo/          # the engine (npm package name: "trazo")
│   ├── src/
│   │   ├── types.ts         # the public contract (input + output types)
│   │   ├── index.ts         # public entry: layout, layoutGit, layoutFlow, measure
│   │   ├── layout-git.ts    # git commit-DAG → lane layout
│   │   ├── layout-flow.ts   # generic flow graph → Sugiyama layered layout
│   │   ├── geometry.ts      # shared: shape sizing, anchors, edge paths, label measuring
│   │   ├── measure.ts       # pure glyph-advance text measurement
│   │   ├── fonts/public-sans.ts  # GENERATED glyph-width table (Public Sans)
│   │   └── react/graph.tsx  # the <Graph> SVG renderer (optional peer dep on React)
│   └── test/                # vitest: determinism + structural assertions
└── apps/playground/         # Next.js app "Trazo Playground" (pnpm name: "playground")
    └── src/
        ├── app/page.tsx     # server component: SSR seed render
        ├── components/inspector.tsx     # client island: live editor + preview
        ├── components/graph-viewport.tsx# pan/zoom/fit wrapper
        ├── lib/dsl.ts       # git pseudo-code → CommitGraph
        └── lib/flow-dsl.ts  # flow pseudo-code → FlowGraph
```

- **Package manager:** pnpm (workspaces). **Task runner:** turbo (`pnpm build`
  builds `trazo` then `playground` in dependency order).
- **The app consumes the engine via `workspace:*`** and imports its built
  `dist/`. If you change engine source, rebuild `packages/trazo` (or run its
  `tsup --watch`) before the app picks it up.

## Naming history (important when reading old commits)

This project was renamed mid-build. If you see old names, they map as:

| Old | New | Notes |
| --- | --- | --- |
| `rama` (package) | **`trazo`** | dir `packages/rama` → `packages/trazo`; imports `"rama"`/`"rama/react"` → `"trazo"`/`"trazo/react"`; `data-slot="rama-graph"` → `"trazo-graph"`. |
| `mirador` (app) | **playground** | dir `apps/mirador` → `apps/playground`; display name "Trazo Playground". |
| `rama-mirador` (root) | `trazo-monorepo` | root package name. |

The GitHub repo and the product were always **trazo** ("code-to-diagram engine
for flowcharts and git graphs").

## How a diagram flows through the system

```
pseudo-code (DSL)  ──parse──▶  CommitGraph | FlowGraph
                                      │
                              layoutGit | layoutFlow        (pure, deterministic, Node-safe)
                                      │
                              PositionedGraph               (nodes x/y + edges as SVG `d` strings)
                                      │
                              <Graph graph={…} />            (pure prop→SVG, SSR or hydrated)
                                      │
                                 inline <svg>
```

The **engine emits color/role *keys*, never literal colors** — the renderer owns
the palette. The **engine resolves all geometry** (including edge curves as SVG
path strings) — the renderer never computes layout. This split is what keeps the
renderer a trivial pure function and lets the same `PositionedGraph` be rendered
by anything (the playground, the hub, a static script).

## Two diagram families, one engine

A generic directed-graph core powers both:

- **git** (`layoutGit`): commit DAG → columns/lanes, branch/merge edges.
- **flow** (`layoutFlow`): generic nodes/edges → Sugiyama layered layout (TD/LR),
  with box/stadium/diamond/cylinder shapes and semantic roles.

Both produce the **same `PositionedGraph` output type**, so the renderer and any
consumer treat them uniformly. See [engine-contract.md](./engine-contract.md).
