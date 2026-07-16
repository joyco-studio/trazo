/**
 * TrazoTheme — the one theme object a consumer (or the playground) authors.
 *
 * A theme splits into two halves, because the engine is pure TS and never
 * reads CSS, while the renderer never does geometry:
 *
 *  - the LAYOUT half (padding density, lanes mode, lane gap) maps to
 *    `layout*()` options via {@link themeFlowOptions} / {@link themeGitOptions};
 *  - the PAINT half (color tokens, lane style, roundness, border, background)
 *    resolves to CSS variables + draw constants via {@link resolveThemePaint},
 *    consumed by `<Graph theme={…}>`.
 *
 * Both mappings live HERE, in one place, so a theme is resolved at a single
 * point instead of being patched incrementally across the renderer (see the
 * JOYCO log "Derive, Don't Mutate"). Everything is pure data in → data out:
 * SSR-safe, deterministic.
 */

import type { EdgeStyle, FlowLayoutOptions, LabelCase, LayoutOptions } from "./types.js";

/**
 * Build a layered color chain: `var(--trazo-<slot>, var(--color-<token>,
 * var(--<token>, <hex>)))` — trazo's own override knob, then the stock shadcn
 * token (Tailwind v4 `--color-*` alias first, raw token as the survivor), then
 * a last-resort hex. THE color-resolution primitive for the whole renderer;
 * see docs/rendering-and-brand.md for the full rationale.
 */
export function themed(slot: string, token: string, hex: string): string {
  return `var(--trazo-${slot}, var(--color-${token}, var(--${token}, ${hex})))`;
}

/** Color slots a theme can set — trazo's own stable vocabulary. */
export type TrazoColorSlot =
  | "primary"
  | "secondary"
  | "ghost"
  | "muted"
  | "neutral"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "lane-1"
  | "lane-2"
  | "lane-3"
  | "lane-4"
  | "lane-5"
  | "lane-6";

/** Surface/chrome slots (no `-foreground` pairing). */
export type TrazoSurfaceSlot =
  | "bg"
  | "canvas"
  | "canvas-hatch"
  | "edge"
  | "accent"
  | "accent-foreground"
  | "foreground"
  | "muted-foreground"
  | "code"
  | "code-foreground";

/** Every settable token: color slots, their foregrounds, and surfaces. */
export type TrazoTokenSlot =
  | TrazoColorSlot
  | `${TrazoColorSlot}-foreground`
  | TrazoSurfaceSlot;

/** Overall diagram density: scales padding and gaps together. */
export type ThemePadding = "sm" | "default" | "lg";
/** Corner radius applied to box nodes (stadium keeps its pill caps). */
export type ThemeRoundness = "none" | "sm" | "default" | "lg";
/**
 * How lanes (edges) travel. "angular" is the 45° JOYCO elbow (`elbow45`);
 * "orthogonal", "rounded" and "bezier" map 1:1 to {@link EdgeStyle}.
 */
export type ThemeLanesMode = "angular" | "orthogonal" | "rounded" | "bezier";
/** Lane stroke pattern. */
export type ThemeLaneStyle = "solid" | "dashed" | "dotted";
/** Chip-lift border width around nodes (color always matches `bg`). */
export type ThemeBorder = "none" | "default" | "large";
/** Canvas backdrop: nothing, a solid `canvas` fill, or fill + hatch texture. */
export type ThemeBackground = "none" | "solid" | "texture";
/**
 * Label casing. "uppercase" is the JOYCO default; "none" renders every label
 * exactly as authored. Inline `code` runs stay case-sensitive either way.
 */
export type ThemeTextCase = LabelCase;

export interface TrazoTheme {
  /** Display name (playground preset picker). */
  name?: string;
  /**
   * Color values applied as `--trazo-<slot>` CSS variables on the `<svg>`
   * root. Unset slots keep the shadcn-token fallback chain, so a theme only
   * has to pin what it wants to own.
   */
  tokens?: Partial<Record<TrazoTokenSlot, string>>;
  padding?: ThemePadding;
  roundness?: ThemeRoundness;
  lanesMode?: ThemeLanesMode;
  laneStyle?: ThemeLaneStyle;
  /**
   * 0–10 (px) — air between a lane and the boxes it connects. In flow diagrams
   * this is the gap between an edge's endpoints (line end / arrow tip) and the
   * node border (`FlowLayoutOptions.edgeGap`); 0 = flush, the JOYCO default.
   * In git charts, where edges ARE the lanes, it widens `laneWidth` instead.
   */
  laneGap?: number;
  background?: ThemeBackground;
  border?: ThemeBorder;
  /**
   * Label casing across the whole diagram. Default "uppercase" (the JOYCO look).
   * Both halves of the theme read it: the engine measures boxes against the
   * cased text ({@link themeFlowOptions}/{@link themeGitOptions}) and the
   * renderer applies the matching `text-transform` ({@link resolveThemePaint}).
   */
  textCase?: ThemeTextCase;
  /**
   * Reserved: the framed label + number chips ("Papoi generative principles" /
   * "01"). Currently rendered by the playground as HTML around the diagram;
   * declared on the theme so embedding it into the SVG later is not a breaking
   * change.
   */
  frame?: { label?: string; number?: string };
}

