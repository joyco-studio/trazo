/**
 * SVG renderer for a `PositionedGraph` — the implementation behind the frozen
 * `Graph` signature re-exported from "./index.ts".
 *
 * Lives in a `.tsx` so JSX compiles; the public entry (`react/index.ts`) stays
 * a `.ts` per the frozen contract and simply re-exports `Graph` from here.
 *
 * Purity contract: no hooks, no effects, no event handlers, no browser globals.
 * Pure function of props → identical markup on server and client. Lane color
 * token keys ("lane-N") map to JOYCO theme CSS vars here; the engine never
 * emits literal colors.
 */

import type { GraphProps } from "./types.js";
import type { PositionedEdge, PositionedNode, SemanticRole } from "../types.js";
import {
  NODE_HALF,
  LABEL_GAP,
  LABEL_BADGE_PAD,
  BADGE_H,
  badgeWidth,
  labelLines,
  labelLineHeight,
  GROUP_PAD,
  GROUP_TITLE_H,
} from "../geometry.js";
import type { PositionedGroup } from "../types.js";
import type { JSX } from "react";

/**
 * Lane color palette: stock shadcn tokens only — `primary` leads, then
 * `chart-1…5`, cycled so adjacent lanes stay distinct (6 distinct app-defined
 * colors before reuse). Referencing the app's own tokens means trazo adopts its
 * brand out of the box (in the JOYCO kit `--primary` is the brand blue). Pure
 * string lookup → identical on server/client.
 *
 * Each entry is a LAYERED fallback: `var(--color-x, var(--x, #hex))`. In
 * Tailwind v4 the `--color-*` aliases live inside `@theme inline` and are
 * tree-shaken unless a utility references them, so a renderer that relied on
 * them alone went colorless. The fallback chain resolves to the raw token
 * (`--x`, which survives) and finally a hard-coded hex, so illustrations are
 * never colorless in ANY consuming app (playground, the hub, anywhere).
 */
/**
 * Build a layered color chain: `var(--trazo-<slot>, var(--color-<token>,
 * var(--<token>, <hex>)))`.
 *
 * The layers, outermost first:
 * 1. `--trazo-<slot>` — trazo's OWN semantic override knob. Unset by default,
 *    so it falls through. An app themes the graph by setting these (in CSS, on
 *    the root via `className`, or anywhere above the graph) — no inline style,
 *    no knowledge of which shadcn token a slot maps to.
 * 2. `--color-<token>` / `--<token>` — the stock shadcn token this slot adopts
 *    by default, so an unthemed graph matches the consuming app's brand. The
 *    `--color-*` alias (Tailwind v4 `@theme inline`) is tried first since it may
 *    be the only one exposed; `--<token>` is the raw token that always survives.
 * 3. `<hex>` — last-resort literal so illustrations are never colorless in an
 *    app with no shadcn tokens at all.
 *
 * Pure string construction → identical markup on server and client.
 */
function themed(slot: string, token: string, hex: string): string {
  return `var(--trazo-${slot}, var(--color-${token}, var(--${token}, ${hex})))`;
}

/**
 * Lane color palette (git): trazo's `--trazo-lane-1…6` semantic slots, each
 * defaulting to a stock shadcn token (`primary` leads, then `chart-1…5`). Six
 * distinct slots, cycled (`laneIndex` is mod 6) so adjacent lanes stay distinct
 * and the loop is clean. Override any lane by setting its `--trazo-lane-N`.
 */
const LANE_VARS = [
  themed("lane-1", "primary", "#002cea"),
  themed("lane-2", "chart-1", "#36b37e"),
  themed("lane-3", "chart-2", "#e6a700"),
  themed("lane-4", "chart-3", "#2dd4bf"),
  themed("lane-5", "chart-4", "#a78bfa"),
  themed("lane-6", "chart-5", "#f472b6"),
] as const;

/**
 * Readable text color paired to each LANE_VARS fill, index-aligned. Each entry
 * has its own `--trazo-lane-N-foreground` override slot; by default it adopts
 * the shadcn `*-foreground` token (so a fill whose lightness flips between
 * light/dark gets the right text in each), and the hex fallback is the WCAG pick
 * against this entry's own fallback fill — legible even in an app that defines
 * no foreground tokens at all.
 */
