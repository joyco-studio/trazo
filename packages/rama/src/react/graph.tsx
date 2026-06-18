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
import type { JSX } from "react";

/**
 * Lane color palette: the five JOYCO chart tokens plus the three brand tokens,
 * cycled so adjacent lanes stay visually distinct. Pure string lookup →
 * identical on server/client.
 */
const LANE_VARS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-joyco-blue)",
  "var(--color-mustard-yellow)",
  "var(--color-mint-green)",
] as const;

function laneColor(tokenKey: string): string {
  // tokenKey is "lane-<n>"; parse the index and cycle through the palette.
  const dash = tokenKey.lastIndexOf("-");
  const n = dash >= 0 ? Number.parseInt(tokenKey.slice(dash + 1), 10) : 0;
  const safe = Number.isFinite(n) ? n : 0;
  const idx = ((safe % LANE_VARS.length) + LANE_VARS.length) % LANE_VARS.length;
  return LANE_VARS[idx] as string;
}

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
            stroke={laneColor(edge.color)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>

      <g data-slot="nodes">
        {graph.nodes.map((node) => (
          <g key={node.id} data-slot="node-group">
            <circle
              data-slot="node"
              data-lane={node.lane}
              className={classNames?.node}
              cx={node.x}
              cy={node.y}
              r={NODE_RADIUS}
              fill={laneColor(node.color)}
              stroke="var(--color-foreground)"
              strokeWidth={1}
            />
            {node.message !== undefined ? (
              <text
                data-slot="label"
                className={classNames?.label}
                x={node.x + NODE_RADIUS + LABEL_GAP}
                y={node.y}
                dominantBaseline="central"
                fill="var(--color-foreground)"
                fontFamily="var(--font-sans)"
                fontSize={LABEL_SIZE}
              >
                {node.message}
              </text>
            ) : null}
          </g>
        ))}
      </g>
    </svg>
  );
}
