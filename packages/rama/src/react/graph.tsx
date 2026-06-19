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
import type { PositionedNode, SemanticRole } from "../types.js";
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
 * never colorless in ANY consuming app (mirador, the hub, anywhere).
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

/**
 * Resolve any token color key. Flow keys are prefixed `role-` and map onto the
 * semantic palette; everything else (git) maps onto the lane palette.
 */
function nodeColor(tokenKey: string): string {
  return tokenKey.startsWith("role-") ? roleColor(tokenKey) : laneColor(tokenKey);
}

/** Foreground (strokes, labels), with the same layered fallback as the palette. */
const FG = "var(--color-foreground, var(--foreground, #ededed))";
/** Label font stack, falling back to the raw token then a system sans. */
const LABEL_FONT =
  "var(--font-sans, var(--font-public-sans, ui-sans-serif, system-ui, sans-serif))";

/** Label font size (px) — matches the size `layout()` measured labels against. */
const LABEL_SIZE = 13;
/** Node dot radius (px) used for the visual marker. */
const NODE_RADIUS = 5;
/** Gap (px) between a node dot and the start of its label. */
const LABEL_GAP = 10;

/**
 * Render a `PositionedGraph` as an inline `<svg>`. Pure: same `graph` → same
 * markup, on server or client.
 */
export function Graph(props: GraphProps): JSX.Element {
  const { graph, className, classNames, title } = props;
  const label = title ?? "Commit graph";

  return (
    <svg
      data-slot="rama-graph"
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
        {graph.edges.map((edge) => (
          <path
            key={`${edge.from}->${edge.to}`}
            data-slot="edge"
            data-kind={edge.kind}
            className={classNames?.edge}
            d={edge.path}
            fill="none"
            stroke={nodeColor(edge.color)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>

      {graph.edges.some(
        (e) => e.label !== undefined && e.labelPoint !== undefined,
      ) ? (
        <g data-slot="edge-labels" aria-hidden="true">
          {graph.edges.map((edge) =>
            edge.label !== undefined && edge.labelPoint !== undefined ? (
              <text
                key={`${edge.from}->${edge.to}:label`}
                data-slot="edge-label"
                className={classNames?.edgeLabel}
                x={edge.labelPoint.x}
                y={edge.labelPoint.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={FG}
                fontFamily={LABEL_FONT}
                fontSize={LABEL_SIZE}
              >
                {edge.label}
              </text>
            ) : null,
          )}
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
    return (
      <circle
        data-slot="node"
        data-lane={node.lane}
        className={nodeClass}
        cx={node.x}
        cy={node.y}
        r={NODE_RADIUS}
        fill={nodeColor(node.color)}
        stroke={FG}
        strokeWidth={1}
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
        rx={shape === "stadium" ? h / 2 : 4}
        ry={shape === "stadium" ? h / 2 : 4}
        fill={fill}
        stroke={FG}
        strokeWidth={1}
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
        stroke={FG}
        strokeWidth={1}
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
      stroke={FG}
      strokeWidth={1}
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
      >
        {node.label}
      </text>
    );
  }

  if (node.message === undefined) return null;
  return (
    <text
      data-slot="label"
      className={labelClass}
      x={node.x + NODE_RADIUS + LABEL_GAP}
      y={node.y}
      dominantBaseline="central"
      fill={FG}
      fontFamily={LABEL_FONT}
      fontSize={LABEL_SIZE}
    >
      {node.message}
    </text>
  );
}
