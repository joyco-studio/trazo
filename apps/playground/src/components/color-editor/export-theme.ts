/**
 * Serialize the current diagram colors into a drop-in CSS theme. Trazo reads
 * `--trazo-*` custom properties off any ancestor of a `<Graph>`, so a consuming
 * app themes its diagrams by pasting this into a stylesheet (or wrapping the
 * graph in the exported class). Values are OKLCH, matching globals.css.
 */

import { COLOR_SLOTS } from './slots'

/** The selector the exported theme is scoped to. */
const THEME_CLASS = '.trazo-theme'

/**
 * Build the CSS for the current theme. `overrides` are the user's edits; every
 * other slot falls back to its default so the export is a COMPLETE theme — drop
 * it in and the diagram is fully colored, no reliance on the app's own tokens.
 */
export function exportThemeCss(overrides: Record<string, string>): string {
  const lines = COLOR_SLOTS.map((slot) => {
    const value = overrides[slot.slot] ?? slot.defaultColor
    return `  --trazo-${slot.slot}: ${value};`
  })

  return [
    '/* Trazo diagram theme — generated from the playground color editor.',
    ` * Apply by adding the "${THEME_CLASS.slice(1)}" class to any ancestor of a`,
    ' * <Graph>, or change the selector to :root to theme every diagram. */',
    `${THEME_CLASS} {`,
    ...lines,
    '}',
    '',
  ].join('\n')
}

/** Copy the exported theme CSS to the clipboard. */
export async function copyThemeCss(overrides: Record<string, string>): Promise<void> {
  await navigator.clipboard.writeText(exportThemeCss(overrides))
}

/** Trigger a download of the exported theme as `trazo-theme.css`. */
export function downloadThemeCss(overrides: Record<string, string>): void {
  const blob = new Blob([exportThemeCss(overrides)], { type: 'text/css' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'trazo-theme.css'
  a.click()
  URL.revokeObjectURL(url)
}