const LANE_FG_VARS = [
  themed("lane-1-foreground", "primary-foreground", "#ffffff"),
  themed("lane-2-foreground", "chart-1-foreground", "#0a0a0a"),
  themed("lane-3-foreground", "chart-2-foreground", "#0a0a0a"),
  themed("lane-4-foreground", "chart-3-foreground", "#0a0a0a"),
  themed("lane-5-foreground", "chart-4-foreground", "#0a0a0a"),
  themed("lane-6-foreground", "chart-5-foreground", "#0a0a0a"),
] as const;

function laneColor(tokenKey: string): string {
  return LANE_VARS[laneIndex(tokenKey)] as string;
}

function laneForeground(tokenKey: string): string {
  return LANE_FG_VARS[laneIndex(tokenKey)] as string;
}

function laneIndex(tokenKey: string): number {
  // tokenKey is "lane-<n>"; parse the index and cycle through the palette.
  const dash = tokenKey.lastIndexOf("-");
  const n = dash >= 0 ? Number.parseInt(tokenKey.slice(dash + 1), 10) : 0;
  const safe = Number.isFinite(n) ? n : 0;
  return ((safe % LANE_VARS.length) + LANE_VARS.length) % LANE_VARS.length;
}

/**
 * Semantic role palette for flow nodes/edges. Each role is a trazo
 * `--trazo-<role>` override slot defaulting to a stock shadcn token (primary,
 * chart-*, destructive, muted-foreground) so the renderer adopts a consuming
 * app's brand out of the box; the hex is only the last-resort fallback for an
 * app with no shadcn tokens at all.
 */
const ROLE_VARS: Record<SemanticRole, string> = {
  primary: themed("primary", "primary", "#002cea"),
  good: themed("good", "chart-2", "#36b37e"),
  bad: themed("bad", "destructive", "#e5484d"),
  pending: themed("pending", "chart-4", "#e6a700"),
  streamed: themed("streamed", "chart-3", "#2dd4bf"),
  neutral: themed("neutral", "muted-foreground", "#a1a1a1"),
};

/**
 * Readable text color paired to each ROLE_VARS fill, with its own
 * `--trazo-<role>-foreground` override slot. `neutral` sits on a muted-gray box,
 * so its text defaults to the page foreground; its hex fallback is dark
 * (`#0a0a0a`) to stay legible on the `#a1a1a1` neutral fill fallback.
 */
const ROLE_FG_VARS: Record<SemanticRole, string> = {
  primary: themed("primary-foreground", "primary-foreground", "#ffffff"),
  good: themed("good-foreground", "chart-2-foreground", "#0a0a0a"),
  bad: themed("bad-foreground", "destructive-foreground", "#ffffff"),
  pending: themed("pending-foreground", "chart-4-foreground", "#0a0a0a"),
  streamed: themed("streamed-foreground", "chart-3-foreground", "#0a0a0a"),
  neutral: themed("neutral-foreground", "foreground", "#0a0a0a"),
};

function roleColor(tokenKey: string): string {
  return ROLE_VARS[parseRole(tokenKey)] ?? ROLE_VARS.neutral;
}

function roleForeground(tokenKey: string): string {
  return ROLE_FG_VARS[parseRole(tokenKey)] ?? ROLE_FG_VARS.neutral;
}

function parseRole(tokenKey: string): SemanticRole {
  // tokenKey is "role-<role>"; parse the role.
  const dash = tokenKey.indexOf("-");
  return (dash >= 0 ? tokenKey.slice(dash + 1) : "neutral") as SemanticRole;
}

/** Neutral edge color (the default for flow edges) — a light, on-brand gray. */
const EDGE_ACCENT = themed("neutral", "muted-foreground", "#a1a1a1");

/**
 * Resolve any token color key. `"accent"` → the neutral edge gray; `role-*` →
 * the semantic palette (flow colored edges/nodes); everything else (git) → the
 * lane palette.
 */
function nodeColor(tokenKey: string): string {
  if (tokenKey === "accent") return EDGE_ACCENT;
  return tokenKey.startsWith("role-") ? roleColor(tokenKey) : laneColor(tokenKey);
}

