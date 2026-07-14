import { describe, it, expect } from "vitest";
import {
  contrastForeground,
  joycoTheme,
  perceptualLightness,
  resolveThemePaint,
  themeEdgeStyle,
  themeFlowOptions,
  themeGitOptions,
  layoutFlow,
} from "../src/index.js";
import { pathThrough } from "../src/geometry.js";
import type { FlowGraph, Point } from "../src/index.js";

describe("themeEdgeStyle", () => {
  it("maps the theme vocabulary onto EdgeStyle", () => {
    expect(themeEdgeStyle("angular")).toBe("elbow45");
    expect(themeEdgeStyle("orthogonal")).toBe("orthogonal");
    expect(themeEdgeStyle("rounded")).toBe("rounded");
    expect(themeEdgeStyle("bezier")).toBe("bezier");
    expect(themeEdgeStyle(undefined)).toBeUndefined();
  });
});

describe("themeFlowOptions / themeGitOptions", () => {
  it("scales density from the padding knob", () => {
    const sm = themeFlowOptions({ padding: "sm" });
    const lg = themeFlowOptions({ padding: "lg" });
    expect(sm.padding!).toBeLessThan(lg.padding!);
    expect(sm.layerGap!).toBeLessThan(lg.layerGap!);
    expect(sm.nodeGap!).toBeLessThan(lg.nodeGap!);
  });

  it("keeps explicit base options over theme-derived ones", () => {
    const opts = themeFlowOptions(joycoTheme, { padding: 99 });
    expect(opts.padding).toBe(99);
    expect(opts.edgeStyle).toBe("elbow45");
  });

  it("maps laneGap to the flow edgeGap (air between arrows and boxes)", () => {
    expect(themeFlowOptions({ laneGap: 6 }).edgeGap).toBe(6);
    expect(themeFlowOptions({ laneGap: 99 }).edgeGap).toBe(10);
    expect(themeFlowOptions({}).edgeGap).toBe(0);
  });

  it("edgeGap pulls edge endpoints off the node faces", () => {
    const graph = {
      kind: "flow" as const,
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b" }],
    };
    const flush = layoutFlow(graph);
    const gapped = layoutFlow(graph, { edgeGap: 6 });
    const yStart = (d: string) => Number((d.match(/-?\d+(?:\.\d+)?/g) as string[])[1]);
    const a = gapped.nodes.find((n) => n.id === "a")!;
    // TD: the edge leaves a's bottom face; with the gap it starts 6px lower.
    expect(yStart(gapped.edges[0]!.path)).toBeCloseTo(a.y + a.h! / 2 + 6, 5);
    expect(yStart(gapped.edges[0]!.path)).toBeGreaterThan(yStart(flush.edges[0]!.path));
  });

  it("widens git lanes with laneGap and clamps it to 0–10", () => {
    const tight = themeGitOptions({ laneGap: 0 });
    const roomy = themeGitOptions({ laneGap: 10 });
    const over = themeGitOptions({ laneGap: 999 });
    expect(roomy.laneWidth!).toBeGreaterThan(tight.laneWidth!);
    expect(over.laneWidth).toBe(roomy.laneWidth);
  });

  it("returns only the base when no theme is given", () => {
    expect(themeFlowOptions(undefined, { padding: 5 })).toEqual({ padding: 5 });
    expect(themeGitOptions(undefined)).toEqual({});
  });
});

describe("automatic contrast foregrounds", () => {
  it("reads L straight out of oklch() literals (number or percent)", () => {
    expect(perceptualLightness("oklch(0.85 0.2 120)")).toBeCloseTo(0.85, 6);
    expect(perceptualLightness("oklch(85% 0.2 120)")).toBeCloseTo(0.85, 6);
  });

  it("recovers OKLab L from hex via sRGB→OKLab", () => {
    expect(perceptualLightness("#ffffff")).toBeCloseTo(1, 3);
    expect(perceptualLightness("#000000")).toBeCloseTo(0, 3);
    // Independent reference: pure sRGB red has OKLab L ≈ 0.628.
    expect(perceptualLightness("#ff0000")!).toBeCloseTo(0.628, 2);
    // Shorthand hex expands.
    expect(perceptualLightness("#fff")).toBeCloseTo(1, 3);
  });

  it("returns undefined for colors it can't reason about", () => {
    expect(perceptualLightness("var(--color-primary)")).toBeUndefined();
    expect(perceptualLightness("rebeccapurple")).toBeUndefined();
    expect(contrastForeground("var(--x)")).toBeUndefined();
  });

  it("picks dark text on light fills and light text on dark fills", () => {
    expect(contrastForeground("#ffd400")).toBe("oklch(0.145 0 0)"); // yellow
    expect(contrastForeground("oklch(0.9 0.15 120)")).toBe("oklch(0.145 0 0)");
    expect(contrastForeground("#0011ff")).toBe("oklch(0.985 0 0)"); // deep blue
    expect(contrastForeground("oklch(0.3 0.1 260)")).toBe("oklch(0.985 0 0)");
  });

  it("derives missing -foregrounds in resolveThemePaint, explicit wins", () => {
    const paint = resolveThemePaint({
      tokens: {
        warning: "oklch(0.9 0.18 95)",
        primary: "#0011ff",
        // Explicit fg must NOT be overwritten by the derived pick.
        error: "#ff4d00",
        "error-foreground": "#ffffff",
        // Non-literal fill → nothing derived.
        info: "var(--color-chart-3)",
      },
    });
    expect(paint.vars["--trazo-warning-foreground"]).toBe("oklch(0.145 0 0)");
    expect(paint.vars["--trazo-primary-foreground"]).toBe("oklch(0.985 0 0)");
    expect(paint.vars["--trazo-error-foreground"]).toBe("#ffffff");
    expect(paint.vars["--trazo-info-foreground"]).toBeUndefined();
  });
});

