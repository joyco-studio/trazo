/**
 * Playground theme presets.
 *
 * The lib's `joycoTheme` ships colorless (it adopts the consuming app's shadcn
 * tokens); the playground preset pins the explicit JOYCO palette from the
 * design mock so the default is the brand-exact "cara visible" — and the
 * exported theme JSON carries real color codes a consumer can paste anywhere.
 * `soft` is the deliberately opposite preset (beige, rounded, airy) that
 * proves the same knobs can produce both extremes.
 *
 * Values are OKLCH strings (matching the app's own shadcn tokens). Foregrounds
 * are mostly OMITTED on purpose: `resolveThemePaint` derives a black/white
 * foreground from each fill's perceptual lightness, so only design-driven
 * exceptions (dim/tinted text, or picks that disagree with the threshold) are
 * pinned explicitly here.
 */

import { joycoTheme, type TrazoTheme } from '@joycostudio/trazo'

export const JOYCO_PRESET: TrazoTheme = {
  ...joycoTheme,
  name: 'joyco',
  // Visible out of the box (the mock's "Papoi generative principles" / "01"
  // chips) — editable from the theme panel.
  frame: { label: 'Trazo playground', number: '01' },
  tokens: {
    canvas: 'oklch(0.2046 0 0)',
    'canvas-hatch': 'oklch(0.2478 0 0)',
    primary: 'oklch(0.4579 0.3092 264.14)',
    secondary: 'oklch(0.285 0 0)',
    // Ghost/muted read as dim text by design — the auto pick would be too hot.
    ghost: 'oklch(0.2393 0 0)',
    'ghost-foreground': 'oklch(0.8699 0 0)',
    muted: 'oklch(0.2686 0 0)',
    'muted-foreground': 'oklch(0.709 0 0)',
    neutral: 'oklch(0 0 0)',
    success: 'oklch(0.8923 0.2626 135.42)',
    warning: 'oklch(0.8809 0.1806 94.02)',
    // Error sits right at the contrast threshold (L≈0.67); the mock wants white.
    error: 'oklch(0.6677 0.2235 36.99)',
    'error-foreground': 'oklch(1 0 0)',
    info: 'oklch(0.7845 0.1325 181.91)',
    // Git lane palette — 6 distinct, legible hues on the dark canvas so a
    // multi-branch graph reads clearly (branch tags + lanes share these). Without
    // these the git graph fell back to the app's shadcn chart tokens and ignored
    // the theme. Foregrounds auto-derive by contrast.
    'lane-1': 'oklch(0.5679 0.2312 264.14)',
    'lane-2': 'oklch(0.8923 0.2626 135.42)',
    'lane-3': 'oklch(0.8809 0.1806 94.02)',
    'lane-4': 'oklch(0.7845 0.1325 181.91)',
    'lane-5': 'oklch(0.7 0.16 320)',
    'lane-6': 'oklch(0.6677 0.2235 36.99)',
    foreground: 'oklch(0.9461 0 0)',
    edge: 'oklch(0.5417 0 0)',
    accent: 'oklch(0.285 0 0)',
    'accent-foreground': 'oklch(0.8452 0 0)',
  },
}

export const SOFT_PRESET: TrazoTheme = {
  name: 'soft',
  frame: { label: 'Soft preset', number: '02' },
  padding: 'lg',
  roundness: 'lg',
  lanesMode: 'rounded',
  laneStyle: 'solid',
  laneGap: 4,
  background: 'solid',
  border: 'none',
  // Soft's foregrounds are TINTED (dark green on mint, brick on salmon…), so
  // every pair is explicit — the black/white auto pick is the wrong look here.
  tokens: {
    canvas: 'oklch(0.7522 0.028 87.88)',
    primary: 'oklch(0.5497 0.0655 70.71)',
    'primary-foreground': 'oklch(0.9513 0.0176 81.33)',
    secondary: 'oklch(0.862 0.0585 302.94)',
    'secondary-foreground': 'oklch(0.3581 0.0879 292.94)',
    ghost: 'oklch(0.7966 0.0276 87.87)',
    'ghost-foreground': 'oklch(0.3883 0.0241 87.56)',
    muted: 'oklch(0.7049 0.0288 85.67)',
    'muted-foreground': 'oklch(0.3883 0.0241 87.56)',
    neutral: 'oklch(0.6088 0.0267 85.79)',
    'neutral-foreground': 'oklch(0.9467 0.0168 88)',
    success: 'oklch(0.8791 0.0793 160.62)',
    'success-foreground': 'oklch(0.427 0.0786 160.2)',
    warning: 'oklch(0.9262 0.0761 95.33)',
    'warning-foreground': 'oklch(0.4715 0.086 94.22)',
    error: 'oklch(0.8288 0.0714 28.38)',
    'error-foreground': 'oklch(0.441 0.1287 29.81)',
    info: 'oklch(0.8721 0.0465 244.35)',
    'info-foreground': 'oklch(0.3986 0.0619 242.84)',
    // Soft git lanes — muted pastels tuned to the beige canvas (tinted
    // foregrounds are explicit below via the pairs). Shares the git graph's
    // palette so it matches the rest of the soft theme instead of shadcn charts.
    'lane-1': 'oklch(0.5497 0.0655 70.71)',
    'lane-1-foreground': 'oklch(0.9513 0.0176 81.33)',
    'lane-2': 'oklch(0.8791 0.0793 160.62)',
    'lane-2-foreground': 'oklch(0.427 0.0786 160.2)',
    'lane-3': 'oklch(0.9262 0.0761 95.33)',
    'lane-3-foreground': 'oklch(0.4715 0.086 94.22)',
    'lane-4': 'oklch(0.8721 0.0465 244.35)',
    'lane-4-foreground': 'oklch(0.3986 0.0619 242.84)',
    'lane-5': 'oklch(0.862 0.0585 302.94)',
    'lane-5-foreground': 'oklch(0.3581 0.0879 292.94)',
    'lane-6': 'oklch(0.8288 0.0714 28.38)',
    'lane-6-foreground': 'oklch(0.441 0.1287 29.81)',
    foreground: 'oklch(0.342 0.0212 88.08)',
    edge: 'oklch(0.6088 0.0267 85.79)',
    accent: 'oklch(0.7049 0.0288 85.67)',
    'accent-foreground': 'oklch(0.342 0.0212 88.08)',
  },
}

export const PRESETS: readonly TrazoTheme[] = [JOYCO_PRESET, SOFT_PRESET]

/** The playground default — JOYCO is the face of trazo. */
export const DEFAULT_THEME = JOYCO_PRESET

/** The `--trazo-*` CSS block for a theme, ready to paste into an app. */
export function themeToCss(theme: TrazoTheme): string {
  const lines = Object.entries(theme.tokens ?? {}).map(
    ([slot, value]) => `  --trazo-${slot}: ${value};`
  )
  return `.trazo-${theme.name ?? 'custom'} {\n${lines.join('\n')}\n}`
}
