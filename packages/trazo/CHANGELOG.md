# @joycostudio/trazo

## 0.12.0

### Minor Changes

- cfaee0e: Add a themeable Excalidraw importer for positioned rectangles, text, lines, and arrows.

## 0.11.1

### Patch Changes

- 65f67a8: Reserve room between same-rank siblings for notes in their shared gutter and keep back-edge detours outside that reserved space. Leave room between nested return lanes for attached notes, including the inward bow of Bézier routes. Move flow notes along their requested side when their box or leader would cover a rendered edge, including curved routes, and reconnect their leader with a straight offset attachment when possible. Bound the note search to nearby routes so larger flows remain responsive. Keep reverse-edge labels on their own routes. Place crowded edge badges beside their arrows with short leaders, including labels on bidirectional pairs and long edges whose badges cover another path. Keep paired badges clear of spanning dummy lanes and shape attachment markers according to theme roundness.

## 0.11.0

### Minor Changes

- fff8f36: Add `remarkTrazoRender`, a companion transform to `@joycostudio/trazo/remark`.

  `remarkTrazo` validates fenced trazo DSL; `remarkTrazoRender` (MDX-only) rewrites each fence into a configurable MDX JSX element — the ` ```mermaid ` → `<Mermaid>` pattern — so diagrams can be authored as fences and rendered by a consumer-owned component.

  - Rewrites `flow`/`git`/`seq`/`block` fences into `<ComponentName lang="…">{`<dsl body>`}</ComponentName>` (component name configurable, default `TrazoDiagram`); the DSL body is passed as a string child and `lang` carries the canonical kind.
  - Forwards fence info-string meta as props: `title="…"` → string prop, a bare flag (`ascii`) → `ascii={true}`.
  - Optional per-document auto-numbering via `numberAttr` (e.g. `index={1}`, `index={2}`, … in document order; non-trazo fences don't count).
  - Validates as it rewrites (shared `severity` semantics): a malformed fence fails the build with a source-accurate line and never emits an unrenderable element.
  - Framework-agnostic — no React or layout import; it only produces JSX mdast nodes. `TRAZO_FENCE_LANGS` entries now expose a `kind`, and a `TrazoDslKind` type is exported.

## 0.10.0

### Minor Changes

- b0c75e1: Diagram linting across TS/JSX and Markdown/MDX.

  - **ESLint plugin** (`@joycostudio/trazo/eslint`) now covers all four DSLs — added `valid-sequence-dsl` and `valid-block-dsl` alongside the existing flow/git rules.
  - **Binding-aware matching.** The ESLint rules no longer fire on bare `flow`/`git` identifier names; they resolve the tag/callee to an actual import from `@joycostudio/trazo`, so aliased imports (`flow as f`) and namespace imports (`t.flow\`…\``) are validated while unrelated same-named tags from other libraries are left alone. A `modules` rule option extends the recognised specifiers.
  - **New remark plugin** (`@joycostudio/trazo/remark`) validates fenced `flow`/`git`/`seq`/`block` code blocks in Markdown/MDX at build time, failing on a parse error with a source-accurate line (or `severity: "warn"` for editor-only diagnostics). Framework-agnostic and dependency-light.

## 0.9.1

### Patch Changes

- eed88ee: Flow cross-axis coordinate assignment now uses **Brandes–Köpf block alignment**
  in place of the previous bounded iterative PAVA refinement. Co-aligned runs — a
  node chain, a long-edge dummy chain, or a cluster spine — are grouped into
  vertical blocks and placed in a single deterministic pass, so they share one
  cross coordinate and their connecting edges draw as straight lines. This fixes a
  subtle drift where a chain of differently-sized nodes _inside a subgraph_ landed
  a few pixels off a common column (the group-aware averaging converged too slowly
  under the old two-sweep limit), producing visible 45° jogs on edges that should
  have been dead vertical. Ungrouped chains, fan-out centering, long-edge
  straightening, cluster-spine straightness, and subgraph box separation are all
  preserved; the change is layout-only and deterministic. See
  `docs/coordinate-assignment.md`.