describe("resolveThemePaint", () => {
  it("prefixes tokens as --trazo-* vars (plus derived foregrounds)", () => {
    const paint = resolveThemePaint({
      tokens: { primary: "#ff0000", "lane-2": "oklch(0.7 0.1 200)" },
    });
    expect(paint.vars).toEqual({
      "--trazo-primary": "#ff0000",
      "--trazo-primary-foreground": "oklch(0.985 0 0)",
      "--trazo-lane-2": "oklch(0.7 0.1 200)",
      "--trazo-lane-2-foreground": "oklch(0.145 0 0)",
    });
  });

  it("maps lane style to dash + linecap", () => {
    expect(resolveThemePaint({ laneStyle: "solid" }).dashArray).toBeUndefined();
    const dashed = resolveThemePaint({ laneStyle: "dashed" });
    expect(dashed.dashArray).toBeTruthy();
    expect(dashed.linecap).toBeUndefined();
    const dotted = resolveThemePaint({ laneStyle: "dotted" });
    expect(dotted.dashArray).toBeTruthy();
    expect(dotted.linecap).toBe("round");
  });

  it("keeps renderer defaults for an absent theme", () => {
    const paint = resolveThemePaint(undefined);
    expect(paint.cornerRadius).toBe(0);
    expect(paint.borderWidth).toBe(2);
    expect(paint.background).toBe("none");
    expect(paint.vars).toEqual({});
  });

  it("resolves the JOYCO house theme knobs", () => {
    const paint = resolveThemePaint(joycoTheme);
    expect(paint.cornerRadius).toBe(0);
    expect(paint.borderWidth).toBe(4);
    expect(paint.background).toBe("texture");
  });
});

describe("rounded / bezier edge styles", () => {
  const zigzag: Point[] = [
    { x: 0, y: 0 },
    { x: 0, y: 40 },
    { x: 60, y: 40 },
    { x: 60, y: 90 },
  ];

  it("rounded emits quadratic corners and no NaN", () => {
    const d = pathThrough(zigzag, "rounded");
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d).toContain("Q");
    expect(d).not.toContain("NaN");
  });

  it("bezier emits cubic segments through the waypoints", () => {
    const d = pathThrough(zigzag, "bezier");
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d).toContain("C");
    expect(d).not.toContain("NaN");
    expect(d.endsWith("60 90")).toBe(true);
  });

  it("bezier degrades to a line for two points", () => {
    expect(pathThrough([{ x: 0, y: 0 }, { x: 10, y: 10 }], "bezier")).toBe(
      "M 0 0 L 10 10",
    );
  });

  it("bezier paths never escape the canvas (basis spline = convex hull)", () => {
    const g = layoutFlow(
      {
        kind: "flow",
        nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "c", to: "a" },
          { from: "a", to: "a" },
        ],
      },
      { edgeStyle: "bezier" },
    );
    for (const e of g.edges) {
      const nums = (e.path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      for (let i = 0; i + 1 < nums.length; i += 2) {
        expect(nums[i]!, `${e.from}->${e.to} x`).toBeGreaterThanOrEqual(-0.5);
        expect(nums[i]!, `${e.from}->${e.to} x`).toBeLessThanOrEqual(g.width + 0.5);
        expect(nums[i + 1]!, `${e.from}->${e.to} y`).toBeGreaterThanOrEqual(-0.5);
        expect(nums[i + 1]!, `${e.from}->${e.to} y`).toBeLessThanOrEqual(g.height + 0.5);
      }
    }
  });

  it("full layouts stay sane in every style", () => {
    const graph: FlowGraph = {
      kind: "flow",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
        { from: "a", to: "a" },
      ],
    };
    for (const edgeStyle of ["elbow45", "orthogonal", "rounded", "bezier"] as const) {
      const g = layoutFlow(graph, { edgeStyle });
      for (const e of g.edges) {
        expect(e.path, `${edgeStyle} ${e.from}->${e.to}`).toBeTruthy();
        expect(e.path).not.toContain("NaN");
      }
    }
  });
});
