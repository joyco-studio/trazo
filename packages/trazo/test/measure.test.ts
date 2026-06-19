import { describe, it, expect } from "vitest";
import { measure } from "../src/index.js";
import type { FontSpec } from "../src/index.js";

const font = (size: number): FontSpec => ({ family: "PublicSans", size });

describe("measure()", () => {
  it("returns 0 for the empty string", () => {
    expect(measure("", font(13))).toBe(0);
  });

  it("a known string has a stable, font-derived width > 0", () => {
    const w = measure("commit subject", font(13));
    expect(w).toBeGreaterThan(0);
    // Stable across calls (pure function of the bundled table).
    expect(measure("commit subject", font(13))).toBe(w);
  });

  it("scales linearly with size", () => {
    const at13 = measure("Hello, world", font(13));
    const at26 = measure("Hello, world", font(26));
    expect(at26).toBeCloseTo(at13 * 2, 6);
  });

  it("wider glyphs measure wider (m > i, font-derived not invented)", () => {
    // Public Sans 'm' advance >> 'i' advance; confirms real table lookup.
    expect(measure("m", font(20))).toBeGreaterThan(measure("i", font(20)));
  });

  it("longer text is wider than a prefix of it", () => {
    expect(measure("abcdef", font(13))).toBeGreaterThan(
      measure("abc", font(13)),
    );
  });

  it("unknown glyphs fall back to the average advance (no throw, > 0)", () => {
    // A CJK glyph is not in the Latin body table → uses averageAdvance.
    const w = measure("漢", font(13));
    expect(w).toBeGreaterThan(0);
  });

  it("is deterministic in Node with no DOM present", () => {
    // Sanity: there is no `document`/`window` involved.
    expect(measure("determinism", font(15))).toBe(
      measure("determinism", font(15)),
    );
  });
});
