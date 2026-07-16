# Trazo diagram syntax

Trazo turns a few lines of line-based pseudo-code into a deterministic,
server-rendered SVG diagram. There are **two languages**: a **flow** DSL (for
flowcharts) and a **git** DSL (for commit-history graphs). This document is the
authoritative reference for both — written so an LLM or a human can produce
correct source on the first try.

> This file is also served live at `/syntax.md` and is the same text the
> playground links to. If you are an LLM generating Trazo source, read this whole
> document first, then emit **only** valid statements from the grammar below.

## Universal rules (both languages)

- **One statement per line.** Order matters (it drives deterministic layout).
- `#` starts a comment — everything after it on the line is ignored.
- **Blank lines are ignored.**
- Parse errors report a **1-based line number** and a friendly message; the last
  valid diagram stays rendered, so a single bad line never blanks the canvas.
- The first non-comment line **chooses the language**:
  - starts with `flow` / `flowchart` → **flow DSL**
  - starts with `commit` / `branch` / `checkout` / `merge` → **git DSL**
- Output is **deterministic**: the same source always produces the same diagram
  (no randomness, no timestamps). Re-ordering lines can change the layout.

---

# Flow DSL (flowcharts)

A forgiving subset of Mermaid's `flowchart`. Use it for decision trees, request
flows, pipelines, state machines.

## Direction

```
flow TD          # top-down (default)
flow LR          # left-right
flowchart TD     # "flowchart" is accepted as an alias for "flow"
TD               # a bare direction token also works
```

Put the direction on the **first line**. `TD` lays ranks out top→bottom; `LR`
lays them left→right. If omitted, the direction is `TD`.

## Nodes

A **node** is an `id` plus an optional shape+label and an optional role.

```
id["label"]        box            (the default shape)
id(["label"])      stadium        rounded "pill" / terminal (start, end)
id{"label"}        diamond        decision
id[("label")]      cylinder       data store / database
```

- The **id** is a short token of letters, digits, or underscores
  (`A`, `step1`, `get_cart`). It is how you refer to the node in edges.
- The **label** is the visible text. Quotes around it are optional but
  **recommended** when the label contains spaces or punctuation:
  `B["Is it working?"]`. Both `"..."` and `'...'` work.
- A node only needs its shape+label **the first time** it appears. After that,
  refer to it by id alone — later refs reuse the first declaration.
- You can declare a node on its own line, but you usually don't need to: any id
  used in an edge is **auto-declared** the first time it appears.

### Roles (semantic color)

Append `:role` after a node declaration to color it semantically:

```
B["slow call"]:warning
E["info"]:info
X["failed"]:error
```

Valid roles: `primary` · `success` · `error` · `warning` · `info` · `neutral`
(default). The role only needs to appear on the **first** declaration of the id.

## Edges

```
A --> B            directed edge, NEUTRAL gray line (the default)
A ==> B            directed edge, COLORED — takes the SOURCE node's role color
A -->|label| B     labeled edge ( ==> can carry a label too )
A ==>|yes| B
```

- `-->` is the calm default. Reach for `==>` to make a specific arrow stand out
  in the source node's color. Colored edges paint **on top of** neutral ones.
- An edge auto-declares both endpoints if they're new. You can put the full
  node ref on either side of the arrow:
  `A(["Request"]):primary --> B["work"]:warning`.

## Cycles and loops

Loops are allowed — e.g. a retry that points back to an earlier decision:

```
B{"Is it working?"} -->|No| D["Debug"]
D --> B
```

Trazo detects the **back-edge** (`D --> B`) and keeps `B` ranked under its real
parent instead of pushing it below `D`. Draw loops naturally; you don't need to
re-order anything to avoid a broken layout.

## Complete flow example

```
flow TD
A["Start"] --> B{"Is it working?"}
B -->|Yes| C["Great!"]
B -->|No| D["Debug"]
D --> B
C --> E["Deploy"]
E --> F["End"]
```

This produces: `Start → decision`, the decision fanning out to `Great!` and
`Debug`, `Debug` looping back to the decision, and the happy path continuing
`Great! → Deploy → End`.

### Example with shapes, roles, and colored edges

```
flow TD
A(["Request arrives"]):primary ==> B["getCart() started"]:warning
A ==> C["getFlags() started"]:warning
A --> D["Render shell immediately"]:info
B ==> E["Stream data as promises settle"]:success
C --> E
D --> E
```

---

# Git DSL (commit-history graphs)

Describe a git history as a sequence of operations on the *current* branch.

## Statements

```
commit [<hash>] [(<author>)] [: <message>]
                              add a commit on the current branch (parent = tip).
branch <name>                 create <name> off the current tip and check it out.
checkout <name>               switch the current branch.
merge <name> [: <message>]    merge <name> into the current branch (two parents).
```

- The history starts on a branch called **`main`** — you don't declare it.
- `commit` always lands on the **currently checked-out** branch, with the
  current tip as its parent.
- Every part of `commit` is optional and independent:
  - `<hash>` — a 6+ hex-digit token (`a1b2c3d`) used as the commit id **and** its
    short hash. If omitted, a **deterministic** pseudo-hash is derived from the
    line — never random, so server and client agree.
  - `(<author>)` — rendered as a dim secondary label.
  - `: <message>` — the commit subject; drives the badge width.
- `merge <name>` creates a commit with two parents (current tip + `<name>`'s
  tip) on the current branch.

## Complete git example

```
commit a1b2c3d (JOYCO) : Initial commit
commit b2c3d4e (JOYCO) : Base commit
branch elvira/checkout
commit (Elvira) : checkout: scaffold flow
commit (Elvira) : checkout: wire it up
checkout main
merge elvira/checkout : land it
```

This builds `main` with two base commits, branches `elvira/checkout`, adds two
commits there, returns to `main`, and merges the branch back in.

---

# Quick reference (cheat sheet)

| | Flow | Git |
| --- | --- | --- |
| Pick language | `flow TD` / `flowchart LR` | `commit …` (first op) |
| Add a thing | `A["label"]` | `commit : message` |
| Connect | `A --> B` (neutral) · `A ==> B` (colored) | implicit (parent = tip) |
| Label a link | `A -->\|yes\| B` | `commit : message` |
| Branch | — | `branch name` / `checkout name` |
| Join | fan-in: multiple `--> E` | `merge name : message` |
| Shapes | `[box]` `([stadium])` `{diamond}` `[(cylinder)]` | commits are squares |
| Color | `:primary :success :error :warning :info :neutral` | auto per lane/branch |

**Common mistakes to avoid**

- Don't mix the two languages in one source — pick flow *or* git.
- Quote labels that contain spaces or `-->`/`==>`/`{}`/`[]` characters.
- An edge label must be closed: `A -->|yes| B`, not `A -->|yes B`.
- A role must follow a node **declaration** and be one of the six valid roles.
- In git, you must `checkout` (or `branch`, which also checks out) before
  committing onto a different branch.
