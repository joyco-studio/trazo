---
"@joycostudio/trazo": minor
---

feat(trazo): first-class theming — `TrazoTheme`, new edge styles, new semantic roles

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
