# SSR, purity, and determinism

These three properties are the reason trazo exists as a separate engine instead
of a client-only diagram library. They are easy to break by accident, so this
doc explains *why* each rule is there.

## The goal

Render on-brand diagram SVGs **into the initial HTML**, with **zero client JS**
required for the static case — so the JOYCO logs (and the hub) can embed
programmatic illustrations that are crawlable, fast, and identical everywhere.
The playground additionally hydrates the same renderer for a live editor.

## Why the renderer must be pure

`<Graph>` (in `trazo/react`) is a **pure function of its props**: no hooks, no
effects, no event handlers, no browser globals. This buys two things at once:

1. **It runs as a React Server Component** → the `<svg>` is in the server HTML
   with no client JS shipped for it.
2. **It hydrates byte-identically** → the playground can take the same
   server-rendered markup, then recompute and re-render in the browser on edit,
   with **no hydration mismatch**.

If you add a hook/effect/`window` access to the renderer, you lose the
server-component path (the hub use-case) and risk hydration warnings. Don't.

## Why the core must be pure + deterministic

`layout*` and `measure` run on the **server** (and the client). If text width
came from a `<canvas>` (the usual trick), the server couldn't measure it and the
two environments would disagree → different geometry → hydration mismatch and
non-reproducible output.

So:

- **No canvas / DOM.** Text width is `measure()`, a pure sum over a bundled
  glyph-advance table (see [engine-contract.md](./engine-contract.md)). Same
  bytes in Node and browser.
- **Deterministic.** Equal input → equal output. Every ordering/tie-break is a
  fixed function of the caller's input array index. No `Math.random`, no `Date`,
  no dependence on `Map`/`Set` iteration order for anything that affects output.
  This is what lets the server pre-render a graph and the client recompute the
  *exact same* graph on hydration.

## How the playground wires it (SSR-first, hydrate-to-live)

1. `app/page.tsx` (a **server component**) parses the seed DSL → `layoutFlow` →
   passes the resulting `PositionedGraph` + seed source to the client island.
   The `<Graph>` SVG is in the initial HTML.
2. `inspector.tsx` (`"use client"`) is seeded with the **same** source and the
   **same** server-computed layout, so its first render matches the server's
   markup exactly → no flicker, no mismatch.
3. On edit it re-parses → `layout*` → re-renders `<Graph>` in the browser
   (debounced). No server round-trip per keystroke.
4. The pan/zoom viewport starts at an **identity transform** on the server and
   applies fit-to-view only *after mount* — so the server HTML and first client
   render are identical (the transform is the one thing that legitimately
   differs post-hydration).

## How to verify SSR didn't break

Build + start the app, then check the raw HTML before any JS runs:

```bash
pnpm --filter playground build && pnpm --filter playground start
# in another shell:
curl -s http://localhost:3000/ | grep -c '<svg'      # expect ≥1
curl -s http://localhost:3000/ | grep -c '<path'     # edges present
curl -s http://localhost:3000/ | grep 'scale(1)'     # viewport identity transform
```

Or just open the page and **View Source** (not devtools — view-source shows the
server HTML). The graph `<svg>` with `<path>`/`<rect>`/`<circle>` must be there.
