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

    // The back-edge must ATTACH to real faces, not dangle. Pull the path's
    // first/last absolute coordinates and assert they sit on D's and B's
    // boundary, and that the route detours past the diamond's right tip (the
    // corridor) instead of overlapping the forward B-->D edge.
    const node = (id: string) => g.nodes.find((n) => n.id === id)!;
    const D = node("D");
    const B = node("B");
    const back = g.edges.find((e) => e.from === "D" && e.to === "B")!;
    const nums = back.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const start = { x: nums[0], y: nums[1] };
    const end = { x: nums[nums.length - 2], y: nums[nums.length - 1] };
    const near = (a: number, b: number, tol = 2) => Math.abs(a - b) <= tol;

    // Starts on D's right side face; ends on B's right side face (cross-end).
    expect(near(start.x, D.x + D.w / 2)).toBe(true);
    expect(near(start.y, D.y)).toBe(true);
    expect(near(end.x, B.x + B.w / 2)).toBe(true);
    expect(near(end.y, B.y)).toBe(true);

    // The corridor bulges right of both node faces and stays inside the bounds.
    const maxX = Math.max(...nums.filter((_, i) => i % 2 === 0));
    expect(maxX).toBeGreaterThan(D.x + D.w / 2);
    expect(maxX).toBeGreaterThan(B.x + B.w / 2);
    expect(maxX).toBeLessThanOrEqual(g.width);
  });

  it("aligns sibling branch labels to a shared level (decision YES/NO row)", () => {
    // Two labeled edges out of one decision must share a main-axis level so the
    // branch labels read as one aligned row, instead of each riding its own
    // diagonal at a different depth (where the lower one can crowd its target).
    const decision: FlowGraph = {
      kind: "flow",
      nodes: [
        { id: "B", label: "Is it working?", shape: "diamond" },
        { id: "C", label: "Great!", shape: "box" },
        { id: "D", label: "Debug", shape: "box" },
      ],
      edges: [
        { from: "B", to: "C", label: "Yes" },
        { from: "B", to: "D", label: "No" },
      ],
    };
    const g = layoutFlow(decision, { direction: "TD" });
    const yes = g.edges.find((e) => e.label === "Yes")!.labelPoint!;
    const no = g.edges.find((e) => e.label === "No")!.labelPoint!;
    expect(yes.y).toBeCloseTo(no.y, 5);
    // They keep distinct horizontal positions (one per branch).
    expect(Math.abs(yes.x - no.x)).toBeGreaterThan(1);
  });

  it("aligns a single-node chain on one column (straight edges, no jog)", () => {
    // A chain of differently-sized lone nodes must share one cross coordinate so
    // the connecting edges are straight verticals (TD), not 45° jogged by the
    // per-node half-width drift from cross-axis packing.
    const chain: FlowGraph = {
      kind: "flow",
      nodes: [
        { id: "wide", label: "A very wide step label", shape: "box" },
        { id: "mid", label: "Medium", shape: "box" },
        { id: "x", label: "X", shape: "box" },
      ],
      edges: [
        { from: "wide", to: "mid" },
        { from: "mid", to: "x" },
      ],
    };
    const g = layoutFlow(chain, { direction: "TD" });
    const x = (id: string) => g.nodes.find((n) => n.id === id)!.x;
    expect(x("wide")).toBeCloseTo(x("mid"), 5);
    expect(x("mid")).toBeCloseTo(x("x"), 5);
    // Each connecting edge is a straight vertical: every path point shares one x.
    for (const e of g.edges) {
      const xs = e.path
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number)
        .filter((_, i) => i % 2 === 0);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      expect(maxX - minX).toBeLessThan(0.5);
    }
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

  it("places a fan-out edge label on its 45° diagonal run, not a flat run", () => {
    // In a decision fan-out the edge bends via a 45° diagonal to reach the
    // child's column. The label must sit on THAT diagonal's midpoint — not on a
    // horizontal/vertical stub — so it reads as riding the line. Assert the
    // label point falls on a rendered segment where |Δx| ≈ |Δy| (a 45° run).
    const g = layoutFlow(fixture, { direction: "TD" });
    const startToA = g.edges.find((e) => e.from === "start" && e.to === "a")!;
    const lp = startToA.labelPoint!;

    const nums = startToA.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < nums.length; i += 2) {
      pts.push({ x: nums[i], y: nums[i + 1] });
    }
    // Find the segment whose midpoint equals the label point.
    const onSeg = pts.slice(1).find((b, i) => {
      const a = pts[i];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      return Math.abs(mx - lp.x) < 0.5 && Math.abs(my - lp.y) < 0.5;
    });
    expect(onSeg).toBeDefined();
    // That hosting segment is a 45° diagonal: both axes move ~equally.
    const idx = pts.indexOf(onSeg!);
    const a = pts[idx - 1];
    const b = pts[idx];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    expect(dx).toBeGreaterThan(0.5);
    expect(dy).toBeGreaterThan(0.5);
    expect(Math.abs(dx - dy)).toBeLessThanOrEqual(0.5);
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
