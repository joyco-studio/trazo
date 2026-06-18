/**
 * gen-glyphs.ts — generates `src/fonts/public-sans.ts`, the bundled
 * glyph-advance table the runtime `measure()` reads.
 *
 * This script is a DEV tool only. It depends on `opentype.js` (a dev
 * dependency) and `fs`/`fetch` — none of which may appear in the shipped
 * runtime. The runtime imports the emitted table and does pure arithmetic.
 *
 * How to re-run:
 *   pnpm --filter rama gen:glyphs
 * (optionally set RAMA_FONT_URL to override the source TTF).
 *
 * The default instance of the Public Sans variable font is the Regular weight,
 * which is the JOYCO hub body font. We read each glyph's horizontal advance in
 * font design units (unitsPerEm) so `measure` can scale to any pixel size with
 * `size / unitsPerEm * Σ advance`.
 */

import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const FONT_URL =
  process.env.RAMA_FONT_URL ??
  "https://github.com/google/fonts/raw/main/ofl/publicsans/PublicSans%5Bwght%5D.ttf";

/**
 * The glyph set the hub uses for body text: printable ASCII plus the common
 * Latin-1 punctuation and accented letters that show up in real commit
 * messages (em dash, curly quotes, ellipsis, accented names, etc.).
 */
function glyphSet(): string[] {
  const chars: string[] = [];
  // Printable ASCII: U+0020 (space) through U+007E (~).
  for (let cp = 0x20; cp <= 0x7e; cp++) chars.push(String.fromCodePoint(cp));
  // Latin-1 supplement printable range: U+00A0 (nbsp) through U+00FF (ÿ).
  for (let cp = 0xa0; cp <= 0xff; cp++) chars.push(String.fromCodePoint(cp));
  // General-punctuation glyphs common in prose / commit subjects.
  const extra = [
    "‐", // hyphen
    "–", // en dash
    "—", // em dash
    "‘", // left single quote
    "’", // right single quote / apostrophe
    "“", // left double quote
    "”", // right double quote
    "…", // horizontal ellipsis
    "•", // bullet
    " ", // non-breaking space (also in Latin-1 above, dedup later)
    " ", // thin space
    " ", // narrow no-break space
  ];
  for (const c of extra) chars.push(c);
  // Dedup while preserving first-seen order for deterministic output.
  return Array.from(new Set(chars));
}

async function loadFontBuffer(): Promise<ArrayBuffer> {
  // Allow a local override (used in CI / offline) via a file path.
  if (process.env.RAMA_FONT_FILE && existsSync(process.env.RAMA_FONT_FILE)) {
    const buf = readFileSync(process.env.RAMA_FONT_FILE);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const res = await fetch(FONT_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch font: ${res.status} ${res.statusText}`);
  }
  return await res.arrayBuffer();
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = join(here, "..", "src", "fonts", "public-sans.ts");

  const buffer = await loadFontBuffer();

  // Persist to a temp file purely so opentype's loader can read a real path on
  // platforms where it prefers that; we parse from the buffer directly.
  const tmp = mkdtempSync(join(tmpdir(), "rama-font-"));
  writeFileSync(join(tmp, "font.ttf"), Buffer.from(buffer));

  const font = opentype.parse(buffer);
  const unitsPerEm = font.unitsPerEm;

  const chars = glyphSet();
  const advances: Record<string, number> = {};
  let sum = 0;
  let count = 0;

  for (const ch of chars) {
    const glyph = font.charToGlyph(ch);
    if (!glyph || glyph.advanceWidth == null) continue;
    const adv = Math.round(glyph.advanceWidth);
    advances[ch] = adv;
    // Average is over visible-ish glyphs (exclude the zero-width controls);
    // include space so the average is representative of real text.
    sum += adv;
    count++;
  }

  const averageAdvance = count > 0 ? Math.round(sum / count) : unitsPerEm;

  // Emit deterministically: sort keys by code point so re-runs are stable.
  const sortedKeys = Object.keys(advances).sort(
    (a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0),
  );

  const entries = sortedKeys
    .map((k) => {
      const cp = k.codePointAt(0) ?? 0;
      const hex = cp.toString(16).toUpperCase().padStart(4, "0");
      return `    "\\u${hex}": ${advances[k]},`;
    })
    .join("\n");

  const banner = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Glyph-advance table for the JOYCO body font (Public Sans, Regular weight),
 * produced by \`scripts/gen-glyphs.ts\` from the upstream Public Sans TTF.
 * Advances are in font design units; \`measure()\` scales them with
 * \`size / unitsPerEm\`. This module is PURE DATA — no fs, no fetch, no
 * opentype — so it ships safely to the browser and runs in Node.
 *
 * Regenerate with: pnpm --filter rama gen:glyphs
 *
 * Source: Public Sans (default/Regular instance) — ${FONT_URL}
 */`;

  const out = `${banner}

export interface GlyphTable {
  /** Font design units per em — the scale factor base for advances. */
  unitsPerEm: number;
  /** Glyph → horizontal advance in design units. */
  advances: Record<string, number>;
  /** Fallback advance (design units) for glyphs not in the table. */
  averageAdvance: number;
}

export const publicSans: GlyphTable = {
  unitsPerEm: ${unitsPerEm},
  averageAdvance: ${averageAdvance},
  advances: {
${entries}
  },
};
`;

  writeFileSync(outPath, out, "utf8");
  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${outPath}\n  unitsPerEm=${unitsPerEm} glyphs=${sortedKeys.length} averageAdvance=${averageAdvance}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