/**
 * Readable label color for a node filled with `tokenKey`'s color. Mirrors
 * `nodeColor`: the paired `*-foreground` for lanes/roles, the page foreground
 * for the neutral accent fill.
 */
function nodeForeground(tokenKey: string): string {
  if (tokenKey === "accent") return FG;
  return tokenKey.startsWith("role-") ? roleForeground(tokenKey) : laneForeground(tokenKey);
}

/**
 * Page foreground (strokes, git labels) — text on the page background, not on a
 * colored box, so its `#ededed` fallback pairs with the dark page-bg fallback.
 * `--trazo-foreground` overrides it.
 */
const FG = themed("foreground", "foreground", "#ededed");
/** Label font stack, falling back to the raw token then a system sans. */
const LABEL_FONT =
  "var(--font-sans, var(--font-public-sans, ui-sans-serif, system-ui, sans-serif))";

/** Label font size (px) — matches the size `layout()` measured labels against. */
const LABEL_SIZE = 13;
/** Stroke width (px) for edges — JOYCO graphs use a slightly heavier line. */
const EDGE_WIDTH = 2.5;
/** Stroke width (px) for flowchart box-like shapes (box/stadium/diamond/cylinder). */
const BOX_STROKE = 2;
/** Labels render uppercase (JOYCO style). The layout measures uppercased text. */
const UPPERCASE = { textTransform: "uppercase" as const, letterSpacing: "0.02em" };
/**
 * The surface the graph is drawn on, used as node borders so chips read as
 * lifted off the lines passing behind them. The chip-lift only works when this
 * matches the ACTUAL backdrop — so a consuming app that renders the graph on a
 * non-`--background` surface (e.g. a `--card`/`--muted` panel) can point the
 * border at it via `--trazo-bg` without the engine knowing app token names.
 * Falls back to the theme background, then a raw token, then a hard-coded hex.
 */
const BG = themed("bg", "background", "#0a0a0a");
/** Accent surface for the sliced-corner git label badge (hub Badge accent variant). */
const ACCENT = themed("accent", "accent", "#2a2a2a");
/** Accent foreground — primary text on the accent badge. */
const ACCENT_FG = themed("accent-foreground", "accent-foreground", "#fafafa");
/** Dim foreground for secondary badge text (hash, author), on the accent badge. */
const MUTED_FG = themed("muted-foreground", "muted-foreground", "#a1a1a1");
/** Muted surface for sequence note boxes (a filled, low-contrast panel). */
const MUTED = themed("muted", "muted", "#1c1c1c");
/** Subgraph container stroke — a light, on-brand gray outline. */
const GROUP_STROKE = MUTED_FG;

/** Sliced-corner badge metrics (matches the hub Badge: TL + BR chamfer). */
const BADGE_CHAMFER = 6;
const BADGE_PAD_X = LABEL_BADGE_PAD;

/**
 * Arrowhead marker geometry — a small solid triangle in ABSOLUTE user units
 * (markerUnits="userSpaceOnUse") so it does NOT scale with the 2.5px stroke
 * (which made it huge). `ARROW_LEN` is tip-to-base depth, `ARROW_WID` the base
 * height. The edge stroke is trimmed back by ARROW_LEN so the line ends at the
 * base and the tip lands on the node face (no gap, no stroke poking through).
 */
const ARROW_LEN = 7;
const ARROW_WID = 6;
/** Dash pattern for dashed edges (async sequence messages). */
const EDGE_DASH = "6 4";

/**
 * SVG path for a sliced-corner badge rect (hub Badge geometry): top-left and
 * bottom-right corners cut at `c` px, top-right and bottom-left square. Origin
 * at (x,y), size w×h.
 */
function badgePath(x: number, y: number, w: number, h: number): string {
  const c = BADGE_CHAMFER;
  return [
    `M ${x + c} ${y}`,
    `L ${x + w} ${y}`,
    `L ${x + w} ${y + h - c}`,
    `L ${x + w - c} ${y + h}`,
    `L ${x} ${y + h}`,
    `L ${x} ${y + c}`,
    "Z",
  ].join(" ");
}

