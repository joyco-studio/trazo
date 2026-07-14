import { describe, it, expect } from "vitest";
import { layoutFlow, resolveThemePaint, themeFlowOptions, themeGitOptions } from "../src/index.js";
import type { FlowGraph } from "../src/index.js";
import { parseInlineRuns, measureRun, measureRuns } from "../src/geometry.js";

describe("parseInlineRuns()", () => {
  it("returns a single prose run for plain text", () => {
    expect(parseInlineRuns("hello world")).toEqual([{ text: "hello world", code: false }]);
  });

  it("splits prose and inline `code` runs, consuming the backticks", () => {
    expect(parseInlineRuns("call `useState` now")).toEqual([
      { text: "call ", code: false },
      { text: "useState", code: true },
      { text: " now", code: false },
    ]);
  });

  it("handles code at the start and end of a line", () => {
    expect(parseInlineRuns("`a` and `b`")).toEqual([
      { text: "a", code: true },
      { text: " and ", code: false },
      { text: "b", code: true },
    ]);
  });

  it("treats an unclosed backtick as literal prose", () => {
    expect(parseInlineRuns("a ` b c")).toEqual([{ text: "a ` b c", code: false }]);
  });

  it("drops empty code spans (``)", () => {
    expect(parseInlineRuns("a``b")).toEqual([
      { text: "a", code: false },
      { text: "b", code: false },
    ]);
  });
});

describe("measureRun() / measureRuns()", () => {
  it("measures a code run as constant-advance monospace (independent of casing)", () => {
    const upper = measureRun({ text: "abc", code: true }, "uppercase");
    const none = measureRun({ text: "abc", code: true }, "none");
    expect(upper).toBe(none);
    expect(upper).toBeGreaterThan(0);
  });

  it("uppercase widens a lowercase prose run (caps are wider than lowercase)", () => {
    const upper = measureRun({ text: "mmmm", code: false }, "uppercase");
    const none = measureRun({ text: "mmmm", code: false }, "none");
    expect(upper).toBeGreaterThan(none);
  });

  it("a line's width is the sum of its runs", () => {
    const line = "run `x` end";
    const runs = parseInlineRuns(line);
    const sum = runs.reduce((acc, r) => acc + measureRun(r, "uppercase"), 0);
    expect(measureRuns(line, "uppercase")).toBeCloseTo(sum, 6);
  });
});

describe("theme textCase → layout + paint", () => {
  it("themeFlowOptions/themeGitOptions default to uppercase and carry the knob", () => {
    expect(themeFlowOptions({}).textCase).toBe("uppercase");
    expect(themeGitOptions({}).textCase).toBe("uppercase");
    expect(themeFlowOptions({ textCase: "none" }).textCase).toBe("none");
    expect(themeGitOptions({ textCase: "none" }).textCase).toBe("none");
  });

  it("resolveThemePaint mirrors textCase onto the uppercase paint flag", () => {
    expect(resolveThemePaint(undefined).uppercase).toBe(true);
    expect(resolveThemePaint({}).uppercase).toBe(true);
    expect(resolveThemePaint({ textCase: "none" }).uppercase).toBe(false);
    expect(resolveThemePaint({ textCase: "uppercase" }).uppercase).toBe(true);
  });
});

describe("layoutFlow() label casing + inline code sizing", () => {
  const nodeWidth = (g: FlowGraph, opts?: Parameters<typeof layoutFlow>[1]) =>
    layoutFlow(g, opts).nodes[0]?.w ?? 0;

  it("a lowercase label sizes narrower under textCase 'none' than 'uppercase'", () => {
    const g: FlowGraph = {
      kind: "flow",
      nodes: [{ id: "n", label: "mmmmmmmm", shape: "box", role: "neutral" }],
      edges: [],
    };
    expect(nodeWidth(g, { textCase: "none" })).toBeLessThan(nodeWidth(g, { textCase: "uppercase" }));
  });

  it("emits the label verbatim (backticks preserved for the renderer to parse)", () => {
    const g: FlowGraph = {
      kind: "flow",
      nodes: [{ id: "n", label: "call `fn`", shape: "box", role: "neutral" }],
      edges: [],
    };
    expect(layoutFlow(g).nodes[0]?.label).toBe("call `fn`");
  });

  it("reserves box width for an inline-code chip beyond the raw backtick text", () => {
    const coded: FlowGraph = {
      kind: "flow",
      nodes: [{ id: "n", label: "`configureLongName`", shape: "box", role: "neutral" }],
      edges: [],
    };
    // The whole label is a code chip; its measured width must exceed the tiny
    // minimum box, proving the mono chip drove sizing.
    expect(nodeWidth(coded)).toBeGreaterThan(64);
  });
});