- 1c526e0: Flow nodes inside a role-tinted subgraph now blend into the tint instead of
  showing a seam ring. A node's border is painted with the page background so the
  chip reads as lifted off the lines behind it, but against a subgraph's
  low-opacity role wash that page-background ring stood out as a mismatched seam.
  Member nodes now get a decorative border overlay that re-applies the same role
  wash over just the border band, so the ring resolves to `background + wash` —
  the exact tinted backdrop — and the seam disappears. Nodes outside a tinted
  subgraph, git nodes and roleless subgraphs are unchanged.

## 0.9.0

### Minor Changes

- 1a62d20: Flow subgraphs now accept an optional trailing `:role` on their header
  (`subgraph G ["Label"] :success`) that tints the container: the box fills with
  the role's color at a low opacity and the border matches that same color at
  full opacity. The container paints in two passes — the fill sits behind the
  lanes and nodes while the border and title sit on top of the lanes, so
  connector lanes entering a subgraph never cross over its outline or title. Only the semantic role keywords (`primary`, `success`, `error`,
  `warning`, `info`, `neutral`, …) are accepted — the engine still never emits a
  literal color, so the tint resolves through the existing `--trazo-<role>` token
  chain and follows the active theme. A subgraph with no `:role` keeps the default
  transparent box with a neutral gray outline, so existing diagrams are unchanged.

## 0.8.0

### Minor Changes

- 1044dc5: Remove the deprecated `streamed` semantic role. It was an alias resolving to the
  `info` slot; while still pre-1.0 we drop it outright rather than carry the alias.
  Use `:info` (and the `--trazo-info` token) instead. `streamed` is no longer part
  of the `SemanticRole` union or `SEMANTIC_ROLES`, and `:streamed` in a DSL is no
  longer recognized as a role.
- 9d191b0: Sequence message arrows now adopt their **source participant's role** color, the
  same way a flow `==>` edge tints to its source node's role. Messages from a
  participant left at the default (no `:role`) keep the neutral `accent` color, so
  existing diagrams are unchanged and a themed neutral (e.g. JOYCO's black) never
  renders the arrows invisible. Block cells already carried per-cell `role-*`
  colors; together this lets sequence and block diagrams pick up the active theme.

### Patch Changes

- 8ac3620: fix(trazo): sequence `note over` paints on top of lifelines and messages

  Sequence notes and flow subgraph containers are both modeled as groups and were
  emitted in a single early layer, so the dashed lifeline (and message strokes)
  painted on top of the opaque note panel. The groups layer now renders only
  subgraph containers (which must sit under nodes/edges), while sequence notes
  render in a later `data-slot="notes"` layer after the edges — so the note panel
  covers the lifeline and any message strokes running behind it.

- 0fffc74: fix(trazo): strip stray null byte from `layout-flow.ts` comment

  A single `NUL` (`\x00`) byte had crept into a comment in `layout-flow.ts`,
  where a space belonged — the comment reads `keyed "from to"`, matching how
  `edgeKey` joins its two node ids. The byte had no runtime effect (it lived
  inside a comment), but any file containing a null byte is treated as
  **binary** by `grep`/`ripgrep`, so the whole file silently dropped out of
  codebase-wide text searches. Replacing the `NUL` with the intended space
  restores the file to plain text with no behavior change.

## 0.7.1

### Patch Changes

- 3b6efd9: fix(trazo): inline `code` chips inherit the node's foreground by default

  Inline `` `code` `` runs in flow-node labels now default to **transparent
  chip background** and **inherit the parent label's per-node role foreground**,
  instead of a boxed chip in a fixed global color. The `--trazo-code` /
  `--trazo-code-foreground` overrides still work: set them (via the `code` /
  `code-foreground` theme tokens or raw CSS) to restore a boxed, distinctly
  colored chip.

  The fix lives entirely in the two `var()` chains — `--trazo-code` now falls
  back to `transparent`, and `--trazo-code-foreground` to `inherit`. Because a
  `var()` fallback is a raw token stream, `inherit` substitutes literally into
  `fill: inherit`, which picks up the surrounding `<text>`'s `nodeForeground`;
  and since `fill` is an inherited SVG property, even a browser that rejects the
  fallback lands on the same parent color. So a `` `getCart()` `` on a `:primary`
  node reads primary, and on a `:warning` node reads warning — legible against
  each node fill with no visible box.

  Overriding ONLY the chip background (`code`) to restore a boxed chip now
  derives a readable text color from the fill's lightness (like the other paired
  surface tokens), so a dark code box no longer risks inheriting a dark node
  foreground and reading dark-on-dark. A `transparent` / `var()` code fill isn't
  a literal color, so it derives nothing and keeps the per-node `inherit` default.

  Non-breaking: labels with no code runs are unchanged, and any consumer that
  explicitly set `--trazo-code` / `--trazo-code-foreground` keeps its boxed chip.

