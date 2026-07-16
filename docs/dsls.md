# Playground DSLs

Two small, forgiving, line-based pseudo-code languages drive the playground
editor. Both: one statement per line, `#` starts a comment, blank lines ignored.
Parse errors return a 1-based line number + a friendly message, and the caller
keeps the **last good graph** rendered.

Source: `apps/playground/src/lib/dsl.ts` (git) and `flow-dsl.ts` (flow).

## Git DSL → `CommitGraph`

```
commit [<hash>] [(<author>)] [: <message>]
                              add a commit on the current branch (parent = tip).
                              hash optional (auto-derived, deterministic if absent);
                              (author) optional; : message optional.
branch <name>                 create <name> off the current tip and check it out.
checkout <name>               switch the current branch.
merge <name> [: <message>]    merge <name> into the current branch (two parents).
```

- Auto-generated ids (`c<N>` for anonymous commits, `m<N>` for merges) **skip
  any id the user already wrote** — a user commit literally named `m2` used to
  silently fuse with the second merge's auto id, dropping a commit from the
  layout. The counter only moves forward, so ids stay deterministic.
- First branch is `main`.
- A 6+ hex-digit token used as the commit id doubles as the hash; otherwise a
  **deterministic** pseudo-hash is derived from the id (FNV-1a — never random, so
  SSR stays reproducible).
- Backward compatible: plain `commit : msg` still works.

Example (the default seed reconstructs the "phantom merge conflicts" log story —
`main` + `elvira/checkout` + `homero/receipts`, with authors and hashes):

```
commit a1b2c3d (JOYCO)  : Initial commit
commit b2c3d4e (JOYCO)  : Base commit
branch elvira/checkout
commit (Elvira) : checkout: scaffold flow
commit (Elvira) : checkout: wire it up
checkout main
commit (Elvira) : Squash of elvira/checkout
```

## Flow DSL → `FlowGraph`

```
flow TD | flow LR             set layout direction (top-down / left-right). Default TD.
<node> --> <node>             a directed edge — NEUTRAL accent line (default).
<node> ==> <node>             a COLORED edge — takes its source box's role color.
<node> --- / === <node>       an undirected edge (no arrowhead; === is colored).
<node> <--> / <==> <node>     a bidirectional edge (arrowhead at BOTH ends).
<node> <-- / <== <node>       a REVERSED arrow: head at the SOURCE (from ← to),
                              still from → to for layout (a "based on" relation).
<node> -->|label| <node>      an edge carrying a label (works with every arrow).
                              Surrounding quotes are stripped like node labels:
                              |"base of"| and |base of| both read "base of";
                              a `<br/>`/`\n` wraps the label onto multiple lines.
<node>                        declare a node on its own line (also auto-declared
                              the first time it appears in an edge).
subgraph G ["Label"] … end    group the nodes declared until `end` in a container.
                              An optional trailing `:role` (after the label) tints
                              the container background — see Subgraphs below.
note <id> <side> "<text>"     a margin annotation on <id> (above|below|left|right),
                              with a leader arrow pointing at that face.
```

A **node ref** is `id` + an optional inline shape+label the first time the id
appears (later refs can be just the id), plus an optional `:role`:

```
id["label"]       box (default)        id(["label"])   stadium / terminal
id{"label"}       diamond / decision   id[("label")]   cylinder / store
B["slow"]:error     role tag → semantic color (primary|success|error|warning|info|neutral)
```

Shape delimiters are matched longest-first so `[(` (cylinder) wins over `[`
(box). This mirrors the Mermaid subset the JOYCO logs actually use (boxes,
stadium terminals, diamonds, cylinders, directed + labeled edges).

Example (default seed — a fan-out/fan-in from log 07, mixing accent and colored
edges):

```
flow TD
A(["Request arrives"]):primary ==> B["getCart() started"]:warning
A ==> C["getFlags() started"]:warning
A --> D["Render shell immediately"]:info
B ==> E["Stream data as promises settle"]:success
C --> E
D --> E
```

## Subgraphs (`subgraph … end`)

`subgraph <id> ["Label"] … end` wraps every node declared between the header and
`end` in a labeled container. Subgraphs are **single-level** (no nesting) and a
node belongs to **at most one** group (the first that declares it wins).

The header takes an optional trailing `:role`, mirroring the node/note suffix:

```
subgraph build ["Build"] :success    tinted container (role wash + matching border)
subgraph deploy :error                 tint a bare, unlabeled container
subgraph plain ["Plain"]               default: transparent box, neutral outline
```

The role must be one of the semantic keywords
(`primary|secondary|ghost|muted|neutral|success|warning|error|info`). It fills
the box with that role's color at a low opacity and paints the border in the
same color at full opacity, so the group reads as a tinted region without
obscuring its members. A non-role token (e.g. `:nope`) is **not** peeled — it
falls through and becomes part of the title. Like colors elsewhere, the tint
resolves through the `--trazo-<role>` token chain, so it follows the active
theme (see [rendering-and-brand.md](./rendering-and-brand.md)).

## Annotations (`note`)

A `note` hangs a free-floating callout off an existing node — a margin note with
a leader arrow — **without** dragging the target into the rank flow. This is the
right tool for a "☜ this one is the slow part" aside: modeling it as a real node
+ edge would fork the pipeline, because every ranked node participates in the
Sugiyama layering.

```
note <targetId> <side> "<text>" [:role]
```

- `<side>` is `above` | `below` | `left` | `right` — which side of the target the
  note sits on, and therefore which face its leader points at.
- `<text>` obeys the same quoting / `<br/>` / inline `` `code` `` rules as a node
  label. An optional trailing `:role` tints the note chip; the leader line stays
  the neutral accent color regardless.
- The target may be declared later (forward references resolve at layout time). A
  note whose target never resolves is silently dropped, like an edge to an
  unknown node.

A note is **excluded from ranking**: it never receives a rank, never generates a
dummy chain, and can never change which rank a real node lands in. It's placed
**centered on its target's cross-axis**, so the leader is a straight
perpendicular arrow — vertical for `above`/`below`, horizontal for `left`/`right`
— and the chip reads as aligned with its node. The layout emits it as a
`PositionedNode` flagged `kind: "note"` (rendered under `data-slot="annotation"`)
plus a leader `PositionedEdge` (`kind: "note"`). Multiple notes on one side stack
outward.

A note that would spill off-canvas **shifts the whole graph** to stay in frame (a
pure translation that keeps the note aligned and never clips), so real-node
coordinates are preserved only when no such shift is needed — e.g. the canonical
`LR` pipeline with a `below` note. There's **no collision routing**: a note placed
where a real node already sits — such as `below` a mid-pipeline node in a `TD`
flow, which lands between two ranks — will overlap it. Put the note on a side with
room (in `TD`, that's usually `left`/`right`; in `LR`, `above`/`below`).

```
flow LR
js["JS"] --- style["Style"] --- layout["Layout"] --- paint["Paint"] --- composite["Composite"]
note layout below "this one makes fps cry 😢"
```

renders the pipeline as a single straight line with the note below `Layout` and
an arrow pointing up at it.

## Edge color model (the `==>` distinction)

- `-->` → edge color key `"accent"` → renders in the neutral light gray.
- `==>` → edge color key `"role-<source role>"` → renders in the source node's
  semantic color.
- The default is intentionally neutral so a chart reads calmly; you opt specific
  arrows *into* color. Colored edges also **paint on top** of accent edges (the
  renderer partitions them) so they win where they overlap.
