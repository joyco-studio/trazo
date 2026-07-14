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
// `themed` is the shared color-chain primitive — one definition for the
// renderer and for resolveThemePaint's auto `--trazo-bg` wiring.
import { resolveThemePaint, themed } from "../theme.js";
import type { ResolvedThemePaint } from "../theme.js";
import type { CSSProperties, JSX } from "react";

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
  secondary: themed("secondary", "secondary", "#2a2a2a"),
  ghost: themed("ghost", "accent", "#1c1c1c"),
  muted: themed("muted", "muted", "#1c1c1c"),
  neutral: themed("neutral", "muted-foreground", "#a1a1a1"),
  success: themed("success", "chart-2", "#36b37e"),
  warning: themed("warning", "chart-4", "#e6a700"),
  error: themed("error", "destructive", "#e5484d"),
  info: themed("info", "chart-3", "#2dd4bf"),
  // Deprecated alias — resolves to the SAME slot as `info`, so theming
  // `--trazo-info` recolors legacy `:streamed` nodes too.
  streamed: themed("info", "chart-3", "#2dd4bf"),
};

/**
 * Readable text color paired to each ROLE_VARS fill, with its own
 * `--trazo-<role>-foreground` override slot. `neutral` sits on a muted-gray box,
 * so its text defaults to the page foreground; its hex fallback is dark
 * (`#0a0a0a`) to stay legible on the `#a1a1a1` neutral fill fallback.
 */
const ROLE_FG_VARS: Record<SemanticRole, string> = {
  primary: themed("primary-foreground", "primary-foreground", "#ffffff"),
  secondary: themed("secondary-foreground", "secondary-foreground", "#fafafa"),
  ghost: themed("ghost-foreground", "accent-foreground", "#fafafa"),
  muted: themed("muted-foreground", "muted-foreground", "#a1a1a1"),
  neutral: themed("neutral-foreground", "foreground", "#0a0a0a"),
  success: themed("success-foreground", "chart-2-foreground", "#0a0a0a"),
  warning: themed("warning-foreground", "chart-4-foreground", "#0a0a0a"),
  error: themed("error-foreground", "destructive-foreground", "#ffffff"),
  info: themed("info-foreground", "chart-3-foreground", "#0a0a0a"),
  streamed: themed("info-foreground", "chart-3-foreground", "#0a0a0a"),
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

/**
 * Neutral edge color (the default for flow edges) — a light, on-brand gray.
 * Its OWN `--trazo-edge` slot, deliberately NOT the `neutral` role slot: a
 * theme that paints neutral node boxes (e.g. JOYCO black) must not drag every
 * default edge along with them.
 */
const EDGE_ACCENT = themed("edge", "muted-foreground", "#a1a1a1");

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
// Box-like shapes take their stroke width from the theme's `border` knob
// (ResolvedThemePaint.borderWidth; default 2).
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
/** Canvas backdrop fill for themes with `background: "solid" | "texture"`. */
const CANVAS = themed("canvas", "background", "#0a0a0a");
/** Hatch line color for the `"texture"` background — a subtle border-ish line. */
const CANVAS_HATCH = themed("canvas-hatch", "border", "#1f1f1f");
/** Distance (px) between the 45° texture hatch lines. */
const HATCH_SPACING = 7;

/**
 * One `d` string of parallel 45° lines (top-left → bottom-right) covering a
 * `w × h` canvas. Pure function of the dimensions — deterministic and
 * id-free, unlike an SVG `<pattern>`.
 */
function hatchPath(w: number, h: number): string {
  const parts: string[] = [];
  // Sweep the line family x + y = c, clipping each line to the canvas rect.
  for (let c = HATCH_SPACING; c < w + h; c += HATCH_SPACING) {
    const x0 = Math.max(0, c - h);
    const y0 = Math.min(c, h);
    const x1 = Math.min(c, w);
    const y1 = Math.max(0, c - w);
    parts.push(`M ${x0} ${y0} L ${x1} ${y1}`);
  }
  return parts.join(" ");
}

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
 * Closed SVG path for a polygon with every vertex rounded by a quadratic
 * curve: each corner becomes line-up-to-`r`-short → `Q vertex exit-point`.
 * The radius is clamped to half of each adjacent edge so short edges never
 * overshoot. Used for theme-rounded diamonds. Pure string construction.
 */
function roundedPolygonPath(vertices: Array<{ x: number; y: number }>, r: number): string {
  const n = vertices.length;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i + n - 1) % n] as { x: number; y: number };
    const cur = vertices[i] as { x: number; y: number };
    const next = vertices[(i + 1) % n] as { x: number; y: number };
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const ri = Math.min(r, inLen / 2, outLen / 2);
    const inX = (cur.x - prev.x) / inLen;
    const inY = (cur.y - prev.y) / inLen;
    const outX = (next.x - cur.x) / outLen;
    const outY = (next.y - cur.y) / outLen;
    const sx = cur.x - inX * ri;
    const sy = cur.y - inY * ri;
    parts.push(`${i === 0 ? "M" : "L"} ${sx} ${sy}`);
    parts.push(`Q ${cur.x} ${cur.y} ${cur.x + outX * ri} ${cur.y + outY * ri}`);
  }
  parts.push("Z");
  return parts.join(" ");
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

