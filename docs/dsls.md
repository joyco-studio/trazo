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
<node> -->|label| <node>      an edge carrying a label (works with ==> too).
<node>                        declare a node on its own line (also auto-declared
                              the first time it appears in an edge).
```

A **node ref** is `id` + an optional inline shape+label the first time the id
appears (later refs can be just the id), plus an optional `:role`:

```
id["label"]       box (default)        id(["label"])   stadium / terminal
id{"label"}       diamond / decision   id[("label")]   cylinder / store
B["slow"]:bad     role tag → semantic color (primary|good|bad|pending|streamed|neutral)
```

Shape delimiters are matched longest-first so `[(` (cylinder) wins over `[`
(box). This mirrors the Mermaid subset the JOYCO logs actually use (boxes,
stadium terminals, diamonds, cylinders, directed + labeled edges).

Example (default seed — a fan-out/fan-in from log 07, mixing accent and colored
edges):

```
flow TD
A(["Request arrives"]):primary ==> B["getCart() started"]:pending
A ==> C["getFlags() started"]:pending
A --> D["Render shell immediately"]:streamed
B ==> E["Stream data as promises settle"]:good
C --> E
D --> E
```

## Edge color model (the `==>` distinction)

- `-->` → edge color key `"accent"` → renders in the neutral light gray.
- `==>` → edge color key `"role-<source role>"` → renders in the source node's
  semantic color.
- The default is intentionally neutral so a chart reads calmly; you opt specific
  arrows *into* color. Colored edges also **paint on top** of accent edges (the
  renderer partitions them) so they win where they overlap.
