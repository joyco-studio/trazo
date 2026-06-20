import { describe, it, expect } from "vitest";
import { layout, layoutFlow } from "../src/index.js";
import type { FlowGraph, NodeShape } from "../src/index.js";

/**
 * Fixture flow: a diamond (fan-out then fan-in) plus a long edge that spans two
 * ranks (start → end skips the middle rank), exercising dummy-node routing.
 *
 *   start ──▶ a ──▶ join ──▶ end
 *      └────▶ b ─────┘
 *      └─────────────────────▶ end   (spans ranks 0 → 3)
 */
const fixture: FlowGraph = {
  kind: "flow",
  nodes: [
    { id: "start", label: "Start", shape: "stadium", role: "primary" },
    { id: "a", label: "Step A", shape: "box", role: "good" },
    { id: "b", label: "Step B", shape: "box", role: "pending" },
    { id: "join", label: "Join?", shape: "diamond", role: "neutral" },
    { id: "end", label: "Done", shape: "cylinder", role: "good" },
  ],
  edges: [
    { from: "start", to: "a", label: "go" },
    { from: "start", to: "b" },
    { from: "a", to: "join" },
    { from: "b", to: "join" },
    { from: "join", to: "end", label: "yes" },
    { from: "start", to: "end" },
  ],
};