/**
 * Render a label as one or more centered `<tspan>` rows. A single-line label is
 * one tspan; a multi-line label (hard `\n` breaks) stacks rows at
 * `labelLineHeight`, with the whole block vertically centered on `y` (so it
 * works under `dominantBaseline="central"`): the first row is lifted by
 * `(n-1)/2` line-heights and each subsequent row drops by one. Pure.
 */
function renderMultilineText(text: string, x: number, y: number): JSX.Element {
  const lines = labelLines(text);
  const lh = labelLineHeight();
  const firstDy = -((lines.length - 1) / 2) * lh;
  return (
    <>
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? firstDy : lh}>
          {line}
        </tspan>
      ))}
    </>
  );
}

/**
 * Render a subgraph container / note box: an outlined (group) or filled (note)
 * rounded rect with an optional title in its reserved top strip. Drawn BEFORE
 * nodes and edges so they paint on top of the container. Pure.
 */
function renderGroup(
  group: PositionedGroup,
  groupClass: string | undefined,
  labelClass: string | undefined,
): JSX.Element {
  const isNote = group.variant === "note";
  // Subgraph titles sit in the reserved top strip; note boxes have no strip, so
  // their text centers in the whole box (height = textHeight + GROUP_PAD*2).
  const titleX = group.x + GROUP_PAD;
  const titleY = isNote ? group.y + group.h / 2 : group.y + GROUP_TITLE_H / 2;
  // A note is a flat filled panel (no border, no radius), with its text centered;
  // a subgraph container is an outlined rounded box with a top-left title.
  const textX = isNote ? group.x + group.w / 2 : titleX;
  return (
    <g key={group.id} data-slot={isNote ? "note" : "group"} className={groupClass}>
      <rect
        x={group.x}
        y={group.y}
        width={group.w}
        height={group.h}
        fill={isNote ? MUTED : "none"}
        stroke={isNote ? "none" : GROUP_STROKE}
        strokeWidth={isNote ? 0 : 1.5}
      />
      {group.label !== undefined ? (
        <text
          data-slot="group-label"
          className={labelClass}
          x={textX}
          y={titleY}
          textAnchor={isNote ? "middle" : "start"}
          dominantBaseline="central"
          fill={MUTED_FG}
          fontFamily={LABEL_FONT}
          fontSize={LABEL_SIZE}
          style={UPPERCASE}
        >
          {renderMultilineText(group.label, textX, titleY)}
        </text>
      ) : null}
    </g>
  );
}

/**
 * Order edges for painting so neutral (accent) edges draw first and colored
 * edges draw on top — where they overlap, the colored one wins visually. A
 * stable partition (input order preserved within each group) keeps the output
 * deterministic.
 */
function orderEdgesByPaint(edges: PositionedEdge[]): PositionedEdge[] {
  const accent = edges.filter((e) => e.color === "accent");
  const colored = edges.filter((e) => e.color !== "accent");
  return [...accent, ...colored];
}

/**
 * Arrowheads are SVG `<marker>`s, one per distinct edge color token used by a
 * directed edge. A marker can't inherit its host path's `stroke` across our
 * theme tokens (each token resolves to a different CSS var), so we mint a marker
 * per color with that color baked into its `fill`, and the path references it by
 * a deterministic id derived from the token key. Pure: same edges → same ids.
 */
const ARROW_MARKER_PREFIX = "trazo-arrow";

