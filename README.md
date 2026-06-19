# trazo

Code-to-diagram engine for flowcharts and git-history graphs — server-rendered,
on-brand SVG, zero client JS required.

Write a few lines of pseudo-code, get a deterministic SVG illustration. Built so
the JOYCO logs (and anything else) can author diagrams programmatically and
render them in the initial HTML — no canvas, no client runtime, identical on the
server and the client.

```
flow TD                                    commit : init repo
A(["Request"]):primary --> B["work"]       branch feature
A --> C["render shell"]:streamed           commit : sketch solver
B --> D["stream"]:good                      checkout main
C --> D                                     merge feature : land it
```

## What's inside

A pnpm + turbo monorepo with two pieces:

| Package | What it is |
| --- | --- |
| **[`packages/rama`](packages/rama)** | The engine. A pure-TS layout core (`layout`, `layoutGit`, `layoutFlow`, `measure`) + optional React SVG renderer (`rama/react`). No DOM, no canvas, no `window` — runs in Node, deterministic, SSR-safe. |
| **[`apps/mirador`](apps/mirador)** | The inspector. A Next.js app: pseudo-code on the left, a live server-rendered diagram on the right. Flowchart and git modes, on-brand JOYCO chrome. |

`rama` is the library you'd ship; `mirador` is how you author and preview against it.

## The idea

- **Two diagram families from one engine.** A generic directed-graph core powers
  both a Sugiyama-style **flowchart** layout (TD/LR, box/stadium/diamond/cylinder
  nodes, semantic roles) and a **git** lane layout (branch/merge DAGs). Both emit
  the same `PositionedGraph` (nodes with x/y, edges as SVG path strings).
- **Deterministic + pure.** Equal input always yields an equal layout. Text width
  comes from a bundled Public Sans glyph table (`measure`), never a canvas — so
  widths are byte-identical server- and client-side.
- **SSR-first.** The `<Graph>` renderer is a pure function of its props with no
  hooks or effects, so it renders as a React Server Component (zero client JS, for
  static illustrations) **and** hydrated (for mirador's live preview), producing
  identical markup either way.
- **On-brand by default.** joyco-blue primary with semantic role colors, square
  commit nodes, hard 45° edge elbows, uppercase labels, the bento console
  aesthetic from the `@joyco/ui` kit. Colors ship with layered CSS-var fallbacks
  so illustrations are never colorless in any consuming app.

## Quick start

```bash
pnpm install
pnpm build          # turbo: builds rama, then mirador
pnpm --filter mirador dev
```

Open <http://localhost:3000>. It boots on **flowchart** mode by default — type in
the left pane and watch the diagram recompute. Toggle to **git** for branch/merge
graphs. View-source on the page to confirm the `<svg>` is in the initial HTML.

### Using the engine directly

```ts
import { layoutFlow, layoutGit } from "rama";
import { Graph } from "rama/react"; // optional — React is a peer dep

const flow = layoutFlow({
  kind: "flow",
  nodes: [
    { id: "a", label: "Request", shape: "stadium", role: "primary" },
    { id: "b", label: "Work" },
  ],
  edges: [{ from: "a", to: "b" }],
});

// <Graph graph={flow} /> renders it as an inline <svg>, server or client.
```

See [`packages/rama/README.md`](packages/rama/README.md) for the full contract.

## Scripts

Run from the repo root (turbo fans out across the workspace):

| Command | Does |
| --- | --- |
| `pnpm build` | Build `rama` → `mirador` in dependency order |
| `pnpm dev` | Run dev servers |
| `pnpm test` | Run the `rama` test suite (layout determinism, flow, measure) |
| `pnpm typecheck` | Type-check every package |
| `pnpm lint` | Lint every package |

## Stack

pnpm workspaces · turbo · TypeScript · Next.js (App Router) · Tailwind v4 ·
[`@joyco/ui`](https://hub.joyco.studio/toolbox/ui) · tsup · vitest

---

Built at [JOYCO](https://joyco.studio).
