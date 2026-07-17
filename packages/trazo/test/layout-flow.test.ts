import { describe, it, expect } from "vitest";
import { layout, layoutFlow } from "../src/index.js";
import { badgeWidth, badgeHeight, BADGE_H, measurePlainMultiline } from "../src/geometry.js";
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

  it("reserves a multi-line edge label's widest line (not the concatenation)", () => {
    // Regression (#15): the engine measured edge labels multi-line but the
    // renderer drew them single-line, so the badge width tracked the WIDEST line
    // while the drawn text ran every line together (wider) and overflowed. Now
    // both agree: labelWidth = widest line, labelHeight = line count × line-height.
    const graph: FlowGraph = {
      kind: "flow",
      nodes: [
        { id: "a", label: "main" },
        { id: "b", label: "elvira/checkout" },
      ],
      edges: [{ from: "a", to: "b", label: "commit\nscroll deltas" }],
    };
    const g = layoutFlow(graph, { direction: "LR" });
    const e = g.edges.find((x) => x.from === "a" && x.to === "b")!;
    const measured = measurePlainMultiline("commit\nscroll deltas");
    // Width is the widest single line, NOT "commit scroll deltas" concatenated.
    expect(e.labelWidth).toBeCloseTo(measured.width, 3);
    const concatenated = measurePlainMultiline("commit scroll deltas").width;
    expect(e.labelWidth!).toBeLessThan(concatenated);
    // Height spans both lines, so the badge grows past a single-line BADGE_H.
    expect(e.labelHeight).toBeCloseTo(measured.height, 3);
    expect(badgeHeight(e.labelHeight ?? 0)).toBeGreaterThan(BADGE_H);
  });

  it("keeps a multi-line edge label badge fully within the canvas (LR and TD)", () => {
    // Acceptance (#15): both lines readable and fully contained, in LR and TD.
    const graph: FlowGraph = {
      kind: "flow",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      edges: [{ from: "a", to: "b", label: "one\ntwo" }],
    };
    for (const direction of ["LR", "TD"] as const) {
      const g = layoutFlow(graph, { direction });
      const e = g.edges.find((x) => x.from === "a" && x.to === "b")!;
      const halfW = badgeWidth(e.labelWidth ?? 0) / 2;
      const halfH = badgeHeight(e.labelHeight ?? 0) / 2;
      const lp = e.labelPoint!;
      expect(lp.x - halfW).toBeGreaterThanOrEqual(-0.5);
      expect(lp.y - halfH).toBeGreaterThanOrEqual(-0.5);
      expect(lp.x + halfW).toBeLessThanOrEqual(g.width + 0.5);
      expect(lp.y + halfH).toBeLessThanOrEqual(g.height + 0.5);
    }
  });

  it("keeps a tall sibling label clear of the source after alignment (#15)", () => {
    // Sibling labels snap to the SHALLOWEST of the group's levels. A short
    // sibling can set a level so shallow that a tall multi-line sibling, dragged
    // up to it, would poke into the source box. The alignment floor must keep the
    // tallest badge clear of the source's forward face (TD: bottom, LR: right).
    for (const direction of ["TD", "LR"] as const) {
      const graph: FlowGraph = {
        kind: "flow",
        nodes: [
          { id: "s", label: "S" },
          { id: "k0", label: "k0" },
          { id: "k1", label: "k1" },
        ],
        edges: [
          { from: "s", to: "k0", label: "a\nb\nc\nd\ne" },
          { from: "s", to: "k1", label: "ok" },
        ],
      };
      const g = layoutFlow(graph, { direction });
      const s = g.nodes.find((n) => n.id === "s")!;
      const srcForward = direction === "TD" ? s.y + s.h! / 2 : s.x + s.w! / 2;
      for (const e of g.edges) {
        if (e.labelPoint === undefined) continue;
        const half =
          (direction === "TD"
            ? badgeHeight(e.labelHeight ?? 0)
            : badgeWidth(e.labelWidth ?? 0)) / 2;
        const main = direction === "TD" ? e.labelPoint.y : e.labelPoint.x;
        expect(main - half).toBeGreaterThanOrEqual(srcForward - 0.5);
      }
    }
  });

  it("leaves single-line edge labels unchanged (labelHeight = one line)", () => {
    const graph: FlowGraph = {
      kind: "flow",
      nodes: [
        { id: "a", label: "a" },
        { id: "b", label: "b" },
      ],
      edges: [{ from: "a", to: "b", label: "go" }],
    };
    const e = layoutFlow(graph).edges.find((x) => x.from === "a")!;
    expect(badgeHeight(e.labelHeight ?? 0)).toBeCloseTo(BADGE_H, 3);
  });

  it("widens a group box narrower than its own title so the title isn't clipped", () => {
    // A one-node group whose title is far wider than the node: the box must be
    // at least the title width (+ padding on each side), so the left-aligned
    // title fits inside instead of overflowing the box / viewBox.
    const g = layoutFlow({
      kind: "flow",
      nodes: [{ id: "x", label: "X", group: "G" }],
      edges: [],
      groups: [{ id: "G", label: "A Very Long Subgraph Title Here" }],
    });
    const box = g.groups!.find((gp) => gp.id === "G")!;
    expect(box.labelWidth).toBeGreaterThan(0);
    // Title + a GROUP_PAD (16) gutter on each side must fit within the box.
    expect(box.w).toBeGreaterThanOrEqual(box.labelWidth! + 16 * 2 - 0.5);
    // And the box stays within the viewBox.
    expect(box.x + box.w).toBeLessThanOrEqual(g.width + 0.5);
  });

  it("pulls an edge-less group member into its cluster's rank band", () => {
    // `dom` has no edges, so longest-path would strand it at rank 0 (left in LR),
    // stretching the `page` box across the `window` box. Cluster cohesion re-ranks
    // it to sit with its edge-connected cluster-mate `canvas` (rank 1), so the two
    // subgraph boxes end up side by side and DON'T overlap.
    const g = layoutFlow({
      kind: "flow",
      direction: "LR",
      nodes: [
        { id: "view", label: "Viewport", group: "window" },
        { id: "canvas", label: "Canvas", group: "page" },
        { id: "dom", label: "DOM", group: "page" },
      ],
      edges: [{ from: "view", to: "canvas" }],
      groups: [
        { id: "window", label: "Window" },
        { id: "page", label: "Page" },
      ],
    });
    const win = g.groups!.find((gp) => gp.id === "window")!;
    const page = g.groups!.find((gp) => gp.id === "page")!;
    // Boxes are disjoint on one axis (side by side in x).
    const disjoint =
      win.x + win.w <= page.x + 0.5 ||
      page.x + page.w <= win.x + 0.5 ||
      win.y + win.h <= page.y + 0.5 ||
      page.y + page.h <= win.y + 0.5;
    expect(disjoint).toBe(true);
    // `dom` sits inside its own box (not stranded far left inside `window`).
    const dom = g.nodes.find((n) => n.id === "dom")!;
    expect(dom.x - dom.w! / 2).toBeGreaterThanOrEqual(page.x - 0.5);
    expect(dom.x + dom.w! / 2).toBeLessThanOrEqual(page.x + page.w + 0.5);
  });

  it("lifts an external predecessor ABOVE a self-contained cluster (no overlap)", () => {
    // `ext` feeds a node inside a downward-closed cluster and would otherwise
    // share the cluster's top rank (landing inside the box). It must sit ABOVE
    // the box instead, clear of it.
    const g = layoutFlow({
      kind: "flow",
      direction: "TD",
      nodes: [
        { id: "top", label: "Top", group: "C" },
        { id: "mid", label: "Mid", group: "C" },
        { id: "bot", label: "Bot", group: "C" },
        { id: "ext", label: "External feeder" },
      ],
      edges: [
        { from: "top", to: "mid" },
        { from: "mid", to: "bot" },
        { from: "ext", to: "mid" },
      ],
      groups: [{ id: "C", label: "Cluster" }],
    });
    const box = g.groups!.find((gp) => gp.id === "C")!;
    const ext = g.nodes.find((n) => n.id === "ext")!;
    // `ext` is entirely above the cluster box (its bottom edge clears the box top).
    expect(ext.y + ext.h! / 2).toBeLessThanOrEqual(box.y + 0.5);
    // The three cluster members are inside the box.
    for (const id of ["top", "mid", "bot"]) {
      const n = g.nodes.find((m) => m.id === id)!;
      expect(n.y - n.h! / 2).toBeGreaterThanOrEqual(box.y - 0.5);
      expect(n.y + n.h! / 2).toBeLessThanOrEqual(box.y + box.h + 0.5);
    }
  });

  it("keeps the cluster spine straight while external feeders route in", () => {
    // A vertical intra-cluster chain (top→mid→bot) fed by TWO external nodes into
    // the middle member. The feeders' routing dummies share the top member's rank
    // and would otherwise drag the spine into a staircase (each member on its own
    // column). The cluster member must win its aligned slot: top/mid/bot stay in
    // one straight column and the feeders bend to route in.
    const g = layoutFlow({
      kind: "flow",
      direction: "TD",
      nodes: [
        { id: "top", label: "Top", group: "C" },
        { id: "mid", label: "Mid", group: "C" },
        { id: "bot", label: "Bot", group: "C" },
        { id: "f1", label: "Feeder one" },
        { id: "f2", label: "Feeder two" },
      ],
      edges: [
        { from: "top", to: "mid" },
        { from: "mid", to: "bot" },
        { from: "f1", to: "mid" },
        { from: "f2", to: "mid" },
      ],
      groups: [{ id: "C", label: "Cluster" }],
    });
    const top = g.nodes.find((n) => n.id === "top")!;
    const mid = g.nodes.find((n) => n.id === "mid")!;
    const bot = g.nodes.find((n) => n.id === "bot")!;
    // All three members share one vertical column (a straight spine, not a stair).
    expect(Math.abs(top.x - mid.x)).toBeLessThan(1);
    expect(Math.abs(bot.x - mid.x)).toBeLessThan(1);
  });

  it("keeps the spine straight when externals connect at the cluster ENDS", () => {
    // A spine endpoint has an intra-cluster neighbor on only ONE side (top → down
    // to mid; bot ← up from mid). With externals attached on the OTHER side (into
    // top, out of bot), a per-sweep same-group filter would fall back to the
    // external median on the endpoint's outward pass and drift it off the column.
    // The both-sides anchor must hold top/mid/bot on one straight spine.
    const g = layoutFlow({
      kind: "flow",
      direction: "TD",
      nodes: [
        { id: "top", label: "Top", group: "C" },
        { id: "mid", label: "Mid", group: "C" },
        { id: "bot", label: "Bot", group: "C" },
        { id: "eTop", label: "Feeds the top member" },
        { id: "eBot", label: "Fed by the bottom member" },
      ],
      edges: [
        { from: "top", to: "mid" },
        { from: "mid", to: "bot" },
        { from: "eTop", to: "top" },
        { from: "bot", to: "eBot" },
      ],
      groups: [{ id: "C", label: "Cluster" }],
    });
    const top = g.nodes.find((n) => n.id === "top")!;
    const mid = g.nodes.find((n) => n.id === "mid")!;
    const bot = g.nodes.find((n) => n.id === "bot")!;
    expect(Math.abs(top.x - mid.x)).toBeLessThan(1);
    expect(Math.abs(bot.x - mid.x)).toBeLessThan(1);
  });

  it("spaces a cluster row evenly around a fed member (symmetry)", () => {
    // Three same-width siblings in a subgraph, no edges between them; two
    // external nodes feed the MIDDLE one. The fed member is pulled to its
    // feeders' median, but its isolated flankers must follow so the row stays
    // evenly spaced (equal gaps, member centered) instead of lopsided.
    const g = layoutFlow({
      kind: "flow",
      direction: "TD",
      nodes: [
        // l and r share a label so their widths are identical — then equal side
        // gaps AND a centered middle must both hold.
        { id: "l", label: "Padding region", group: "C" },
        { id: "m", label: "Viewport", group: "C" },
        { id: "r", label: "Padding region", group: "C" },
        { id: "f1", label: "Feeder one" },
        { id: "f2", label: "Feeder two" },
      ],
      edges: [
        { from: "f1", to: "m" },
        { from: "f2", to: "m" },
      ],
      groups: [{ id: "C", label: "Cluster" }],
    });
    const l = g.nodes.find((n) => n.id === "l")!;
    const m = g.nodes.find((n) => n.id === "m")!;
    const r = g.nodes.find((n) => n.id === "r")!;
    // The three sit in one row; the middle is centered between its flankers…
    expect(Math.abs(l.y - m.y)).toBeLessThan(1);
    expect(Math.abs(r.y - m.y)).toBeLessThan(1);
    expect(Math.abs((l.x + r.x) / 2 - m.x)).toBeLessThan(1);
    // …and the gaps on each side of the middle are equal (l and r same width).
    const gapL = m.x - m.w! / 2 - (l.x + l.w! / 2);
    const gapR = r.x - r.w! / 2 - (m.x + m.w! / 2);
    expect(Math.abs(gapL - gapR)).toBeLessThan(1);
  });

  it("keeps a GROUPED chain of differently-sized nodes on one straight column", () => {
    // The motivating bug: a vertical intra-cluster chain of nodes with growing
    // widths drifted a few px off a common column (the group-aware alignment
    // averaged both neighbours, converging too slowly under the old bounded
    // sweeps), so every connecting edge showed a 45° jog. Block alignment shares
    // one cross coordinate across the whole chain, so the spine is dead straight
    // AND each edge is a strict vertical — regardless of per-node width.
    const g = layoutFlow({
      kind: "flow",
      direction: "TD",
      nodes: [
        { id: "s", label: "S", group: "M" },
        { id: "l", label: "Layout", group: "M" },
        { id: "pp", label: "Pre-paint stage", group: "M" },
        { id: "p", label: "Paint (generate display lists)", group: "M" },
      ],
      edges: [
        { from: "s", to: "l" },
        { from: "l", to: "pp" },
        { from: "pp", to: "p" },
      ],
      groups: [{ id: "M", label: "Main Thread" }],
    });
    const x = (id: string) => g.nodes.find((n) => n.id === id)!.x;
    for (const id of ["l", "pp", "p"]) {
      expect(Math.abs(x(id) - x("s"))).toBeLessThan(0.5);
    }
    // Every connecting edge is a strict vertical: all its x's collapse to one.
    for (const e of g.edges) {
      const xs = e.path
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number)
        .filter((_, i) => i % 2 === 0);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.5);
    }
  });
});

