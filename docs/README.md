# trazo docs

Reference docs for the **trazo** code-to-diagram engine and the **Trazo
Playground** app. These capture the non-obvious design decisions and gotchas —
not a re-listing of the source.

| Doc | What it covers |
| --- | --- |
| [architecture.md](./architecture.md) | The monorepo shape, the rama→trazo rename history, how the engine + app fit together. |
| [engine-contract.md](./engine-contract.md) | The public API: input/output types, `layout`/`layoutGit`/`layoutFlow`/`measure`, layout options, the invariants that must never break. |
| [ssr-and-determinism.md](./ssr-and-determinism.md) | Why the renderer is pure, how SSR-first + client-hydrate works without hydration mismatch, and why `measure()` exists. |
| [dsls.md](./dsls.md) | The two playground pseudo-code languages: the git DSL and the flow DSL (grammar, shapes, roles, edge colors). |
| [rendering-and-brand.md](./rendering-and-brand.md) | SVG rendering conventions: the JOYCO aesthetic (squares, 45° edges, sliced badges, colors), the color-token fallback strategy, label measuring/tracking. |
| [playground.md](./playground.md) | The app: SSR-first inspector, the pan/zoom/fit viewport, mode + edge-style toggles. |
| [ops-and-gotchas.md](./ops-and-gotchas.md) | The pnpm `ERR_PNPM_IGNORED_BUILDS` CI saga (and its real fix), the JOYCO UI kit pitfalls, and other traps that cost real time. |
| [edge-label-collision.md](./edge-label-collision.md) | Known limitation: edge labels don't reserve layout space (dagre's label-dummy-node approach), current mitigations, and the implementation spec if it ever bites. |

## TL;DR

- **trazo** (`packages/trazo`) is a pure-TS layout engine: feed it a commit DAG
  or a flow graph, get back a `PositionedGraph` (nodes with x/y + edges as SVG
  path strings). An optional `trazo/react` renders it to inline `<svg>`.
- It is **deterministic** (equal input → equal output) and **pure** (no DOM /
  canvas / `window`), so the same diagram renders identically on the server and
  the client. That's the whole point: programmatic, server-rendered, on-brand
  SVG illustrations for the JOYCO logs.
- **Trazo Playground** (`apps/playground`) is a Next.js app to author and preview
  diagrams against the engine, SSR-first.