## 0.7.0

### Minor Changes

- 29b7887: fix(trazo): multi-line sequence labels, subgraph containment, sequence balance, edge-label quotes, reversed arrows

  A batch of layout + parser fixes surfaced by the JOYCO hub mermaid→trazo audit
  (logs 07/08/12/14). All additive and non-breaking. (Flow-edge multi-line labels
  already landed in #17; this extends the same badge machinery to sequence
  messages and adds the rest.)

  - **Multi-line sequence message labels.** A `<br/>`/`\n` in a sequence message
    label now sets `PositionedEdge.labelHeight` and lifts the label by its real
    (multi-line) badge height, so the renderer stacks the rows in a taller badge
    instead of clipping — the same treatment flow edge labels got in #17. The
    message band reserves the FULL extra badge height, so a tall label sits at the
    same top offset a single-line one would (never reaching up into the previous
    event or the header).
  - **Edge-label quotes stripped.** `A ===|"base of"| B` now yields the label
    `base of`, mirroring node labels (`A["x"]` → `x`). The quotes still let an
    inner `|` through, so `|"a | b"|` yields `a | b`; bare `|base of|` is unchanged.
  - **Parallel bidirectional pairs.** Two nodes on adjacent ranks with edges in
    BOTH directions, each the sole node on its rank (a 1↔1 sync, e.g. commit /
    scroll-deltas between two threads), now render as two parallel lines through
    the shared gap with both labels centered BETWEEN the boxes (Mermaid parity),
    instead of arcing the reverse edge out on a lateral corridor that stranded its
    label at the far edge. A back-edge into a fanned-out decision (its target rank
    has siblings) keeps the lateral loop arc. The inter-node gap reserves room for
    the WIDER of the pair's two labels (a labeled reverse edge widens the gap too),
    so neither badge is drawn clipped under the node boxes.
  - **Subgraph containment.** Two Sugiyama-cluster bugs are fixed: (1) an edge-less
    group member no longer strands at the rank-0 source column — it's pulled into
    its cluster's rank band, so two subgraphs lay out side by side instead of one
    box stretching across the other; (2) an ungrouped node that feeds a
    downward-closed cluster and shared its top rank is now lifted ABOVE the box
    (pointing down into it, Mermaid-style) instead of rendering inside it.
  - **Subgraph title never clipped.** A container box narrower than its own title
    widens to fit the title (`GROUP_PAD` gutter each side) and grows the viewBox.
  - **Sequence diagrams read balanced, not left-leaning.** Participant columns now
    spread so every straight-message label's centered badge fits within its OWN
    span — adjacent AND multi-column (an A→C label no longer crosses the outer
    lifelines or leaves the viewBox) — and reserve a self-message's loop+label
    reach so it clears the next column, instead of packing tight-left with every
    wide label overhanging.
  - **Reversed (`start`) arrowheads.** New `arrow: "start"` (`ArrowEnds`) and DSL
    tokens `<--` / `<==`: the edge still flows `from → to` for layout but the head
    points back at the source (`parent ← child`), for "based on" / child→parent
    relations that read right-to-left. Renderer emits `marker-start`.

### Patch Changes

- b7b3a26: fix(trazo): render multi-line flow edge labels (stack lines + reserve real badge height)

  Flow edge labels are measured as multi-line by the layout engine (`\n` / `<br>`,
  the same DSL feature node labels support) but the renderer drew them as a single
  SVG `<text>` at a fixed badge height — so a multi-line edge label ran all its
  lines together on one line, inside a badge sized only to the widest single line,
  and overflowed the chip.

  - **Renderer:** edge-label lines now stack into per-line `<tspan>` rows via the
    same helper node labels use, so both lines are readable.
  - **Geometry:** new `badgeHeight()` primitive (vertical analog of `badgeWidth`) —
    a one-line label yields exactly the old `BADGE_H`, and each extra line grows
    the chip by one line-height. `PositionedEdge` gains a `labelHeight` field.
  - **Layout:** the real badge height is now reserved everywhere the engine
    previously hardcoded `BADGE_H` for edge labels — the TD inter-rank gap and the
    canvas-bounds fold — so multi-line badges are contained in both `LR` and `TD`.
    Self-loop labels also switched to the plain (verbatim) measure, consistent with
    adjacent edges.
  - **Sibling alignment:** fan-out labels snap to the shallowest sibling's level; a
    tall multi-line badge dragged up to a short sibling's level could poke into the
    source node. The aligned level is now floored so the group's tallest badge
    always clears the source's forward face by `LABEL_GAP`.

  Single-line edge labels are unchanged.

