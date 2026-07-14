import { describe, it, expect } from "vitest";
import { layout, layoutFlow } from "../src/index.js";
import { badgeWidth, BADGE_H } from "../src/geometry.js";
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
    { id: "a", label: "Step A", shape: "box", role: "success" },
    { id: "b", label: "Step B", shape: "box", role: "warning" },
    { id: "join", label: "Join?", shape: "diamond", role: "neutral" },
    { id: "end", label: "Done", shape: "cylinder", role: "success" },
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

  it("grows a node's height for a multi-line label, width = widest line", () => {
    const single = layoutFlow({
      kind: "flow",
      nodes: [{ id: "n", label: "Build", shape: "box" }],
      edges: [],
    }).nodes[0]!;
    const multi = layoutFlow({
      kind: "flow",
      nodes: [{ id: "n", label: "Build\nlonger second line", shape: "box" }],
      edges: [],
    }).nodes[0]!;
    // Two lines → taller than a one-line box.
    expect(multi.h!).toBeGreaterThan(single.h!);
    // Width tracks the WIDEST line ("longer second line" > "Build").
    expect(multi.w!).toBeGreaterThan(single.w!);
    // The stored label keeps its newline for the renderer to split.
    expect(multi.label).toBe("Build\nlonger second line");
  });

  it("a three-line label is taller than a two-line label", () => {
    const h = (label: string) =>
      layoutFlow({ kind: "flow", nodes: [{ id: "n", label, shape: "box" }], edges: [] })
        .nodes[0]!.h!;
    expect(h("a\nb\nc")).toBeGreaterThan(h("a\nb"));
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

  it("emits arrowHead 'end' by default, and honors none/both", () => {
    const g = layoutFlow({
      kind: "flow",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
        { id: "d", label: "D" },
      ],
      edges: [
        { from: "a", to: "b" }, // default → "end"
        { from: "a", to: "c", arrow: "none" },
        { from: "a", to: "d", arrow: "both" },
      ],
    });
    const head = (from: string, to: string) =>
      g.edges.find((e) => e.from === from && e.to === to)?.arrowHead;
    expect(head("a", "b")).toBe("end");
    expect(head("a", "c")).toBe("none");
    expect(head("a", "d")).toBe("both");
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

// ── subgraphs / clustering ───────────────────────────────────────────────────

const grouped: FlowGraph = {
  kind: "flow",
  nodes: [
    { id: "a", label: "A", group: "P" },
    { id: "b", label: "B", group: "P" },
    { id: "c", label: "C", group: "Q" },
    { id: "d", label: "D", group: "Q" },
    { id: "sink", label: "Sink" },
  ],
  edges: [
    { from: "a", to: "sink" },
    { from: "b", to: "sink" },
    { from: "c", to: "sink" },
    { from: "d", to: "sink" },
  ],
  groups: [
    { id: "P", label: "Group P" },
    { id: "Q", label: "Group Q" },
  ],
};

describe("layoutFlow() — subgraphs", () => {
  it("is deterministic with groups (repeat + clone)", () => {
    expect(layoutFlow(grouped)).toEqual(layoutFlow(grouped));
    const clone: FlowGraph = JSON.parse(JSON.stringify(grouped));
    expect(layoutFlow(grouped)).toEqual(layoutFlow(clone));
  });

  it("emits a PositionedGroup per declared group with members", () => {
    const g = layoutFlow(grouped);
    expect(g.groups).toBeDefined();
    expect(g.groups!.map((gp) => gp.id).sort()).toEqual(["P", "Q"]);
    for (const gp of g.groups!) {
      expect(gp.variant).toBe("group");
      expect(gp.w).toBeGreaterThan(0);
      expect(gp.h).toBeGreaterThan(0);
    }
  });

  it("keeps a group's members contiguous within their shared layer (no interleave)", () => {
    // a,b (P) and c,d (Q) all share rank 0. Sorted by x, the two P nodes must be
    // adjacent and the two Q nodes adjacent — never P,Q,P.
    const g = layoutFlow(grouped, { direction: "TD" });
    const row = ["a", "b", "c", "d"]
      .map((id) => ({ id, x: g.nodes.find((n) => n.id === id)!.x, grp: id < "c" ? "P" : "Q" }))
      .sort((u, v) => u.x - v.x);
    const groupsInOrder = row.map((r) => r.grp);
    // Collapse consecutive duplicates: a contiguous layout yields exactly 2 runs.
    const runs = groupsInOrder.filter((gr, i) => i === 0 || gr !== groupsInOrder[i - 1]);
    expect(runs.length).toBe(2);
  });

  it("group boxes that share a rank do not overlap", () => {
    const g = layoutFlow(grouped);
    const P = g.groups!.find((gp) => gp.id === "P")!;
    const Q = g.groups!.find((gp) => gp.id === "Q")!;
    const disjoint =
      P.x + P.w <= Q.x + 0.5 ||
      Q.x + Q.w <= P.x + 0.5 ||
      P.y + P.h <= Q.y + 0.5 ||
      Q.y + Q.h <= P.y + 0.5;
    expect(disjoint).toBe(true);
  });

  it("each group box contains its members' shape boxes", () => {
    const g = layoutFlow(grouped);
    for (const gp of g.groups!) {
      const members = g.nodes.filter((n) =>
        gp.id === "P" ? n.id === "a" || n.id === "b" : n.id === "c" || n.id === "d",
      );
      for (const m of members) {
        expect(m.x - m.w! / 2).toBeGreaterThanOrEqual(gp.x - 0.5);
        expect(m.x + m.w! / 2).toBeLessThanOrEqual(gp.x + gp.w + 0.5);
        expect(m.y - m.h! / 2).toBeGreaterThanOrEqual(gp.y - 0.5);
        expect(m.y + m.h! / 2).toBeLessThanOrEqual(gp.y + gp.h + 0.5);
      }
    }
  });

  it("reserves title room and keeps all geometry within positive bounds", () => {
    const g = layoutFlow(grouped);
    for (const gp of g.groups!) {
      expect(gp.x).toBeGreaterThanOrEqual(0);
      expect(gp.y).toBeGreaterThanOrEqual(0);
      expect(gp.x + gp.w).toBeLessThanOrEqual(g.width);
      expect(gp.y + gp.h).toBeLessThanOrEqual(g.height);
      expect(gp.label).toBeDefined();
      expect(gp.labelWidth).toBeGreaterThan(0);
    }
  });

  it("omits the groups key entirely when no node is grouped", () => {
    expect(layoutFlow(fixture).groups).toBeUndefined();
  });

  it("skips an empty declared group (no members → no box)", () => {
    const g = layoutFlow({
      kind: "flow",
      nodes: [{ id: "x", label: "X", group: "Real" }],
      edges: [],
      groups: [
        { id: "Real", label: "Real" },
        { id: "Empty", label: "Empty" },
      ],
    });
    expect(g.groups!.map((gp) => gp.id)).toEqual(["Real"]);
  });

  it("reserves the title strip along the TOP in BOTH directions (TD and LR)", () => {
    // The renderer places a subgraph title at the top of the box in both
    // directions, so the layout must reserve the strip on top either way —
    // otherwise an LR title overlaps the members.
    const src = {
      kind: "flow" as const,
      nodes: [
        { id: "a", label: "A", group: "G" },
        { id: "b", label: "B", group: "G" },
      ],
      edges: [{ from: "a", to: "b" }],
      groups: [{ id: "G", label: "Title" }],
    };
    for (const direction of ["TD", "LR"] as const) {
      const g = layoutFlow(src, { direction });
      const box = g.groups![0]!;
      const topMemberEdge = Math.min(...g.nodes.map((n) => n.y - n.h! / 2));
      // The title strip (box top → top + GROUP_TITLE_H) sits ABOVE every member.
      expect(box.y + 22).toBeLessThanOrEqual(topMemberEdge + 0.5);
      // And the box never escapes the top of the viewBox.
      expect(box.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps horizontal (LR) edge labels clear of the adjacent node boxes", () => {
    // Regression: a fixed layerGap left the label badge — whose WIDTH lies on
    // the main axis in LR — drawn under both neighbouring nodes. The gap must
    // grow to fit the badge so the label stays fully readable.
    const chain: FlowGraph = {
      kind: "flow",
      nodes: [
        { id: "main", label: "main", role: "primary" },
        { id: "elvira", label: "elvira/checkout", role: "success" },
        { id: "homero", label: "homero/receipts", role: "info" },
      ],
      edges: [
        { from: "main", to: "elvira", label: "base of" },
        { from: "elvira", to: "homero", label: "base of" },
      ],
    };
    const g = layoutFlow(chain, { direction: "LR" });
    for (const e of g.edges) {
      if (e.labelPoint === undefined) continue;
      const half = badgeWidth(e.labelWidth ?? 0) / 2;
      const lo = e.labelPoint.x - half;
      const hi = e.labelPoint.x + half;
      for (const n of g.nodes) {
        const nLo = n.x - n.w! / 2;
        const nHi = n.x + n.w! / 2;
        const overlap = Math.min(hi, nHi) - Math.max(lo, nLo);
        expect(overlap).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("does NOT add main-axis spacing for vertical (TD) labels — BADGE_H already fits", () => {
    // The badge's main-axis extent in TD is its small height, which fits the
    // default layerGap. A labeled TD flow must be no taller than its unlabeled
    // twin (the fix is horizontal-only).
    const nodes = [
      { id: "a", label: "a" },
      { id: "b", label: "b" },
    ];
    const labeled = layoutFlow(
      { kind: "flow", nodes, edges: [{ from: "a", to: "b", label: "wide label here" }] },
      { direction: "TD" },
    );
    const unlabeled = layoutFlow(
      { kind: "flow", nodes, edges: [{ from: "a", to: "b" }] },
      { direction: "TD" },
    );
    expect(labeled.height).toBe(unlabeled.height);
    // Sanity: the badge height is what fits, not its (larger) width.
    expect(BADGE_H).toBeLessThan(56);
  });

  it("keeps tight layerGap spacing for UNLABELED horizontal flows", () => {
    const g = layoutFlow(
      {
        kind: "flow",
        nodes: [
          { id: "a", label: "a" },
          { id: "b", label: "b" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
      { direction: "LR" },
    );
    const a = g.nodes.find((n) => n.id === "a")!;
    const b = g.nodes.find((n) => n.id === "b")!;
    const faceGap = b.x - b.w! / 2 - (a.x + a.w! / 2);
    expect(faceGap).toBeCloseTo(56, 0); // default layerGap, un-widened
  });
});

// ── notes (annotations) ─────────────────────────────────────────────────────

describe("layoutFlow() — notes", () => {
  // The motivating case: a strictly linear pipeline plus one note below `layout`.
  const pipeline = (withNote: boolean): FlowGraph => {
    const g: FlowGraph = {
      kind: "flow",
      nodes: [
        { id: "js", label: "JS", shape: "box" },
        { id: "style", label: "Style", shape: "box" },
        { id: "layout", label: "Layout", shape: "box" },
        { id: "paint", label: "Paint", shape: "box" },
        { id: "composite", label: "Composite", shape: "box" },
      ],
      edges: [
        { from: "js", to: "style", arrow: "none" },
        { from: "style", to: "layout", arrow: "none" },
        { from: "layout", to: "paint", arrow: "none" },
        { from: "paint", to: "composite", arrow: "none" },
      ],
    };
    if (withNote) {
      g.notes = [{ target: "layout", side: "below", label: "this one makes fps cry" }];
    }
    return g;
  };

  it("has ZERO effect on real-node positions (regression guard vs ranking leakage)", () => {
    const bare = layoutFlow(pipeline(false), { direction: "LR" });
    const noted = layoutFlow(pipeline(true), { direction: "LR" });
    const real = (g: ReturnType<typeof layoutFlow>) =>
      g.nodes.filter((n) => n.kind !== "note").map((n) => ({ id: n.id, x: n.x, y: n.y }));
    // Byte-identical positions for every real node.
    expect(real(noted)).toEqual(real(bare));
  });

  it("renders the motivating pipeline as a single straight LR line", () => {
    const g = layoutFlow(pipeline(true), { direction: "LR" });
    const real = g.nodes.filter((n) => n.kind !== "note");
    // Strictly linear: every real node shares one cross-axis (y) coordinate and
    // x strictly increases in pipeline order.
    const ys = new Set(real.map((n) => Math.round(n.y)));
    expect(ys.size).toBe(1);
    const order = ["js", "style", "layout", "paint", "composite"];
    const xs = order.map((id) => real.find((n) => n.id === id)!.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });

  it("emits the note as a kind:'note' chip and a neutral leader edge", () => {
    const g = layoutFlow(pipeline(true), { direction: "LR" });
    const note = g.nodes.find((n) => n.kind === "note")!;
    expect(note).toBeDefined();
    expect(note.label).toBe("this one makes fps cry");
    expect(note.shape).toBe("box");
    const leader = g.edges.find((e) => e.kind === "note")!;
    expect(leader).toBeDefined();
    expect(leader.to).toBe("layout");
    expect(leader.from).toBe(note.id);
    expect(leader.color).toBe("accent"); // neutral, not tinted by the target role
    expect(leader.arrowHead).toBe("end");
    expect(leader.path).toBeTruthy();
    expect(leader.path.includes("NaN")).toBe(false);
  });

  it("places the note below its target with the leader pointing up (LR)", () => {
    const g = layoutFlow(pipeline(true), { direction: "LR" });
    const target = g.nodes.find((n) => n.id === "layout")!;
    const note = g.nodes.find((n) => n.kind === "note")!;
    // Below → note center-y is past the target's bottom face, roughly on its x.
    expect(note.y).toBeGreaterThan(target.y + target.h! / 2);
    expect(note.x).toBeCloseTo(target.x, 0);
  });

  const sides = [
    { side: "above", axis: "y", dir: -1 },
    { side: "below", axis: "y", dir: +1 },
    { side: "left", axis: "x", dir: -1 },
    { side: "right", axis: "x", dir: +1 },
  ] as const;

  for (const direction of ["TD", "LR"] as const) {
    for (const { side, axis, dir } of sides) {
      it(`places a '${side}' note on the correct side in ${direction}`, () => {
        const g = layoutFlow(
          {
            kind: "flow",
            nodes: [
              { id: "a", label: "A", shape: "box" },
              { id: "b", label: "B", shape: "box" },
            ],
            edges: [{ from: "a", to: "b" }],
            notes: [{ target: "b", side, label: "note" }],
          },
          { direction },
        );
        const b = g.nodes.find((n) => n.id === "b")!;
        const note = g.nodes.find((n) => n.kind === "note")!;
        if (axis === "y") {
          // Cross/main position on x is shared with the target; y is offset.
          expect(note.x).toBeCloseTo(b.x, 0);
          if (dir < 0) expect(note.y).toBeLessThan(b.y);
          else expect(note.y).toBeGreaterThan(b.y);
        } else {
          expect(note.y).toBeCloseTo(b.y, 0);
          if (dir < 0) expect(note.x).toBeLessThan(b.x);
          else expect(note.x).toBeGreaterThan(b.x);
        }
        // The note chip is fully inside the reported bounds (never clipped).
        expect(note.x - note.w! / 2).toBeGreaterThanOrEqual(-0.01);
        expect(note.y - note.h! / 2).toBeGreaterThanOrEqual(-0.01);
        expect(note.x + note.w! / 2).toBeLessThanOrEqual(g.width + 0.01);
        expect(note.y + note.h! / 2).toBeLessThanOrEqual(g.height + 0.01);
      });
    }
  }

  it("stacks two notes on the same side outward from the target", () => {
    const g = layoutFlow(
      {
        kind: "flow",
        nodes: [{ id: "a", label: "A", shape: "box" }],
        edges: [],
        notes: [
          { target: "a", side: "below", label: "first" },
          { target: "a", side: "below", label: "second" },
        ],
      },
      { direction: "TD" },
    );
    const a = g.nodes.find((n) => n.id === "a")!;
    const first = g.nodes.find((n) => n.label === "first")!;
    const second = g.nodes.find((n) => n.label === "second")!;
    // Both below the target; the second sits farther out than the first.
    expect(first.y).toBeGreaterThan(a.y);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it("drops a note whose target is not a real node", () => {
    const g = layoutFlow({
      kind: "flow",
      nodes: [{ id: "a", label: "A", shape: "box" }],
      edges: [],
      notes: [{ target: "ghost", side: "below", label: "orphan" }],
    });
    expect(g.nodes.some((n) => n.kind === "note")).toBe(false);
    expect(g.edges.some((e) => e.kind === "note")).toBe(false);
  });

  it("is deterministic with notes", () => {
    expect(layoutFlow(pipeline(true))).toEqual(layoutFlow(pipeline(true)));
  });
});