// ── reversed (start) arrows ──────────────────────────────────────────────────

describe("layoutFlow() — reversed arrows", () => {
  it("carries a start arrowhead through to the positioned edge", () => {
    const g = layoutFlow({
      kind: "flow",
      direction: "LR",
      nodes: [{ id: "main", label: "main" }, { id: "child", label: "child" }],
      edges: [{ from: "main", to: "child", arrow: "start", label: "base of" }],
    });
    // main stays the source (leftmost); the head is emitted at the source end.
    const main = g.nodes.find((n) => n.id === "main")!;
    const child = g.nodes.find((n) => n.id === "child")!;
    expect(main.x).toBeLessThan(child.x);
    expect(g.edges[0]?.arrowHead).toBe("start");
  });
});

// ── parallel bidirectional pairs ─────────────────────────────────────────────

describe("layoutFlow() — parallel bidirectional pairs", () => {
  it("routes a 1↔1 pair as two parallel lines with both labels centered", () => {
    // A↔B, each the sole node on its rank: Mermaid draws two parallel lines with
    // both labels stacked BETWEEN the boxes. The reverse edge must run through the
    // gap (offset from its twin), NOT dip out on a lateral corridor.
    const g = layoutFlow({
      kind: "flow",
      direction: "LR",
      nodes: [{ id: "A", label: "A" }, { id: "B", label: "B" }],
      edges: [
        { from: "A", to: "B", label: "commit" },
        { from: "B", to: "A", label: "scroll deltas" },
      ],
    });
    const fwd = g.edges.find((e) => e.from === "A" && e.to === "B")!;
    const rev = g.edges.find((e) => e.from === "B" && e.to === "A")!;
    // Both labels share the gap-centre main-axis coordinate (LR → x), offset on
    // the cross axis (y) so they stack.
    expect(Math.abs(fwd.labelPoint!.x - rev.labelPoint!.x)).toBeLessThan(0.5);
    expect(Math.abs(fwd.labelPoint!.y - rev.labelPoint!.y)).toBeGreaterThan(4);
    // The reverse edge stays within the boxes' vertical band — no lateral dip.
    const A = g.nodes.find((n) => n.id === "A")!;
    const revYs = rev.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 1);
    expect(Math.max(...revYs)).toBeLessThanOrEqual(A.y + A.h! / 2 + 0.5);
  });

  it("reserves the inter-node gap for the WIDER of the pair's two labels", () => {
    // The reverse label is wider than the forward one (or the forward is absent):
    // the gap must widen to the LARGER label so BOTH badges sit within it, never
    // clipped under the node boxes. (Only forward labels used to reserve the gap.)
    for (const edges of [
      // reverse-only:
      [{ from: "A", to: "B" }, { from: "B", to: "A", label: "commit periodic sync" }],
      // both, reverse wider:
      [
        { from: "A", to: "B", label: "sarasa" },
        { from: "B", to: "A", label: "commit periodic sync" },
      ],
    ] as const) {
      const g = layoutFlow({
        kind: "flow",
        direction: "LR",
        nodes: [{ id: "A", label: "Request arrives" }, { id: "B", label: "getCart() started" }],
        edges: [...edges],
      });
      const A = g.nodes.find((n) => n.id === "A")!;
      const B = g.nodes.find((n) => n.id === "B")!;
      const gapL = A.x + A.w! / 2;
      const gapR = B.x - B.w! / 2;
      for (const e of g.edges) {
        if (e.labelPoint === undefined) continue;
        const half = badgeWidth(e.labelWidth ?? 0) / 2;
        expect(e.labelPoint.x - half).toBeGreaterThanOrEqual(gapL - 0.5);
        expect(e.labelPoint.x + half).toBeLessThanOrEqual(gapR + 0.5);
      }
    }
  });

  it("keeps a retry loop into a fanned-out decision on the lateral arc", () => {
    // B(decision) → {C, D}, D → B. D's rank has a sibling (C), so the pair is NOT
    // sole-on-rank: the back-edge keeps its outward lateral corridor (loop look).
    const g = layoutFlow({
      kind: "flow",
      direction: "TD",
      nodes: [
        { id: "B", label: "Decide", shape: "diamond" },
        { id: "C", label: "C" },
        { id: "D", label: "D" },
      ],
      edges: [
        { from: "B", to: "C" },
        { from: "B", to: "D" },
        { from: "D", to: "B" },
      ],
    });
    const B = g.nodes.find((n) => n.id === "B")!;
    const D = g.nodes.find((n) => n.id === "D")!;
    const back = g.edges.find((e) => e.from === "D" && e.to === "B")!;
    const xs = back.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 0);
    // The corridor bulges right, past both boxes' right faces.
    expect(Math.max(...xs)).toBeGreaterThan(Math.max(B.x + B.w! / 2, D.x + D.w! / 2));
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

  it("leaves real-node positions byte-identical when the note needs no shift (canonical LR below)", () => {
    // A `below` note on a mid-pipeline node in LR drops into free space and never
    // spills off-canvas, so no normalization shift fires and real nodes are
    // untouched — the primary regression guard against ranking leakage. (A note
    // that WOULD spill is allowed to translate the graph to stay aligned + in
    // frame; that case is covered separately.)
    const bare = layoutFlow(pipeline(false), { direction: "LR" });
    const noted = layoutFlow(pipeline(true), { direction: "LR" });
    const real = (g: ReturnType<typeof layoutFlow>) =>
      g.nodes.filter((n) => n.kind !== "note").map((n) => ({ id: n.id, x: n.x, y: n.y }));
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

  it("keeps a note aligned with its target and its leader perpendicular (straight), even against the origin", () => {
    // A wide note on the top/left-most node would spill past the padded origin.
    // The note stays CENTERED on its target's cross-axis (so the leader is a
    // straight perpendicular arrow), and the whole graph shifts to keep it in
    // frame — alignment + no-clip is preferred over holding real nodes fixed.
    const base: FlowGraph = {
      kind: "flow",
      nodes: [
        { id: "a", label: "Top", shape: "box" },
        { id: "b", label: "Mid", shape: "box" },
        { id: "c", label: "Bot", shape: "box" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };
    const wide = "an annotation far wider than the tiny graph it hangs off";
    // vertical sides align on x (vertical leader); horizontal sides align on y.
    for (const [direction, side, axis] of [
      ["TD", "above", "x"],
      ["TD", "left", "y"],
      ["LR", "above", "x"],
      ["LR", "left", "y"],
    ] as const) {
      const g = layoutFlow(
        { ...base, notes: [{ target: "a", side, label: wide }] },
        { direction },
      );
      const target = g.nodes.find((n) => n.id === "a")!;
      const note = g.nodes.find((n) => n.kind === "note")!;
      const tag = `${direction}/${side}`;
      // Aligned on the shared axis → a straight perpendicular leader.
      if (axis === "x") expect(note.x, tag).toBeCloseTo(target.x, 5);
      else expect(note.y, tag).toBeCloseTo(target.y, 5);
      // Never clipped by the viewBox on any edge.
      expect(note.x - note.w! / 2, tag).toBeGreaterThanOrEqual(-0.01);
      expect(note.y - note.h! / 2, tag).toBeGreaterThanOrEqual(-0.01);
      expect(note.x + note.w! / 2, tag).toBeLessThanOrEqual(g.width + 0.01);
      expect(note.y + note.h! / 2, tag).toBeLessThanOrEqual(g.height + 0.01);
      // The leader is straight along the shared axis: both endpoints match on it.
      const leader = g.edges.find((e) => e.kind === "note")!;
      const nums = leader.path.match(/-?\d+(\.\d+)?/g)!.map(Number);
      const [x0, y0, x1, y1] = [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
      if (axis === "x") expect(Math.abs(x0 - x1), `${tag} vertical leader`).toBeLessThan(0.01);
      else expect(Math.abs(y0 - y1), `${tag} horizontal leader`).toBeLessThan(0.01);
    }
  });

  it("never clips a note — even a wide one on an extreme node, across sides/dirs/padding", () => {
    // Clamping guards the near edges (both axes); far-side growth guards the far
    // edges. This pins that they compose so a note box (and its leader) is ALWAYS
    // inside the reported viewBox, including the worst cases: a label far wider
    // than the graph, hung off the top/left-most or bottom/right-most node.
    const wide = "this annotation is deliberately far wider than the tiny graph it hangs off";
    const base: FlowGraph = {
      kind: "flow",
      nodes: [
        { id: "a", label: "A", shape: "box" },
        { id: "b", label: "B", shape: "box" },
        { id: "c", label: "C", shape: "box" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };
    for (const direction of ["TD", "LR"] as const) {
      for (const side of ["above", "below", "left", "right"] as const) {
        for (const target of ["a", "c"] as const) {
          for (const padding of [0, 24, 100]) {
            const g = layoutFlow(
              { ...base, notes: [{ target, side, label: wide }] },
              { direction, padding },
            );
            const note = g.nodes.find((n) => n.kind === "note")!;
            const tag = `${direction}/${side}/${target}/pad${padding}`;
            expect(note.x - note.w! / 2, tag).toBeGreaterThanOrEqual(-0.01);
            expect(note.y - note.h! / 2, tag).toBeGreaterThanOrEqual(-0.01);
            expect(note.x + note.w! / 2, tag).toBeLessThanOrEqual(g.width + 0.01);
            expect(note.y + note.h! / 2, tag).toBeLessThanOrEqual(g.height + 0.01);
          }
        }
      }
    }
  });
});