describe("layoutFlow()", () => {
  it("is deterministic: equal input → deeply equal output", () => {
    expect(layoutFlow(fixture)).toEqual(layoutFlow(fixture));
  });

  it("is deterministic across two independently-constructed equal inputs", () => {
    const clone: FlowGraph = JSON.parse(JSON.stringify(fixture));
    expect(layoutFlow(fixture)).toEqual(layoutFlow(clone));
  });

  it("dispatches via layout() on kind === 'flow'", () => {
    expect(layout(fixture)).toEqual(layoutFlow(fixture));
  });

  it("ranks fan-out/fan-in correctly (sources before sinks)", () => {
    // In TD, y encodes rank. start is a source; end/join come later.
    const g = layoutFlow(fixture, { direction: "TD" });
    const y = (id: string) => g.nodes.find((n) => n.id === id)?.y ?? 0;
    expect(y("start")).toBeLessThan(y("a"));
    expect(y("start")).toBeLessThan(y("b"));
    expect(y("a")).toBeLessThan(y("join"));
    expect(y("b")).toBeLessThan(y("join"));
    expect(y("join")).toBeLessThan(y("end"));
  });

  it("ranks a back-edge (retry loop) by its forward parent, not the loop", () => {
    // A --> B(decision) --> {C, D}; D loops back to B. The D --> B back-edge
    // must NOT push B below D — B stays at rank 1, right under A.
    const loop: FlowGraph = {
      kind: "flow",
      nodes: [
        { id: "A", label: "Start", shape: "box" },
        { id: "B", label: "Is it working?", shape: "diamond" },
        { id: "C", label: "Great!", shape: "box" },
        { id: "D", label: "Debug", shape: "box" },
        { id: "E", label: "Deploy", shape: "box" },
        { id: "F", label: "End", shape: "box" },
      ],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C", label: "Yes" },
        { from: "B", to: "D", label: "No" },
        { from: "D", to: "B" }, // back-edge (retry)
        { from: "C", to: "E" },
        { from: "E", to: "F" },
      ],
    };
    const g = layoutFlow(loop, { direction: "TD" });
    const y = (id: string) => g.nodes.find((n) => n.id === id)?.y ?? 0;
    expect(y("A")).toBeLessThan(y("B"));
    expect(y("B")).toBeLessThan(y("C"));
    expect(y("B")).toBeLessThan(y("D"));
    // C and D share a rank (fan-out of the decision).
    expect(y("C")).toBe(y("D"));
    expect(y("C")).toBeLessThan(y("E"));
    expect(y("E")).toBeLessThan(y("F"));
  });

  it("TD vs LR project rank onto different axes", () => {
    const td = layoutFlow(fixture, { direction: "TD" });
    const lr = layoutFlow(fixture, { direction: "LR" });

    const tdY = (id: string) => td.nodes.find((n) => n.id === id)?.y ?? 0;
    const lrX = (id: string) => lr.nodes.find((n) => n.id === id)?.x ?? 0;

    // TD: rank grows along y. LR: rank grows along x.
    expect(tdY("start")).toBeLessThan(tdY("end"));
    expect(lrX("start")).toBeLessThan(lrX("end"));

    // The two layouts must differ (axes swapped).
    expect(td).not.toEqual(lr);
    // TD is taller than wide here; LR is wider than tall.
    expect(td.height).toBeGreaterThan(0);
    expect(lr.width).toBeGreaterThan(0);
  });

  it("sizes every shape with w>0 && h>0", () => {
    const shapes: NodeShape[] = ["box", "stadium", "diamond", "cylinder"];
    for (const shape of shapes) {
      const g = layoutFlow({
        kind: "flow",
        nodes: [{ id: "n", label: "Label", shape }],
        edges: [],
      });
      const n = g.nodes[0];
      expect(n?.w).toBeGreaterThan(0);
      expect(n?.h).toBeGreaterThan(0);
      expect(n?.shape).toBe(shape);
    }
  });

  it("every edge path is a valid SVG d string (M …)", () => {
    const { edges } = layoutFlow(fixture);
    for (const e of edges) expect(e.path).toMatch(/^M /);
  });

  it("emits flow edge kind", () => {
    const { edges } = layoutFlow(fixture);
    expect(edges.every((e) => e.kind === "flow")).toBe(true);
  });

  it("a labeled edge gets a labelPoint and labelWidth > 0", () => {
    const { edges } = layoutFlow(fixture);
    const labeled = edges.find((e) => e.from === "start" && e.to === "a");
    expect(labeled?.label).toBe("go");
    expect(labeled?.labelPoint).toBeDefined();
    expect(labeled?.labelWidth).toBeGreaterThan(0);
    // Unlabeled edges have no label point.
    const unlabeled = edges.find((e) => e.from === "start" && e.to === "b");
    expect(unlabeled?.labelPoint).toBeUndefined();
  });

  it("flow node color keys start with 'role-'", () => {
    const { nodes } = layoutFlow(fixture);
    for (const n of nodes) {
      expect(n.color).toMatch(/^role-/);
      expect(n.color).not.toMatch(/^#|rgb|hsl/);
    }
  });

  it("edges default to the neutral accent color", () => {
    const { edges } = layoutFlow(fixture);
    for (const e of edges) expect(e.color).toBe("accent");
  });

  it("colored edges take the source role color key", () => {
    const { edges } = layoutFlow({
      kind: "flow",
      nodes: [
        { id: "a", label: "A", role: "primary" },
        { id: "b", label: "B" },
      ],
      edges: [{ from: "a", to: "b", colored: true }],
    });
    expect(edges[0]?.color).toBe("role-primary");
  });

  it("laneCount reports the layer count (>= number of ranks)", () => {
    const g = layoutFlow(fixture);
    // start(0) → a/b(1) → join(2) → end(3): 4 layers.
    expect(g.laneCount).toBe(4);
  });

  it("defaults shape to box and role to neutral when omitted", () => {
    const g = layoutFlow({
      kind: "flow",
      nodes: [{ id: "x" }],
      edges: [],
    });
    const n = g.nodes[0];
    expect(n?.shape).toBe("box");
    expect(n?.role).toBe("neutral");
    expect(n?.color).toBe("role-neutral");
  });

  it("drops edges to unknown nodes without throwing", () => {
    const g = layoutFlow({
      kind: "flow",
      nodes: [{ id: "a", label: "A" }],
      edges: [{ from: "a", to: "ghost" }],
    });
    expect(g.edges).toHaveLength(0);
    expect(g.nodes).toHaveLength(1);
  });

  it("sets positive viewBox bounds", () => {
    const g = layoutFlow(fixture);
    expect(g.width).toBeGreaterThan(0);
    expect(g.height).toBeGreaterThan(0);
  });
});