/** Stable, DOM-id-safe marker id for an edge color token (e.g. "role-good"). */
function arrowMarkerId(colorToken: string): string {
  const safe = colorToken.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${ARROW_MARKER_PREFIX}-${safe}`;
}

/** Distinct color tokens among edges that carry an arrowhead, in first-seen order. */
function arrowColorTokens(edges: PositionedEdge[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of edges) {
    if (e.arrowHead === undefined || e.arrowHead === "none") continue;
    if (seen.has(e.color)) continue;
    seen.add(e.color);
    out.push(e.color);
  }
  return out;
}

/** Parse an `M x y L x y …` polyline `d` string into points. Returns [] on miss. */
function parsePolyline(d: string): Array<{ x: number; y: number }> {
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return [];
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: Number(nums[i]), y: Number(nums[i + 1]) });
  }
  return pts;
}

/**
 * Pull an arrow-bearing END of a polyline back by `inset` px along its last
 * segment so the stroke STOPS where the arrowhead's base sits — the line never
 * runs under the head's narrowing tip (which would poke out past its sides).
 * `which` selects the end to trim ("end" trims the last point, "start" the
 * first, "both" trims both). Returns the rebuilt `d`; falls back to the original
 * when the path is too short to trim. Pure.
 */
function insetPathEnds(
  d: string,
  which: "none" | "end" | "both",
  insetStart: boolean,
  inset: number,
): string {
  if (which === "none" && !insetStart) return d;
  const pts = parsePolyline(d);
  if (pts.length < 2) return d;

  const pullToward = (p: { x: number; y: number }, toward: { x: number; y: number }) => {
    const dx = toward.x - p.x;
    const dy = toward.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len <= inset) return { ...p }; // segment too short — leave it
    const t = inset / len;
    return { x: p.x + dx * t, y: p.y + dy * t };
  };

  const trimEnd = which === "end" || which === "both";
  const trimStart = insetStart;
  if (trimEnd) {
    const last = pts.length - 1;
    pts[last] = pullToward(pts[last]!, pts[last - 1]!);
  }
  if (trimStart) {
    pts[0] = pullToward(pts[0]!, pts[1]!);
  }
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

/**
 * Render a `PositionedGraph` as an inline `<svg>`. Pure: same `graph` → same
 * markup, on server or client.
 */
export function Graph(props: GraphProps): JSX.Element {
  const { graph, className, classNames, title } = props;
  const label = title ?? "Commit graph";
  // Distinct edge colors needing an arrowhead marker — computed once.
  const markerTokens = arrowColorTokens(graph.edges);

  return (
    <svg
      data-slot="trazo-graph"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${graph.width} ${graph.height}`}
      width={graph.width}
      height={graph.height}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>

      {markerTokens.length > 0 ? (
        <defs>
          {markerTokens.map((token) => {
            const fill = nodeColor(token);
            // Solid triangle pointing along +x: base at x=0, tip at x=ARROW_LEN.
            // The edge stroke is trimmed back by ARROW_LEN (insetPathEnds), so
            // refX=0 anchors the base at the trimmed line end and the tip extends
            // forward to the node face — no gap, no stroke poking through.
            // markerUnits="userSpaceOnUse" keeps it an absolute size (not
            // ×strokeWidth). orient="auto-start-reverse" flips it for
            // marker-start so a bidirectional edge's heads point outward.
            const half = ARROW_WID / 2;
            return (
              <marker
                key={token}
                id={arrowMarkerId(token)}
                markerWidth={ARROW_LEN}
                markerHeight={ARROW_WID}
                refX={0}
                refY={half}
                orient="auto-start-reverse"
                markerUnits="userSpaceOnUse"
              >
                <path d={`M 0 0 L ${ARROW_LEN} ${half} L 0 ${ARROW_WID} Z`} fill={fill} />
              </marker>
            );
          })}
        </defs>
      ) : null}

      {graph.groups && graph.groups.length > 0 ? (
        <g data-slot="groups">
          {graph.groups.map((group) =>
            renderGroup(group, classNames?.group, classNames?.groupLabel),
          )}
        </g>
      ) : null}

      {graph.lifelines && graph.lifelines.length > 0 ? (
        <g data-slot="lifelines" aria-hidden="true">
          {graph.lifelines.map((ll) => (
            <line
              key={ll.id}
              data-slot="lifeline"
              className={classNames?.lifeline}
              x1={ll.x1}
              y1={ll.y1}
              x2={ll.x2}
              y2={ll.y2}
              stroke={EDGE_ACCENT}
              strokeWidth={1.5}
              strokeDasharray={EDGE_DASH}
            />
          ))}
        </g>
      ) : null}

      <g data-slot="edges" aria-hidden="true">
        {orderEdgesByPaint(graph.edges).map((edge, i) => {
          const head = edge.arrowHead;
          const markerRef = head && head !== "none" ? `url(#${arrowMarkerId(edge.color)})` : undefined;
          // Pull the stroke back from any arrowed end by the head length so the
          // line ends under the head's base, not its tip.
          const insetEnd = head === "end" || head === "both" ? head : "none";
          const insetStart = head === "both";
          const d =
            head && head !== "none"
              ? insetPathEnds(edge.path, insetEnd, insetStart, ARROW_LEN)
              : edge.path;
          return (
            <path
              // Index-suffixed: a sequence/multigraph can have multiple edges
              // between the same pair (request + retry), so from->to isn't unique.
              key={`${edge.from}->${edge.to}:${i}`}
              data-slot="edge"
              data-kind={edge.kind}
              className={classNames?.edge}
              d={d}
              fill="none"
              stroke={nodeColor(edge.color)}
              strokeWidth={EDGE_WIDTH}
              strokeLinecap="butt"
              strokeLinejoin="miter"
              strokeDasharray={edge.dashed ? EDGE_DASH : undefined}
              markerEnd={head === "end" || head === "both" ? markerRef : undefined}
              markerStart={head === "both" ? markerRef : undefined}
            />
          );
        })}
      </g>

      {graph.edges.some(
        (e) => e.label !== undefined && e.labelPoint !== undefined,
      ) ? (
        <g data-slot="edge-labels" aria-hidden="true">
          {graph.edges.map((edge, i) => {
            if (edge.label === undefined || edge.labelPoint === undefined) {
              return null;
            }
            // Edge labels render as the same sliced-corner badge as git commit
            // labels — a chip centered ON the edge's midpoint so it sits aligned
            // with the arrow line (the line passes through the chip's center).
            const badgeW = badgeWidth(edge.labelWidth ?? 0);
            const badgeX = edge.labelPoint.x - badgeW / 2;
            const badgeY = edge.labelPoint.y - BADGE_H / 2;
            return (
              <g
                key={`${edge.from}->${edge.to}:label:${i}`}
                data-slot="edge-label"
                className={classNames?.edgeLabel}
              >
                <path
                  data-slot="edge-label-badge"
                  d={badgePath(badgeX, badgeY, badgeW, BADGE_H)}
                  fill={ACCENT}
                  fillOpacity={0.85}
                />
                <text
                  x={edge.labelPoint.x}
                  y={edge.labelPoint.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={ACCENT_FG}
                  fontFamily={LABEL_FONT}
                  fontSize={LABEL_SIZE}
                  style={UPPERCASE}
                >
                  {edge.label}
                </text>
              </g>
            );
          })}
        </g>
      ) : null}

      <g data-slot="nodes">
        {graph.nodes.map((node) => (
          <g key={node.id} data-slot="node-group">
            {renderNodeShape(node, classNames?.node, classNames?.nodeBox)}
            {renderNodeLabel(node, classNames?.label)}
          </g>
        ))}
      </g>
    </svg>
  );
}