/** Stable, DOM-id-safe marker id for an edge color token (e.g. "role-success"). */
function arrowMarkerId(colorToken: string): string {
  const safe = colorToken.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${ARROW_MARKER_PREFIX}-${safe}`;
}

/** Distinct color tokens among edges that carry an arrowhead, in first-seen order. */
/** Final on-curve point of an engine-emitted path, or null when unparseable. */
function pathEndpoint(d: string): [number, number] | null {
  const cmds = parsePathCommands(d);
  if (cmds === null) return null;
  const nums = (cmds[cmds.length - 1] as PathCmd).nums;
  return [nums[nums.length - 2] as number, nums[nums.length - 1] as number];
}

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

/** One parsed SVG path command from the engine's vocabulary (M/L/Q/C). */
interface PathCmd {
  op: "M" | "L" | "Q" | "C";
  nums: number[];
}

/** Expected number count per command — used to reject malformed paths. */
const CMD_ARITY: Record<PathCmd["op"], number> = { M: 2, L: 2, Q: 4, C: 6 };

/**
 * Parse an engine-emitted `d` string (absolute `M`/`L`/`Q`/`C` only — what
 * `pathThrough` produces in every edge style). Returns null on any other
 * command or a wrong number count, so callers can fall back untrimmed.
 */
function parsePathCommands(d: string): PathCmd[] | null {
  const re = /([A-Za-z])([^A-Za-z]*)/g;
  const out: PathCmd[] = [];
  for (const match of d.matchAll(re)) {
    const op = match[1] as string;
    if (op !== "M" && op !== "L" && op !== "Q" && op !== "C") return null;
    const nums = (match[2] as string)
      .trim()
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number);
    if (nums.length !== CMD_ARITY[op] || nums.some((n) => !Number.isFinite(n))) {
      return null;
    }
    out.push({ op, nums });
  }
  return out.length >= 2 ? out : null;
}

/**
 * Pull an arrow-bearing END of an edge path back by `inset` px so the stroke
 * STOPS where the arrowhead's base sits — the line never runs under the head's
 * narrowing tip (which would poke out past its sides). Works on straight AND
 * curved styles: a trimmed `L` end pulls toward the previous vertex, a `Q`/`C`
 * end pulls toward its trailing control point (the tangent direction at the
 * endpoint). `which` selects the end ("end", "both"); `insetStart` trims the
 * start. Falls back to the original `d` when the path is too short or not
 * engine-shaped. Pure.
 */
function insetPathEnds(
  d: string,
  which: "none" | "end" | "both",
  insetStart: boolean,
  inset: number,
): string {
  if (which === "none" && !insetStart) return d;
  const cmds = parsePathCommands(d);
  if (cmds === null) return d;

  const pullToward = (
    px: number,
    py: number,
    towardX: number,
    towardY: number,
  ): [number, number] => {
    const dx = towardX - px;
    const dy = towardY - py;
    const len = Math.hypot(dx, dy);
    if (len <= inset) return [px, py]; // segment too short — leave it
    const t = inset / len;
    return [px + dx * t, py + dy * t];
  };

  if (which === "end" || which === "both") {
    const last = cmds[cmds.length - 1] as PathCmd;
    const n = last.nums;
    const ex = n[n.length - 2] as number;
    const ey = n[n.length - 1] as number;
    // Direction reference: trailing control point for curves, previous
    // command's endpoint for lines.
    let refX: number;
    let refY: number;
    if (last.op === "L") {
      const prev = (cmds[cmds.length - 2] as PathCmd).nums;
      refX = prev[prev.length - 2] as number;
      refY = prev[prev.length - 1] as number;
    } else {
      refX = n[n.length - 4] as number;
      refY = n[n.length - 3] as number;
    }
    [n[n.length - 2], n[n.length - 1]] = pullToward(ex, ey, refX, refY);
  }

  if (insetStart) {
    const first = cmds[0] as PathCmd; // always M
    const next = cmds[1] as PathCmd;
    // Leading control point for curves, endpoint for lines.
    const refX = next.nums[0] as number;
    const refY = next.nums[1] as number;
    [first.nums[0], first.nums[1]] = pullToward(
      first.nums[0] as number,
      first.nums[1] as number,
      refX,
      refY,
    );
  }

  return cmds.map((c) => `${c.op} ${c.nums.join(" ")}`).join(" ");
}

/**
 * Render a `PositionedGraph` as an inline `<svg>`. Pure: same `graph` → same
 * markup, on server or client.
 */
export function Graph(props: GraphProps): JSX.Element {
  const { graph, className, classNames, title, theme } = props;
  const label = title ?? "Commit graph";
  // When an arrowless connector ends exactly where an ARROWED edge ends (a
  // shared entry anchor), its plain stroke would run through the other edge's
  // trimmed head gap and visually swallow the arrowhead. Promote such
  // connectors to carry the head too, so coincident lanes read as ONE edge.
  const arrowedEnds = new Set<string>();
  for (const e of graph.edges) {
    if (e.arrowHead === "end" || e.arrowHead === "both") {
      const p = pathEndpoint(e.path);
      if (p !== null) arrowedEnds.add(`${p[0]},${p[1]}`);
    }
  }
  const edges = graph.edges.map((e) => {
    if (e.kind !== "flow" || (e.arrowHead !== undefined && e.arrowHead !== "none")) {
      return e;
    }
    const p = pathEndpoint(e.path);
    if (p === null || !arrowedEnds.has(`${p[0]},${p[1]}`)) return e;
    return { ...e, arrowHead: "end" as const };
  });
  // Distinct edge colors needing an arrowhead marker — computed once.
  const markerTokens = arrowColorTokens(edges);
  // Single resolution point for the theme's paint half (pure — SSR-safe).
  const paint = resolveThemePaint(theme);
  const rootStyle =
    Object.keys(paint.vars).length > 0 ? (paint.vars as CSSProperties) : undefined;

  return (
    <svg
      data-slot="trazo-graph"
      className={className}
      style={rootStyle}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${graph.width} ${graph.height}`}
      width={graph.width}
      height={graph.height}
      role="img"
      aria-label={label}
    >
      <title>{label}</title>

      {paint.background !== "none" ? (
        <g data-slot="canvas" aria-hidden="true">
          <rect x={0} y={0} width={graph.width} height={graph.height} fill={CANVAS} />
          {paint.background === "texture" ? (
            // Deterministic 45° hatch drawn as ONE path — no <pattern>, so no
            // DOM id to collide when several graphs share a page.
            <path
              d={hatchPath(graph.width, graph.height)}
              fill="none"
              stroke={CANVAS_HATCH}
              strokeWidth={1}
            />
          ) : null}
        </g>
      ) : null}

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

      {graph.laneLabels && graph.laneLabels.length > 0 ? (
        <g data-slot="lane-labels">
          {graph.laneLabels.map((ll) => (
            <text
              key={ll.branch}
              data-slot="lane-label"
              data-lane={ll.lane}
              className={classNames?.laneLabel}
              x={ll.x}
              y={ll.y}
              // Vertical lanes: tag centered above its column. Horizontal lanes:
              // tag left-aligned in the reserved gutter, vertically centered.
              textAnchor={ll.align}
              dominantBaseline="central"
              fill={nodeColor(ll.color)}
              fontFamily={LABEL_FONT}
              fontSize={LABEL_SIZE}
              style={UPPERCASE}
            >
              {ll.branch}:
            </text>
          ))}
        </g>
      ) : null}

      {graph.commitBrackets && graph.commitBrackets.length > 0 ? (
        <g data-slot="commit-brackets">
          {graph.commitBrackets.map((b, i) => {
            // A square bracket ⊐ hugging the commit run: the long side runs along
            // the commit axis, short end-caps (tick) turn toward the commits.
            const horizontal = b.y1 === b.y2;
            const d = horizontal
              ? `M ${b.x1} ${b.y1 - b.tick} L ${b.x1} ${b.y1} L ${b.x2} ${b.y2} L ${b.x2} ${b.y2 - b.tick}`
              : `M ${b.x1 - b.tick} ${b.y1} L ${b.x1} ${b.y1} L ${b.x2} ${b.y2} L ${b.x2 - b.tick} ${b.y2}`;
            return (
              <g key={`bracket:${i}`} data-slot="commit-bracket">
                <path
                  data-slot="commit-bracket-line"
                  className={classNames?.commitBracket}
                  d={d}
                  fill="none"
                  stroke={GROUP_STROKE}
                  strokeWidth={1.5}
                />
                <text
                  data-slot="commit-bracket-label"
                  x={b.labelX}
                  y={b.labelY}
                  textAnchor={horizontal ? "middle" : "start"}
                  dominantBaseline="central"
                  fill={MUTED_FG}
                  fontFamily={LABEL_FONT}
                  fontSize={LABEL_SIZE}
                  style={UPPERCASE}
                >
                  {b.label}
                </text>
              </g>
            );
          })}
        </g>
      ) : null}

      {graph.gitNotes && graph.gitNotes.length > 0 ? (
        <g data-slot="git-notes">
          {graph.gitNotes.map((n, i) => (
            <text
              key={`note:${i}`}
              data-slot="git-note"
              className={classNames?.gitNote}
              x={n.x}
              y={n.y}
              dominantBaseline="central"
              fill={MUTED_FG}
              fontFamily={LABEL_FONT}
              fontSize={LABEL_SIZE}
              style={UPPERCASE}
            >
              {n.text}
            </text>
          ))}
        </g>
      ) : null}

      <g data-slot="edges" aria-hidden="true">
        {orderEdgesByPaint(edges).map((edge, i) => {
          const head = edge.arrowHead;
          const markerRef = head && head !== "none" ? `url(#${arrowMarkerId(edge.color)})` : undefined;
          // Pull the stroke back from any arrowed end by the head length so the
          // line ends under the head's base, not its tip — PLUS half the node
          // border, so the tip rests on the border's OUTER edge instead of
          // halfway into the chip-lift stroke band.
          const insetEnd = head === "end" || head === "both" ? head : "none";
          const insetStart = head === "both";
          const d =
            head && head !== "none"
              ? insetPathEnds(edge.path, insetEnd, insetStart, ARROW_LEN + paint.borderWidth / 2)
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
              strokeLinecap={paint.linecap ?? "butt"}
              strokeLinejoin="miter"
              strokeDasharray={edge.dashed ? EDGE_DASH : paint.dashArray}
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
            {renderNodeShape(node, classNames?.node, classNames?.nodeBox, paint)}
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
  paint: ResolvedThemePaint,
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
        rx={shape === "stadium" ? h / 2 : paint.cornerRadius}
        ry={shape === "stadium" ? h / 2 : paint.cornerRadius}
        fill={fill}
        stroke={BG}
        strokeWidth={paint.borderWidth}
      />
    );
  }

  if (shape === "diamond") {
    const cx = node.x;
    const cy = node.y;
    const vertices = [
      { x: cx, y: cy - h / 2 },
      { x: cx + w / 2, y: cy },
      { x: cx, y: cy + h / 2 },
      { x: cx - w / 2, y: cy },
    ];
    // The theme's roundness applies here too. A diamond vertex is far sharper
    // than a box's 90° corner, so the same radius reads weaker — scale it up
    // so it visually matches the boxes (the soft mock's squircle-ish diamond).
    if (paint.cornerRadius > 0) {
      return (
        <path
          data-slot="node"
          data-shape="diamond"
          className={boxClass}
          d={roundedPolygonPath(vertices, paint.cornerRadius * 2)}
          fill={fill}
          stroke={BG}
          strokeWidth={paint.borderWidth}
        />
      );
    }
    return (
      <polygon
        data-slot="node"
        data-shape="diamond"
        className={boxClass}
        points={vertices.map((p) => `${p.x},${p.y}`).join(" ")}
        fill={fill}
        stroke={BG}
        strokeWidth={paint.borderWidth}
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
      strokeWidth={paint.borderWidth}
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
