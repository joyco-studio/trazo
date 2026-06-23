# @joycostudio/trazo

## 0.3.0

### Minor Changes

- cd62478: Make diagram colors themeable through a `--trazo-*` CSS-variable layer, and
  reference only stock shadcn tokens by default so the renderer adopts a consuming
  app's brand out of the box.

  - **`--trazo-*` theming entry point.** Every color now resolves through a
    three-layer chain `var(--trazo-<slot>, var(--<shadcn-token>, <hex>))` built by
    a `themed()` helper. `--trazo-*` is unset by default (falls through to the
    shadcn token), so an app re-themes the graph by setting these vars — in CSS,
    on the root via `className="[--trazo-success:#16a34a]"`, or anywhere above the
    graph — with no inline style and no knowledge of which shadcn token a slot maps
    to. Slots: `--trazo-lane-1…6`, `--trazo-primary` / `success` / `error` /
    `warning` / `streamed` / `neutral`, a `-foreground` variant of each for label
    text, and
    `--trazo-bg` / `--trazo-accent` / `--trazo-muted` for surfaces.
  - **Stock shadcn defaults.** Each slot defaults to a stock shadcn token
    (`primary` + `chart-1…5`, `destructive`, `muted-foreground`) instead of
    JOYCO-specific brand tokens (`joyco-blue`, `mint-green`, `mustard-yellow`). In
    the JOYCO UI kit `--primary` is the brand blue, so JOYCO apps stay on-brand
    with zero config; vanilla shadcn apps render in their own palette. The layered
    fallback (incl. the Tailwind v4 `--color-*` alias and a final hex) is
    preserved, so output is never colorless in an app with no shadcn tokens.
  - **Contrast-correct labels.** Flow node labels use `nodeForeground()` — the
    fill's paired `*-foreground` slot with a WCAG-picked black/white hex fallback
    per fill — instead of the page `--foreground`. Fixes low-contrast labels where
    a dark box met a near-black page foreground in light themes.
  - **Lane cycle fix.** `LANE_VARS` is now 6 distinct slots and `laneIndex` cycles
    mod 6, removing the prior duplicate entries (old indices 6–7 reused the CSS
    chains of 0–1, clashing at those positions in any real shadcn app).
  - **`neutral` foreground fallback** corrected from `#ededed` to `#0a0a0a` (~7:1
    contrast on the `#a1a1a1` neutral fill, up from ~2:1).

  **Breaking — semantic roles renamed.** `good` → `success`, `bad` → `error`,
  `pending` → `warning` (`primary`, `streamed`, `neutral` unchanged). This changes
  the `SemanticRole` type, the DSL `:role` suffix (`:good` → `:success`, etc.
  across the `flow` / `seq` / `block` parsers), the emitted color-token keys
  (`role-good` → `role-success`), and the corresponding `--trazo-<role>` override
  slots (`--trazo-good` → `--trazo-success`). No back-compat aliases — old names no
  longer parse. Update any diagram sources and theme overrides accordingly.

  The `node.color` token-key _shape_ (`lane-N`, `role-X`, `accent`) is otherwise
  unchanged.

## 0.2.0

### Minor Changes

- 24ea72a: Close the Mermaid-conversion gaps: subgraphs, multi-line labels, sequence and
  block-grid diagrams, and undirected/bidirectional edges.

  - **Subgraphs / clustering.** `FlowNode.group` + `FlowGraph.groups` declare
    clusters; `layoutFlow` keeps a group's members spatially contiguous within each
    layer and emits a `PositionedGroup` container box (with a title) per group. The
    DSL gains `subgraph G ["Label"] … end` blocks (single-level; first group wins).
    Renders as a new `data-slot="group"` drawn behind the nodes.
  - **Multi-line node labels.** A literal `\n` or `<br>` in a label becomes a line
    break — the shape grows taller and sizes to its widest line; the renderer
    stacks the lines as `<tspan>` rows.
  - **Sequence diagrams.** New `SequenceGraph` input, `layoutSequence`,
    `parseSequence`, and a `seq` tagged template. Participants become lifeline
    columns (bracketed by a header band at the top AND bottom), messages become
    rows (`->>` sync, `-->>` async/dashed, self-loops), and `Note over A,B`
    renders a note box. Messages and notes share one timeline via an additive
    `seq?: number` (global event order) on `SequenceMessage`/`SequenceNote`, so a
    note interleaves in its row between messages. Message labels sit above their
    arrow; notes are flat filled panels. The result reuses `<Graph>` via new
    `lifelines` and note `PositionedGroup`s.
  - **Block-grid wireframes.** New `BlockGraph` input, `layoutBlock`, `parseBlock`,
    and a `block` tagged template for Mermaid `block-beta`-style column-span grids
    (`columns N`, cells with `:N` spans). No new renderer primitive — cells are
    box nodes.
  - **Undirected / bidirectional edges + arrowheads.** `FlowEdge.arrow`
    (`"none" | "end" | "both"`) and the DSL tokens `---` (undirected), `===`
    (undirected colored), `<-->` (bidirectional), and `<==>` (bidirectional
    colored). The renderer draws arrowheads via SVG `<marker>`s whose fill follows
    the edge's color token; `<-->`/`<==>` use `auto-start-reverse` so both heads
    point outward.

    **Behavior change:** flow edges are **directed by default** — `-->` / `==>`
    now render an arrowhead at the target (previously edges had no heads). Use
    `---` for a plain, headless connector.

  All additions are backward-compatible extensions to the frozen `types.ts`
  contract; existing flow/git output is unchanged apart from flow edges gaining the
  default arrowhead.

## 0.1.0

### Minor Changes

- caba2c4: Add DSL string authoring and an ESLint plugin.

  - Export the `parseGit` and `parseFlow` parsers so diagrams can be authored from
    DSL strings instead of hand-built graph objects.
  - Add `git` and `flow` tagged template literals that parse inline and throw on
    error, returning a graph ready for `layout` / `layoutGit` / `layoutFlow`.
  - `FlowGraph` gains an optional `direction` field that the parser populates from
    the source (`flow TD` / `flow LR`); `layoutFlow` falls back to it when
    `FlowLayoutOptions.direction` is not set, so the declared direction flows
    through automatically.
  - New `@joycostudio/trazo/eslint` subpath: an ESLint ≥ 9 flat-config plugin with
    `trazo/valid-git-dsl` and `trazo/valid-flow-dsl` rules (and a `recommended`
    config) that validate DSL strings at lint time, surfacing parse errors on the
    offending line in the editor.