/**
 * Render a node's marker. A git node (no `shape`, or `shape === "dot"`) renders
 * the original `<circle>` UNCHANGED. Flow shapes render box-like primitives
 * centered on `node.x`/`node.y`, sized by `node.w`/`node.h`.
 */
function renderNodeShape(
  node: PositionedNode,
  nodeClass: string | undefined,
  boxClass: string | undefined,
): JSX.Element {
  const shape = node.shape;
  if (shape === undefined || shape === "dot") {
    // JOYCO commits are SQUARES, not dots — no radius, centered on x/y. The
    // border is the page background so the chip reads as lifted off the lane
    // line passing behind it.
    return (
      <rect
        data-slot="node"
        data-lane={node.lane}
        className={nodeClass}
        x={node.x - NODE_HALF}
        y={node.y - NODE_HALF}
        width={NODE_HALF * 2}
        height={NODE_HALF * 2}
        fill={nodeColor(node.color)}
        stroke={BG}
        strokeWidth={2}
      />
    );
  }

  const w = node.w ?? 0;
  const h = node.h ?? 0;
  const x = node.x - w / 2;
  const y = node.y - h / 2;
  const fill = nodeColor(node.color);

  if (shape === "box" || shape === "stadium") {
    return (
      <rect
        data-slot="node"
        data-shape={shape}
        className={boxClass}
        x={x}
        y={y}
        width={w}
        height={h}
        rx={shape === "stadium" ? h / 2 : 0}
        ry={shape === "stadium" ? h / 2 : 0}
        fill={fill}
        stroke={BG}
        strokeWidth={BOX_STROKE}
      />
    );
  }

  if (shape === "diamond") {
    const cx = node.x;
    const cy = node.y;
    const points = [
      `${cx},${cy - h / 2}`,
      `${cx + w / 2},${cy}`,
      `${cx},${cy + h / 2}`,
      `${cx - w / 2},${cy}`,
    ].join(" ");
    return (
      <polygon
        data-slot="node"
        data-shape="diamond"
        className={boxClass}
        points={points}
        fill={fill}
        stroke={BG}
        strokeWidth={BOX_STROKE}
      />
    );
  }

  // cylinder: a rounded body with elliptical top and bottom caps.
  const capRy = 6;
  const left = x;
  const right = x + w;
  const top = y + capRy;
  const bottom = y + h - capRy;
  const d = [
    `M ${left} ${top}`,
    `C ${left} ${top - capRy * 1.34}, ${right} ${top - capRy * 1.34}, ${right} ${top}`,
    `L ${right} ${bottom}`,
    `C ${right} ${bottom + capRy * 1.34}, ${left} ${bottom + capRy * 1.34}, ${left} ${bottom}`,
    `Z`,
  ].join(" ");
  return (
    <path
      data-slot="node"
      data-shape="cylinder"
      className={boxClass}
      d={d}
      fill={fill}
      stroke={BG}
      strokeWidth={BOX_STROKE}
    />
  );
}

