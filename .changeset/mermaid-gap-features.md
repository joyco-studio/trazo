---
"@joycostudio/trazo": minor
---

Close the Mermaid-conversion gaps: subgraphs, multi-line labels, sequence and
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
