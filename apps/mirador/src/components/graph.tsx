/**
 * <Graph> — pure SVG renderer for a rama `PositionedGraph`.
 *
 * SWAP AT INTEGRATION
 * ───────────────────
 * This mirrors rama's `GraphProps` contract (packages/rama/src/react/types.ts).
 * At integration you may replace it with `import { Graph } from "rama/react"`;
 * the props are identical. It is kept local so the stub is self-contained.
 *
 * PURITY: no hooks, no effects, no browser globals, no event handlers. It is a
 * pure function of its `graph` prop, so it renders byte-identically as a Server
 * Component (zero client JS) and when hydrated on the client. That identical
 * output is what makes mirador's "SSR-first, hydrate-to-live" architecture work
 * without hydration mismatch.
 *
 * Styling follows the JOYCO data-slot convention: one `className` on the root
 * <svg>; inner elements expose `data-slot` so a parent can target them via
 * `**:data-[slot=name]:…`. Lane colors map to theme chart tokens via CSS vars.
 */

import type {
  PositionedEdge,
  PositionedGraph,
  PositionedNode,
} from "@/lib/rama-stub";
import { cn } from "@/lib/utils";

export interface GraphClassNames {
  edge?: string;
  node?: string;
  label?: string;
}

export interface GraphProps {
  graph: PositionedGraph;
  className?: string;
  classNames?: GraphClassNames;
  title?: string;
}

const NODE_RADIUS = 7;
const LABEL_GAP = 16;
const LANE_COLOR_COUNT = 5;

/**
 * Map a lane color token key ("lane-0", "lane-1", …) to a theme CSS variable.
 * Cycles through chart-1..5 so any number of lanes stays on-brand. Pure: a given
 * key always resolves to the same var, server and client.
 */
function laneColorVar(colorKey: string): string {
  const match = /^lane-(\d+)$/.exec(colorKey);
  const lane = match ? Number(match[1]) : 0;
  const slot = (lane % LANE_COLOR_COUNT) + 1;
  return `var(--color-chart-${slot})`;
}

export function Graph({ graph, className, classNames, title }: GraphProps) {
  const label =
    title ?? `Git graph with ${graph.nodes.length} commits across ${graph.laneCount} lanes`;

  return (
    <svg
      data-slot="rama-graph"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${graph.width} ${graph.height}`}
      width={graph.width}
      height={graph.height}
      xmlns="http://www.w3.org/2000/svg"
      className={cn("block h-auto max-w-full", className)}
    >
      <title>{label}</title>

      <g data-slot="rama-edges" fill="none" strokeWidth={2}>
        {graph.edges.map((edge) => (
          <EdgePath key={`${edge.from}->${edge.to}`} edge={edge} className={classNames?.edge} />
        ))}
      </g>

      <g data-slot="rama-nodes">
        {graph.nodes.map((node) => (
          <NodeDot
            key={node.id}
            node={node}
            nodeClassName={classNames?.node}
            labelClassName={classNames?.label}
          />
        ))}
      </g>
    </svg>
  );
}

function EdgePath({ edge, className }: { edge: PositionedEdge; className?: string }) {
  return (
    <path
      data-slot="rama-edge"
      data-kind={edge.kind}
      d={edge.path}
      stroke={laneColorVar(edge.color)}
      strokeLinecap="round"
      className={className}
    />
  );
}

function NodeDot({
  node,
  nodeClassName,
  labelClassName,
}: {
  node: PositionedNode;
  nodeClassName?: string;
  labelClassName?: string;
}) {
  const color = laneColorVar(node.color);
  return (
    <g data-slot="rama-node" data-lane={node.lane}>
      <circle
        data-slot="rama-node-dot"
        cx={node.x}
        cy={node.y}
        r={NODE_RADIUS}
        fill="var(--color-background)"
        stroke={color}
        strokeWidth={2.5}
        className={nodeClassName}
      />
      {node.message ? (
        <text
          data-slot="rama-label"
          x={node.x + NODE_RADIUS + LABEL_GAP}
          y={node.y}
          dominantBaseline="central"
          fontSize={13}
          fill="var(--color-foreground)"
          className={cn("font-sans", labelClassName)}
        >
          {node.branch ? (
            <tspan data-slot="rama-label-branch" fill={color} fontSize={11}>
              {node.branch}{" "}
            </tspan>
          ) : null}
          {node.message}
        </text>
      ) : null}
    </g>
  );
}