## 0.6.0

### Minor Changes

- 1894113: feat(trazo): `note` callout/annotation primitive for flow diagrams

  Add a first-class annotation to the flow DSL and layout engine so you can hang a
  free-floating margin note (with a leader arrow) off any node **without** pulling
  it into the Sugiyama rank flow — previously the only workaround was a real node +
  edge, which forks the pipeline.

  - **DSL:** `note <targetId> <above|below|left|right> "<text>" [:role]`. The text
    obeys the same quoting / `<br/>` / inline `` `code` `` / `textCase` rules as a
    node label; an optional trailing `:role` tints the chip. Forward references to
    the target resolve at layout time; a note with an unknown target is dropped
    (same forgiving policy as an edge to an unknown node). `note` stays usable as an
    ordinary node id anywhere the full statement doesn't match.
  - **Types:** new `FlowNote` / `NoteSide`, `FlowGraph.notes`, a `kind: "note"`
    discriminator on `PositionedNode`, a `"note"` `EdgeKind`, and a `calloutGap`
    `FlowLayoutOptions` knob (default 24).
  - **Layout:** notes are excluded from ranking (they can never change which rank a
    real node lands in) and placed from resolved real-node centers as a post-pass,
    **centered on the target's cross-axis** so the leader is a straight
    perpendicular arrow (vertical for `above`/`below`, horizontal for
    `left`/`right`). The chip + leader fold into the same "labels grow the canvas"
    bounds pass, so a note is never clipped — one that would spill off-canvas shifts
    the whole graph (a pure translation that keeps it aligned). Multiple notes on a
    side stack outward. No collision routing: a note placed where a real node
    already sits (e.g. `below` a mid-pipeline node in `TD`) may overlap it — put it
    on a side with room.
  - **Renderer:** the note draws as a filled chip under `data-slot="annotation"`
    (styleable via `classNames.annotation`) and the leader as a neutral connector
    with an arrowhead at the target face.

  Additive and non-breaking: a flow graph with no `note` lines is completely
  unchanged.

## 0.5.0

### Minor Changes

- 5632d5b: feat(trazo): themeable label casing + inline `code` in flow-node labels

  - **`textCase` theme knob** (`"uppercase"` | `"none"`, default `"uppercase"`).
    Opt out of the JOYCO all-caps look to render labels exactly as authored. The
    casing flows into BOTH halves of the theme — the renderer's `text-transform`
    and the engine's measurement (`applyCase` replaces the hard-coded
    `.toUpperCase()`) — so boxes always size to what's drawn. Exposed as a knob in
    the playground theme editor; the `soft` preset now ships `textCase: "none"`.
  - **Inline `code` in flow-node labels.** A label may contain
    `` `backtick` ``-delimited runs, rendered in a monospace chip: a rounded
    `<rect>` (`data-slot="label-code-chip"`) behind a mono `<tspan>`
    (`data-slot="label-code"`). Code is case-sensitive (exempt from `textCase`) and
    measured as constant-advance monospace so boxes reserve room for the chip. New
    themeable slots `--trazo-code` / `--trazo-code-foreground` (default `muted` /
    `foreground`).

  Both are additive and non-breaking: unset `textCase` keeps uppercase, and a
  label without backticks renders exactly as before.

## 0.4.0

### Minor Changes

