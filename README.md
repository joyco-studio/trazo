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
| **[`packages/trazo`](packages/trazo)** | The engine. A pure-TS layout core (`layout`, `layoutGit`, `layoutFlow`, `measure`) + optional React SVG renderer (`trazo/react`). No DOM, no canvas, no `window` — runs in Node, deterministic, SSR-safe. |
| **[`apps/playground`](apps/playground)** | The inspector. A Next.js app: pseudo-code on the left, a live server-rendered diagram on the right. Flowchart and git modes, on-brand JOYCO chrome. |

`trazo` is the library you'd ship; `Trazo Playground` is how you author and preview against it.

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
  static illustrations) **and** hydrated (for Trazo Playground's live preview), producing
  identical markup either way.
- **On-brand by default.** Adopts your app's shadcn `--primary` and chart tokens
  for lane/role colors, square
  commit nodes, hard 45° edge elbows, uppercase labels, the bento console
  aesthetic from the `@joyco/ui` kit. Colors ship with layered CSS-var fallbacks
  so illustrations are never colorless in any consuming app.

## Diagram syntax

The two pseudo-code languages — **flow** (flowcharts) and **git** (commit
graphs) — are documented in full in **[`SYNTAX.md`](apps/playground/public/syntax.md)**.
The running playground serves the same file at **`/syntax.md`** (e.g.
`https://<your-deploy>/syntax.md`), so LLMs and tooling can fetch the spec
directly before generating diagram source.

The essentials:

```
# FLOW — flowcharts
flow TD                     # or LR; TD is the default
A["Start"] --> B{"Decide?"} # box, diamond; --> neutral edge, ==> colored edge
B -->|Yes| C(["Done"])      # labeled edge; stadium terminal
B -->|No|  D[("store")]:bad # cylinder; :role colors a node

# GIT — commit graphs
commit a1b2c3d (JOYCO) : init   # [hash] (author) : message — all optional
branch feature                  # branch off the tip and check it out
commit : sketch solver
checkout main
merge feature : land it         # two-parent merge commit
```

See [`SYNTAX.md`](apps/playground/public/syntax.md) for shapes, roles, edge
colors, cycles/loops, and the full git grammar.

## Quick start

```bash
pnpm install
pnpm build          # turbo: builds trazo, then the playground
pnpm --filter playground dev
```

Open <http://localhost:3000>. It boots on **flowchart** mode by default — type in
the left pane and watch the diagram recompute. Toggle to **git** for branch/merge
graphs. View-source on the page to confirm the `<svg>` is in the initial HTML.

### Using the engine directly

```ts
import { layoutFlow, layoutGit } from "@joycostudio/trazo";
import { Graph } from "@joycostudio/trazo/react"; // optional — React is a peer dep

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

See [`packages/trazo/README.md`](packages/trazo/README.md) for the full contract.

## Scripts

Run from the repo root (turbo fans out across the workspace):

| Command | Does |
| --- | --- |
| `pnpm build` | Build `trazo` → `Trazo Playground` in dependency order |
| `pnpm dev` | Run dev servers |
| `pnpm test` | Run the `trazo` test suite (layout determinism, flow, measure) |
| `pnpm typecheck` | Type-check every package |
| `pnpm lint` | Lint every package |

## Stack

pnpm workspaces · turbo · TypeScript · Next.js (App Router) · Tailwind v4 ·
[`@joyco/ui`](https://hub.joyco.studio/toolbox/ui) · tsup · vitest

---

Built at [JOYCO](https://joyco.studio).