/** Density multipliers for the `padding` knob. */
const PADDING_SCALE: Record<ThemePadding, number> = {
  sm: 0.7,
  default: 1,
  lg: 1.6,
};

// ── Automatic contrast foregrounds ──────────────────────────────────────
// OKLCH makes this tractable: its L channel is PERCEPTUAL lightness, so "is
// black or white text readable on this fill?" collapses to a single threshold
// on L — no WCAG ratio gymnastics. Hex fills go through the standard
// sRGB → OKLab conversion to recover the same L. Pure math, no dependencies.

/** sRGB channel (0–1) → linear light. */
function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** OKLab lightness (0–1) of an sRGB triple (0–1 each). */
function oklabLightness(r: number, g: number, b: number): number {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/**
 * Perceptual (OKLab/OKLCH) lightness of a CSS color literal, or undefined for
 * anything we can't reason about statically (`var()`, named colors, gradients).
 * Accepts `oklch(L C H)` (L as number or percentage) and `#rgb`/`#rrggbb`.
 */
export function perceptualLightness(color: string): number | undefined {
  const trimmed = color.trim();
  const ok = /^oklch\(\s*([0-9.]+)(%?)/i.exec(trimmed);
  if (ok !== null) {
    const raw = Number.parseFloat(ok[1] as string);
    if (!Number.isFinite(raw)) return undefined;
    return ok[2] === "%" ? raw / 100 : raw;
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hex !== null) {
    let digits = hex[1] as string;
    if (digits.length === 3) {
      digits = digits
        .split("")
        .map((d) => d + d)
        .join("");
    }
    const r = Number.parseInt(digits.slice(0, 2), 16) / 255;
    const g = Number.parseInt(digits.slice(2, 4), 16) / 255;
    const b = Number.parseInt(digits.slice(4, 6), 16) / 255;
    return oklabLightness(r, g, b);
  }
  return undefined;
}

/**
 * Fills with L at/above this read as "light" → dark text. Below → light text.
 * OKLab L ≈ 0.65 is the perceptual flip point for black-vs-white legibility
 * (yellows/limes land well above, saturated blues/reds well below).
 */
const CONTRAST_L_THRESHOLD = 0.65;
/** Near-black / near-white picks — the shadcn foreground values, in OKLCH. */
const CONTRAST_DARK = "oklch(0.145 0 0)";
const CONTRAST_LIGHT = "oklch(0.985 0 0)";

/**
 * Black-or-white foreground for a given fill color, by perceptual lightness.
 * Undefined when the fill isn't a static literal we can measure.
 */
export function contrastForeground(fill: string): string | undefined {
  const lightness = perceptualLightness(fill);
  if (lightness === undefined) return undefined;
  return lightness >= CONTRAST_L_THRESHOLD ? CONTRAST_DARK : CONTRAST_LIGHT;
}

/**
 * Every slot whose label text reads a `<slot>-foreground` pair. `code` is
 * included so that overriding ONLY the chip background (to restore a boxed
 * chip) still derives a readable text color by the fill's lightness — without
 * it, `code-foreground` would fall through to `inherit` (the node's own
 * foreground), which can be unreadable on a code box of a clashing lightness.
 */
const FOREGROUND_PAIRED_SLOTS: readonly (TrazoColorSlot | "accent" | "code")[] = [
  "primary",
  "secondary",
  "ghost",
  "muted",
  "neutral",
  "success",
  "warning",
  "error",
  "info",
  "lane-1",
  "lane-2",
  "lane-3",
  "lane-4",
  "lane-5",
  "lane-6",
  "accent",
  "code",
];

/** Map the theme's lanes mode onto the engine's edge style. */
export function themeEdgeStyle(mode: ThemeLanesMode | undefined): EdgeStyle | undefined {
  if (mode === undefined) return undefined;
  return mode === "angular" ? "elbow45" : mode;
}

/** Engine defaults duplicated here for scaling (single knob → many options). */
const FLOW_BASE = { padding: 24, layerGap: 56, nodeGap: 28 } as const;
const GIT_BASE = { padding: 16, rowHeight: 40, laneWidth: 28 } as const;
/** px of extra lane width per `laneGap` step. */
const LANE_GAP_UNIT = 4;

/**
 * The flow-layout half of a theme. Explicit `base` options win over the theme
 * (a caller overriding `padding` knows better than the density preset).
 */
export function themeFlowOptions(
  theme: TrazoTheme | undefined,
  base?: FlowLayoutOptions,
): FlowLayoutOptions {
  if (theme === undefined) return { ...base };
  const scale = PADDING_SCALE[theme.padding ?? "default"];
  const out: FlowLayoutOptions = {
    padding: Math.round(FLOW_BASE.padding * scale),
    layerGap: Math.round(FLOW_BASE.layerGap * scale),
    nodeGap: Math.round(FLOW_BASE.nodeGap * scale),
    edgeGap: Math.max(0, Math.min(10, theme.laneGap ?? 0)),
    textCase: theme.textCase ?? "uppercase",
  };
  const edgeStyle = themeEdgeStyle(theme.lanesMode);
  if (edgeStyle !== undefined) out.edgeStyle = edgeStyle;
  return { ...out, ...base };
}

/** The git-layout half of a theme. Explicit `base` options win over the theme. */
export function themeGitOptions(
  theme: TrazoTheme | undefined,
  base?: LayoutOptions,
): LayoutOptions {
  if (theme === undefined) return { ...base };
  const scale = PADDING_SCALE[theme.padding ?? "default"];
  const out: LayoutOptions = {
    padding: Math.round(GIT_BASE.padding * scale),
    rowHeight: Math.round(GIT_BASE.rowHeight * scale),
    laneWidth:
      Math.round(GIT_BASE.laneWidth * scale) +
      Math.max(0, Math.min(10, theme.laneGap ?? 0)) * LANE_GAP_UNIT,
    textCase: theme.textCase ?? "uppercase",
  };
  const edgeStyle = themeEdgeStyle(theme.lanesMode);
  if (edgeStyle !== undefined) out.edgeStyle = edgeStyle;
  return { ...out, ...base };
}

/** Resolved paint constants the `<Graph>` renderer draws with. */
export interface ResolvedThemePaint {
  /** `--trazo-*` CSS variables for the `<svg>` root's `style`. */
  vars: Record<string, string>;
  /** `stroke-dasharray` for lane strokes; undefined = solid. */
  dashArray: string | undefined;
  /** Round linecap turns the dotted dash pattern into true dots. */
  linecap: "round" | undefined;
  /** Corner radius (px) for box nodes. */
  cornerRadius: number;
  /** Chip-lift stroke width (px) for box-like nodes. */
  borderWidth: number;
  background: ThemeBackground;
  /** Whether labels render uppercase (`text-transform`). Mirrors `textCase`. */
  uppercase: boolean;
}

const ROUNDNESS_PX: Record<ThemeRoundness, number> = {
  none: 0,
  sm: 2,
  default: 4,
  lg: 10,
};

const BORDER_PX: Record<ThemeBorder, number> = {
  none: 0,
  default: 2,
  large: 4,
};

/** Renderer defaults when no theme (or a partial theme) is given. */
const PAINT_DEFAULTS: ResolvedThemePaint = {
  vars: {},
  dashArray: undefined,
  linecap: undefined,
  cornerRadius: 0,
  borderWidth: 2,
  background: "none",
  uppercase: true,
};

/**
 * Resolve a theme's paint half — THE single point where theme knobs become
 * draw constants. Pure function of the theme object (SSR-safe).
 */
export function resolveThemePaint(theme: TrazoTheme | undefined): ResolvedThemePaint {
  if (theme === undefined) return PAINT_DEFAULTS;
  const vars: Record<string, string> = {};
  if (theme.tokens !== undefined) {
    for (const [slot, value] of Object.entries(theme.tokens)) {
      if (value !== undefined) vars[`--trazo-${slot}`] = value;
    }
    // A theme that pins a fill but not its foreground gets a readable label
    // automatically (black/white by the fill's perceptual lightness) — without
    // this, the fg falls through to the shadcn default paired with the STOCK
    // fill, which may clash with the custom one. Explicit foregrounds always
    // win; non-literal fills (var()) derive nothing.
    for (const slot of FOREGROUND_PAIRED_SLOTS) {
      const fill = theme.tokens[slot];
      if (fill === undefined || theme.tokens[`${slot}-foreground`] !== undefined) {
        continue;
      }
      const fg = contrastForeground(fill);
      if (fg !== undefined) vars[`--trazo-${slot}-foreground`] = fg;
    }
  }
  // When the theme paints its own canvas, the node chip-lift border must match
  // THAT backdrop (not the page background) or the seam shows as a ring —
  // unless the caller already pinned `bg` explicitly.
  if ((theme.background ?? "none") !== "none" && vars["--trazo-bg"] === undefined) {
    vars["--trazo-bg"] = vars["--trazo-canvas"] ?? themed("canvas", "background", "#0a0a0a");
  }
  const laneStyle = theme.laneStyle ?? "solid";
  return {
    vars,
    dashArray:
      laneStyle === "dashed" ? "10 7" : laneStyle === "dotted" ? "0 7" : undefined,
    linecap: laneStyle === "dotted" ? "round" : undefined,
    cornerRadius: ROUNDNESS_PX[theme.roundness ?? "none"],
    borderWidth: BORDER_PX[theme.border ?? "default"],
    background: theme.background ?? "none",
    uppercase: (theme.textCase ?? "uppercase") === "uppercase",
  };
}

/**
 * The JOYCO house theme — the playground default and the face of trazo.
 * Knobs only: colors intentionally stay unset so the graph adopts the
 * consuming app's shadcn tokens (in JOYCO apps `--primary` IS the brand blue).
 */
export const joycoTheme: TrazoTheme = {
  name: "joyco",
  padding: "sm",
  roundness: "none",
  lanesMode: "angular",
  laneStyle: "solid",
  laneGap: 0,
  background: "texture",
  border: "large",
};
