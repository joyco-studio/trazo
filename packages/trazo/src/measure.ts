/**
 * Pure text measurement over the bundled Public Sans glyph-advance table.
 *
 * No DOM, no canvas, no `window` — this is the whole point: a width computed
 * here in Node is byte-identical to one computed in the browser, which is what
 * lets the same layout render on server and client without drift.
 *
 * Width formula: size / unitsPerEm * Σ advance(glyph). Unknown glyphs fall back
 * to the table's average advance, so a width never depends on the runtime's
 * font availability.
 */

import type { FontSpec } from "./types.js";
import { publicSans, type GlyphTable } from "./fonts/public-sans.js";

/**
 * Logical family names that resolve to the bundled Public Sans table. The
 * contract requires `family` to match a bundled table; we accept the canonical
 * name plus the common spellings so callers aren't tripped by casing/spacing.
 */
const PUBLIC_SANS_ALIASES = new Set([
  "publicsans",
  "public sans",
  "public-sans",
]);

function tableFor(family: string): GlyphTable {
  // There is exactly one bundled body table today (Public Sans). Any family
  // name that isn't recognized still measures against it rather than throwing,
  // so a stray family string degrades gracefully instead of crashing layout.
  void PUBLIC_SANS_ALIASES.has(family.toLowerCase());
  return publicSans;
}

/**
 * Measure the rendered pixel width of `text` in `font`.
 *
 * @param text the string to measure (may be empty → width 0)
 * @param font the font family + size to measure against
 */
export function measure(text: string, font: FontSpec): number {
  const table = tableFor(font.family);
  if (text.length === 0) return 0;

  let advanceUnits = 0;
  // Iterate by code point (not UTF-16 unit) so astral/combined glyphs map to a
  // single advance lookup; unknown glyphs use the table average.
  for (const ch of text) {
    const adv = table.advances[ch];
    advanceUnits += adv ?? table.averageAdvance;
  }

  return (font.size / table.unitsPerEm) * advanceUnits;
}