- e6d9870: feat(trazo): first-class theming — `TrazoTheme`, new edge styles, new semantic roles

  - New `TrazoTheme` object with a layout half (`themeFlowOptions` /
    `themeGitOptions`: padding density presets, lanes mode, lane gap) and a
    paint half (`<Graph theme={…}>`: `--trazo-*` token vars, lane style
    solid/dashed/dotted, roundness, chip-lift border width, canvas background
    solid/texture). Resolution happens at one point (`resolveThemePaint`).
    Roundness applies to box nodes AND diamonds (rounded at 2× the radius so the
    sharper vertices visually match the boxes); stadium keeps its pill caps.
  - `EdgeStyle` gains `"rounded"` (orthogonal with arced corners) and `"bezier"`
    (a uniform cubic B-spline à la d3 `curveBasis`: interior waypoints only guide
    the curve, so lanes read as ordinary relaxed arrow splines and can never
    overshoot the canvas). The theme names them lanes modes
    `angular | orthogonal | rounded | bezier`.
  - New `FlowLayoutOptions.edgeGap`: air (px) between an edge's endpoints (line
    end / arrow tip) and the node faces. The theme's `laneGap` knob (0–10) maps
    here for flow diagrams; in git charts it widens `laneWidth` instead.
  - New semantic roles `secondary`, `ghost`, `muted`, `info` (each with a
    `--trazo-*-foreground` pair). `streamed` stays accepted as a deprecated alias
    that resolves to the `info` slot. Role keywords are exported as
    `SEMANTIC_ROLES` and shared by the flow/block/sequence DSL parsers.
  - `joycoTheme` preset ships in the package (padding sm, roundness none, angular
    lanes, solid, textured canvas, large border) — colors intentionally unset so
    graphs adopt the consuming app's shadcn tokens.
  - Arrowhead end-trimming (`insetPathEnds`) is now path-command aware so curved
    edge styles trim correctly instead of being flattened to a polyline, and the
    tip now rests on the node border's OUTER edge (trim includes half the
    chip-lift stroke) instead of halfway into the border band.
  - **Mermaid-style centering**: after packing, alternating median-alignment
    sweeps (down/up) solved per layer with PAVA isotonic regression center every
    node over its neighbors — roots sit over their fan-out, chains and long
    edges run perfectly straight. Deterministic; replaces the lone-chain
    straightening special case.
  - **Turn placement**: edges now shift across NEAR THE SOURCE and make their
    final approach along the flow axis (`turnKnees` is main-axis aware), killing
    the last-second jog right before a node on long drops.
  - Fix: back-edges no longer route through their own dummy-chain waypoints
    (the "floating triangle" artifact on multi-rank cycles), and their lateral
    corridor now clears EVERY node in the ranks it passes — not just the two
    endpoints.
  - Automatic contrast foregrounds: `resolveThemePaint` derives a black/white
    `-foreground` for any pinned fill without an explicit pair, via perceptual
    (OKLab) lightness — `contrastForeground` / `perceptualLightness` are
    exported. Works with `oklch()` and hex literals; explicit foregrounds always
    win.
  - The default flow-edge gray moved off the `neutral` role slot onto its own
    `--trazo-edge` slot, so themes that paint neutral node boxes (e.g. black)
    no longer recolor every default edge with them. When a theme paints its own
    canvas, `--trazo-bg` (the chip-lift border) auto-follows `--trazo-canvas`
    unless explicitly set.

- e0b1c4a: feat(trazo): robustness — self-loops, label bounds, auto-wrap, git fixes

  - `layoutFlow` now routes self-loops (`A --> A`) as a wrap-around corridor
    beside the node (forward face → reserved cross-end corridor → cross-end
    face) instead of silently dropping them. Multiple loops on one node nest at
    `nodeGap` intervals, and the cross-axis packing reserves corridor space so a
    loop never collides with its rank sibling.
  - Edge label badges are now folded into `width`/`height`: a label wider than
    the graph grows the canvas (and shifts geometry when it would spill past the
    origin) instead of being clipped by the viewBox — restoring the documented
    contract that the canvas bounds ALL geometry including labels.
  - New `FlowLayoutOptions.maxNodeWidth`: word-wraps node labels (mermaid-style)
    so one long label no longer produces an extremely wide box. Pure,
    deterministic, glyph-table measured; hard `\n` breaks preserved; a single
    over-budget word stays whole. Off by default.
  - New `LayoutOptions.maxLabelWidth` (git): ellipsis-truncates the commit
    MESSAGE (hash and author are never cut) so the badge caps at a max width —
    what real git UIs do to long subjects. Off by default.
  - Fix (git DSL): auto-generated commit/merge ids (`c1…`, `m1…`) now skip ids
    the user already wrote. A user commit literally named `m2` used to silently
    fuse with the second merge's auto id, dropping a commit and scrambling the
    row order.

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