/**
 * Render a node's label. Git nodes keep their right-of-dot `message` label
 * (UNCHANGED). Flow nodes render their `label` centered inside the shape.
 */
function renderNodeLabel(
  node: PositionedNode,
  labelClass: string | undefined,
): JSX.Element | null {
  const isFlow = node.shape !== undefined && node.shape !== "dot";
  if (isFlow) {
    if (node.label === undefined) return null;
    return (
      <text
        data-slot="label"
        className={labelClass}
        x={node.x}
        y={node.y}
        textAnchor="middle"
        dominantBaseline="central"
        fill={nodeForeground(node.color)}
        fontFamily={LABEL_FONT}
        fontSize={LABEL_SIZE}
        style={UPPERCASE}
      >
        {renderMultilineText(node.label, node.x, node.y)}
      </text>
    );
  }

  const hash = node.hash;
  const message = node.message;
  const author = node.author;
  if (!hash && !message && !author) return null;

  // Git label = a sliced-corner badge (hub Badge geometry) holding an optional
  // mono hash, the subject, and an optional trailing author. The badge width
  // comes from the measured labelWidth reserved by the layout, and its top-left
  // corner from the engine-computed `labelAnchor` (which encodes the chart
  // orientation + labelSide). When `labelAnchor` is absent (older engine
  // output) we fall back to the legacy right-of-square placement.
  const badgeW = badgeWidth(node.labelWidth ?? 0);
  const badgeX = node.labelAnchor?.x ?? node.x + NODE_HALF + LABEL_GAP;
  const badgeY = node.labelAnchor?.y ?? node.y - BADGE_H / 2;
  const textX = badgeX + BADGE_PAD_X;
  const textY = badgeY + BADGE_H / 2;

  return (
    <g data-slot="label" className={labelClass}>
      <path
        data-slot="label-badge"
        d={badgePath(badgeX, badgeY, badgeW, BADGE_H)}
        fill={ACCENT}
      />
      <text
        x={textX}
        y={textY}
        dominantBaseline="central"
        fontFamily={LABEL_FONT}
        fontSize={LABEL_SIZE}
        style={UPPERCASE}
      >
        {hash !== undefined ? (
          <tspan data-slot="label-hash" fill={MUTED_FG}>
            {hash}{" "}
          </tspan>
        ) : null}
        {message !== undefined ? <tspan fill={ACCENT_FG}>{message}</tspan> : null}
        {author !== undefined ? (
          <tspan data-slot="label-author" fill={MUTED_FG}>
            {"  "}
            {author}
          </tspan>
        ) : null}
      </text>
    </g>
  );
}
