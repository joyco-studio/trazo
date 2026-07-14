/**
 * OKLCH helpers for the color editor, wrapping culori. Diagram color overrides
 * are stored and applied as `oklch(L C H)` strings (matching globals.css), and
 * these functions parse/format them and produce a gamut-mapped sRGB hex for the
 * swatch preview.
 */

import { clampChroma, formatHex, type Oklch,oklch } from 'culori'

/** The three OKLCH axes the picker edits. */
export interface OklchValue {
  /** Lightness, 0–1. */
  l: number
  /** Chroma, 0–~0.4 (unbounded in theory; clamp the slider). */
  c: number
  /** Hue, 0–360 degrees. */
  h: number
}

/** Slider bounds — chroma/hue maxes chosen to cover the usable sRGB-ish range. */
export const OKLCH_MAX = { l: 1, c: 0.4, h: 360 } as const

/** Round to a sensible precision for display + CSS output (no float noise). */
function round(value: number, places: number): number {
  const f = 10 ** places
  return Math.round(value * f) / f
}

/** Parse any CSS color string into OKLCH axes; null if unparseable. */
export function parseOklch(input: string): OklchValue | null {
  const parsed = oklch(input)
  if (!parsed) return null
  return {
    l: round(parsed.l, 4),
    c: round(parsed.c, 4),
    // Hue is undefined for achromatic (c≈0) colors; treat as 0 so the slider works.
    h: round(parsed.h ?? 0, 2),
  }
}

/** Format OKLCH axes back into a canonical `oklch(L C H)` string. */
export function formatOklch({ l, c, h }: OklchValue): string {
  return `oklch(${round(l, 4)} ${round(c, 4)} ${round(h, 2)})`
}

/**
 * Gamut-mapped sRGB hex for the swatch preview. culori's `clampChroma` reduces
 * chroma until the color fits sRGB (preserving L and H), so out-of-gamut OKLCH
 * values still render a faithful-as-possible swatch instead of clipping.
 */
export function oklchToHex({ l, c, h }: OklchValue): string {
  const color: Oklch = { mode: 'oklch', l, c, h }
  return formatHex(clampChroma(color, 'oklch')) ?? '#000000'
}
