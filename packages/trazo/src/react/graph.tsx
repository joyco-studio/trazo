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
} from "../geometry.js";
import type { JSX } from "react";

/**
 * Lane color palette: joyco-blue leads as the primary, followed by vivid brand
 * + chart tokens for contrast, cycled so adjacent lanes stay distinct. Pure
 * string lookup → identical on server/client.
 *
 * Each entry is a LAYERED fallback: `var(--color-x, var(--x, #hex))`. In
 * Tailwind v4 the `--color-*` aliases live inside `@theme inline` and are
 * tree-shaken unless a utility references them, so a renderer that relied on
 * them alone went colorless. The fallback chain resolves to the raw token
 * (`--x`, which survives) and finally a hard-coded hex, so illustrations are
 * never colorless in ANY consuming app (playground, the hub, anywhere).
 */
const LANE_VARS = [
  "var(--color-joyco-blue, var(--joyco-blue, #002cea))",
  "var(--color-mint-green, var(--mint-green, #36b37e))",
  "var(--color-mustard-yellow, var(--mustard-yellow, #e6a700))",
  "var(--color-chart-3, var(--chart-3, #2dd4bf))",
  "var(--color-chart-4, var(--chart-4, #a78bfa))",
  "var(--color-chart-5, var(--chart-5, #f472b6))",
  "var(--color-chart-1, var(--chart-1, #1447e6))",
  "var(--color-chart-2, var(--chart-2, #00bba7))",
] as const;

function laneColor(tokenKey: string): string {
  // tokenKey is "lane-<n>"; parse the index and cycle through the palette.
  const dash = tokenKey.lastIndexOf("-");
  const n = dash >= 0 ? Number.parseInt(tokenKey.slice(dash + 1), 10) : 0;
  const safe = Number.isFinite(n) ? n : 0;
  const idx = ((safe % LANE_VARS.length) + LANE_VARS.length) % LANE_VARS.length;
  return LANE_VARS[idx] as string;
}

/**
 * Semantic role palette for flow nodes/edges. Same LAYERED fallback discipline
 * as `LANE_VARS`: `var(--color-x, var(--x, #hex))`. Two roles intentionally
 * point at shadcn-style tokens (destructive, muted-foreground) since those are
 * the conventional homes for "bad" and "neutral" in JOYCO consuming apps.
 */
const ROLE_VARS: Record<SemanticRole, string> = {
  primary: "var(--color-joyco-blue, var(--joyco-blue, #002cea))",
  good: "var(--color-mint-green, var(--mint-green, #36b37e))",
  bad: "var(--color-destructive, var(--destructive, #e5484d))",
  pending: "var(--color-mustard-yellow, var(--mustard-yellow, #e6a700))",
  streamed: "var(--color-chart-3, var(--chart-3, #2dd4bf))",
  neutral: "var(--color-muted-foreground, var(--muted-foreground, #a1a1a1))",
};

function roleColor(tokenKey: string): string {
  // tokenKey is "role-<role>"; parse the role and look it up.
  const dash = tokenKey.indexOf("-");
  const role = (dash >= 0 ? tokenKey.slice(dash + 1) : "neutral") as SemanticRole;
  return ROLE_VARS[role] ?? ROLE_VARS.neutral;
}

/** Neutral edge color (the default for flow edges) — a light, on-brand gray. */
const EDGE_ACCENT =
  "var(--color-muted-foreground, var(--muted-foreground, #a1a1a1))";

/**
 * Resolve any token color key. `"accent"` → the neutral edge gray; `role-*` →
 * the semantic palette (flow colored edges/nodes); everything else (git) → the
 * lane palette.
 */
function nodeColor(tokenKey: string): string {
  if (tokenKey === "accent") return EDGE_ACCENT;
  return tokenKey.startsWith("role-") ? roleColor(tokenKey) : laneColor(tokenKey);
}

/** Foreground (strokes, labels), with the same layered fallback as the palette. */
const FG = "var(--color-foreground, var(--foreground, #ededed))";
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
const BG =
  "var(--trazo-bg, var(--color-background, var(--background, #0a0a0a)))";
/** Accent surface for the sliced-corner git label badge (hub Badge accent variant). */
const ACCENT = "var(--color-accent, var(--accent, #2a2a2a))";
/** Accent foreground — primary text on the accent badge. */
const ACCENT_FG =
  "var(--color-accent-foreground, var(--accent-foreground, #fafafa))";
/** Dim foreground for secondary badge text (hash, author), on the accent badge. */
const MUTED_FG =
  "var(--color-muted-foreground, var(--muted-foreground, #a1a1a1))";

/** Sliced-corner badge metrics (matches the hub Badge: TL + BR chamfer). */
const BADGE_CHAMFER = 6;
const BADGE_PAD_X = LABEL_BADGE_PAD;

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
 * Render a `PositionedGraph` as an inline `<svg>`. Pure: same `graph` → same
 * markup, on server or client.
 */
export function Graph(props: GraphProps): JSX.Element {
  const { graph, className, classNames, title } = props;
  const label = title ?? "Commit graph";

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

      <g data-slot="edges" aria-hidden="true">
        {orderEdgesByPaint(graph.edges).map((edge) => (
          <path
            key={`${edge.from}->${edge.to}`}
            data-slot="edge"
            data-kind={edge.kind}
            className={classNames?.edge}
            d={edge.path}
            fill="none"
            stroke={nodeColor(edge.color)}
            strokeWidth={EDGE_WIDTH}
            strokeLinecap="butt"
            strokeLinejoin="miter"
          />
        ))}
      </g>

      {graph.edges.some(
        (e) => e.label !== undefined && e.labelPoint !== undefined,
      ) ? (
        <g data-slot="edge-labels" aria-hidden="true">
          {graph.edges.map((edge) => {
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
                key={`${edge.from}->${edge.to}:label`}
                data-slot="edge-label"
                className={classNames?.edgeLabel}
              >
                <path
                  data-slot="edge-label-badge"
                  d={badgePath(badgeX, badgeY, badgeW, BADGE_H)}
                  fill={ACCENT}
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
        fill={FG}
        fontFamily={LABEL_FONT}
        fontSize={LABEL_SIZE}
        style={UPPERCASE}
      >
        {node.label}
      </text>
    );
  }

  if (node.message === undefined) return null;

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
        {node.hash !== undefined ? (
          <tspan data-slot="label-hash" fill={MUTED_FG}>
            {node.hash}{" "}
          </tspan>
        ) : null}
        <tspan fill={ACCENT_FG}>{node.message}</tspan>
        {node.author !== undefined ? (
          <tspan data-slot="label-author" fill={MUTED_FG}>
            {"  "}
            {node.author}
          </tspan>
        ) : null}
      </text>
    </g>
  );
}
