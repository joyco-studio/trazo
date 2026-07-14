import { describe, it, expect } from "vitest";
import { layout } from "../src/index.js";
import type { CommitGraph } from "../src/index.js";

/**
 * Fixture DAG with a branch and a merge (commits newest-first, child before
 * parent):
 *
 *   E (merge of C and D)
 *   ├─ C  (main)        D (feat)
 *   │                   │
 *   └─ B  (main) ───────┘  (D's parent is B → the branch-out point)
 *      │
 *      A  (root)
 *
 * Topology:
 *   E.parents = [C, D]   (merge; first parent C = mainline)
 *   C.parents = [B]
 *   D.parents = [B]      (feat branched off B)
 *   B.parents = [A]
 *   A.parents = []       (root)
 */
const fixture: CommitGraph = {
  commits: [
    { id: "E", parents: ["C", "D"], branch: "main", message: "Merge feat" },
    { id: "C", parents: ["B"], branch: "main", message: "Work on main" },
    { id: "D", parents: ["B"], branch: "feat", message: "Work on feat" },
    { id: "B", parents: ["A"], branch: "main", message: "Second commit" },
    { id: "A", parents: [], branch: "main", message: "Initial commit" },
  ],
  refs: { main: "E", feat: "D", HEAD: "E" },
};

describe("layout()", () => {
  it("is deterministic: equal input → deeply equal output", () => {
    const a = layout(fixture);
    const b = layout(fixture);
    expect(a).toEqual(b);
  });

  it("is deterministic across two independently-constructed equal inputs", () => {
    const clone: CommitGraph = JSON.parse(JSON.stringify(fixture));
    expect(layout(fixture)).toEqual(layout(clone));
  });

  it("assigns the mainline (A→B→C→E) to lane 0", () => {
    const { nodes } = layout(fixture);
    const lane = (id: string) => nodes.find((n) => n.id === id)?.lane;
    expect(lane("A")).toBe(0);
    expect(lane("B")).toBe(0);
    expect(lane("C")).toBe(0);
    expect(lane("E")).toBe(0);
  });

  it("places the feature branch (D) on a separate lane", () => {
    const { nodes, laneCount } = layout(fixture);
    const d = nodes.find((n) => n.id === "D");
    expect(d).toBeDefined();
    expect(d?.lane).toBeGreaterThan(0);
    expect(laneCount).toBeGreaterThanOrEqual(2);
  });

  it("emits a merge edge for the merge commit's non-mainline parent", () => {
    const { edges } = layout(fixture);
    const mergeEdges = edges.filter((e) => e.kind === "merge");
    expect(mergeEdges.length).toBeGreaterThanOrEqual(1);
    // E merges in D (its second parent).
    expect(mergeEdges.some((e) => e.from === "E" && e.to === "D")).toBe(true);
  });

  it("emits a branch edge where the feature branch leaves the mainline", () => {
    const { edges } = layout(fixture);
    // D → B changes lane (D is off-mainline), so it reads as a branch edge.
    const dToB = edges.find((e) => e.from === "D" && e.to === "B");
    expect(dToB).toBeDefined();
    expect(dToB?.kind).toBe("branch");
  });

  it("produces one node per commit and edges only for in-graph parents", () => {
    const { nodes, edges } = layout(fixture);
    expect(nodes).toHaveLength(5);
    // Edges: E→C, E→D, C→B, D→B, B→A = 5.
    expect(edges).toHaveLength(5);
  });

  it("token color keys are lane-derived, not literal colors", () => {
    const { nodes } = layout(fixture);
    for (const n of nodes) {
      expect(n.color).toBe(`lane-${n.lane}`);
      expect(n.color).not.toMatch(/^#|rgb|hsl/);
    }
  });

  it("every edge path is a valid SVG d string (M …)", () => {
    const { edges } = layout(fixture);
    for (const e of edges) {
      expect(e.path).toMatch(/^M /);
    }
  });

  it("places child rows above their parents (child y < parent y)", () => {
    const { nodes } = layout(fixture);
    const y = (id: string) => nodes.find((n) => n.id === id)?.y ?? 0;
    expect(y("E")).toBeLessThan(y("C"));
    expect(y("C")).toBeLessThan(y("B"));
    expect(y("B")).toBeLessThan(y("A"));
  });

  it("respects spacing options in resolved coordinates", () => {
    const g = layout(fixture, {
      laneWidth: 50,
      rowHeight: 100,
      padding: 10,
    });
    const a = g.nodes.find((n) => n.id === "E");
    const b = g.nodes.find((n) => n.id === "C");
    expect(a?.x).toBe(10); // lane 0 → padding
    expect(a?.y).toBe(10); // row 0 → padding (vertical charts reserve no band)
    expect(b?.y).toBe(110); // row 1 → padding + rowHeight
    // Both mainline commits share lane 0's x.
    expect(b?.x).toBe(10);
  });

  it("sets viewBox bounds and laneCount", () => {
    const g = layout(fixture);
    expect(g.width).toBeGreaterThan(0);
    expect(g.height).toBeGreaterThan(0);
    expect(g.laneCount).toBeGreaterThanOrEqual(2);
  });

  it("lays out a graph with no branch hints", () => {
    const linear: CommitGraph = {
      commits: [
        { id: "z", parents: ["y"] },
        { id: "y", parents: ["x"] },
        { id: "x", parents: [] },
      ],
    };
    const g = layout(linear);
    expect(g.laneCount).toBe(1);
    expect(g.nodes.every((n) => n.lane === 0)).toBe(true);
    // No messages → no labelWidth.
    expect(g.nodes.every((n) => n.labelWidth === undefined)).toBe(true);
    // No branch names → legacy compaction, no branch-lane labels emitted.
    expect(g.laneLabels).toBeUndefined();
  });

  it("assigns one dedicated lane per branch (no reuse across branches)", () => {
    const g = layout(fixture);
    // main → lane 0, feat → lane 1 (first-appearance order, newest-first walk).
    // Every commit lands in its own branch's lane.
    const laneOf = (id: string) => g.nodes.find((n) => n.id === id)?.lane;
    expect(laneOf("A")).toBe(0);
    expect(laneOf("B")).toBe(0);
    expect(laneOf("C")).toBe(0);
    expect(laneOf("E")).toBe(0);
    expect(laneOf("D")).toBe(1);
    expect(g.laneCount).toBe(2);
    // Vertical charts emit NO lane labels (narrow columns can't hold the wide
    // horizontal names — the per-lane color disambiguates instead).
    expect(g.laneLabels).toBeUndefined();
  });

  it("horizontal git chart puts branch lane labels in the left gutter", () => {
    const g = layout(fixture, { orientation: "horizontal" });
    expect(g.laneLabels).toBeDefined();
    expect(g.laneLabels!.map((l) => l.branch)).toEqual(["main", "feat"]);
    expect(g.laneLabels!.every((l) => l.align === "start")).toBe(true);
    // All tags share the same small x (the reserved left gutter).
    const xs = new Set(g.laneLabels!.map((l) => l.x));
    expect(xs.size).toBe(1);
    // Each tag is vertically centered on its lane's row (matches a node there).
    for (const l of g.laneLabels!) {
      const onLane = g.nodes.find((n) => n.lane === l.lane);
      expect(l.y).toBe(onLane?.y);
    }
  });

  it("populates labelWidth via measure() when a message is present", () => {
    const { nodes } = layout(fixture);
    const e = nodes.find((n) => n.id === "E");
    expect(e?.message).toBe("Merge feat");
    expect(e?.labelWidth).toBeGreaterThan(0);
  });

  it("reserves graph width for the rightmost label (no crop)", () => {
    // Regression: width used to ignore labelWidth, cropping labels that render
    // to the right of the node. Every label's right edge must fit in width.
    const g = layout(fixture);
    for (const n of g.nodes) {
      if (n.labelWidth === undefined) continue;
      const labelRight = n.x + n.labelWidth; // conservative: ignores gap/half
      expect(labelRight).toBeLessThanOrEqual(g.width);
    }
    // A long message must widen the graph beyond the bare lane extent.
    const long = layout({
      commits: [
        { id: "a", parents: [], branch: "main", message: "x" },
        {
          id: "b",
          parents: ["a"],
          branch: "main",
          message: "a considerably longer commit subject line here",
        },
      ],
    });
    const short = layout({
      commits: [
        { id: "a", parents: [], branch: "main", message: "x" },
        { id: "b", parents: ["a"], branch: "main", message: "y" },
      ],
    });
    expect(long.width).toBeGreaterThan(short.width);
  });
});

describe("git orientation + labelSide", () => {
  const idX = (g: ReturnType<typeof layout>, id: string) =>
    g.nodes.find((n) => n.id === id)?.x ?? 0;
  const idY = (g: ReturnType<typeof layout>, id: string) =>
    g.nodes.find((n) => n.id === id)?.y ?? 0;

  it("vertical (default) flows commits down the y-axis", () => {
    const g = layout(fixture);
    // Child above parent on y, same lane shares an x.
    expect(idY(g, "E")).toBeLessThan(idY(g, "C"));
    expect(idX(g, "E")).toBe(idX(g, "C")); // both lane 0
  });

  it("horizontal flows commits along the x-axis, lanes stack on y", () => {
    const g = layout(fixture, { orientation: "horizontal" });
    // Child before parent on x now, same lane shares a y.
    expect(idX(g, "E")).toBeLessThan(idX(g, "C"));
    expect(idY(g, "E")).toBe(idY(g, "C")); // both lane 0
  });

  it("vertical labelSide:right puts the badge to the right of the square", () => {
    const g = layout(fixture, { labelSide: "right" });
    const e = g.nodes.find((n) => n.id === "E");
    expect(e?.labelAnchor?.x).toBeGreaterThan(e!.x);
  });

  it("vertical labelSide:left puts the badge to the left and reserves room", () => {
    const g = layout(fixture, { labelSide: "left" });
    const e = g.nodes.find((n) => n.id === "E");
    // Badge sits left of the square…
    expect(e?.labelAnchor?.x).toBeLessThan(e!.x);
    // …and the whole badge still fits on-canvas (no negative coords).
    for (const n of g.nodes) {
      if (n.labelAnchor === undefined) continue;
      expect(n.labelAnchor.x).toBeGreaterThanOrEqual(0);
    }
  });

  it("horizontal labelSide:right places the badge below, left places it above", () => {
    const below = layout(fixture, { orientation: "horizontal", labelSide: "right" });
    const above = layout(fixture, { orientation: "horizontal", labelSide: "left" });
    const eBelow = below.nodes.find((n) => n.id === "E");
    const eAbove = above.nodes.find((n) => n.id === "E");
    expect(eBelow?.labelAnchor?.y).toBeGreaterThan(eBelow!.y);
    expect(eAbove?.labelAnchor?.y).toBeLessThan(eAbove!.y);
    for (const n of above.nodes) {
      if (n.labelAnchor === undefined) continue;
      expect(n.labelAnchor.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("stays deterministic for the new options", () => {
    const opts = { orientation: "horizontal" as const, labelSide: "left" as const };
    expect(layout(fixture, opts)).toEqual(layout(fixture, opts));
  });

  it("positions free-form notes below the graph", () => {
    const withNote: CommitGraph = {
      ...fixture,
      notes: [{ text: "S = squash of feat" }],
    };
    const g = layout(withNote);
    expect(g.gitNotes).toBeDefined();
    expect(g.gitNotes).toHaveLength(1);
    const note = g.gitNotes![0]!;
    expect(note.text).toBe("S = squash of feat");
    const lowestCommit = Math.max(...g.nodes.map((n) => n.y));
    expect(note.y).toBeGreaterThan(lowestCommit);
    expect(note.y).toBeLessThanOrEqual(g.height);
  });

  it("positions a commit-range bracket over its members", () => {
    const withGroup: CommitGraph = {
      ...fixture,
      commitGroups: [{ label: "main work", from: "C", to: "B" }],
    };
    const g = layout(withGroup, { orientation: "horizontal" });
    expect(g.commitBrackets).toBeDefined();
    expect(g.commitBrackets).toHaveLength(1);
    const br = g.commitBrackets![0]!;
    expect(br.label).toBe("main work");
    // Horizontal chart: bracket is a horizontal line (y1 === y2).
    expect(br.y1).toBe(br.y2);
    const cNode = g.nodes.find((n) => n.id === "C")!;
    const bNode = g.nodes.find((n) => n.id === "B")!;
    const lo = Math.min(cNode.x, bNode.x);
    const hi = Math.max(cNode.x, bNode.x);
    expect(br.x1).toBe(lo);
    expect(br.x2).toBe(hi);
    expect(br.labelX).toBe((lo + hi) / 2);
    expect(br.labelY).toBeLessThanOrEqual(g.height);
  });

  it("omits notes and brackets when the input declares none", () => {
    const g = layout(fixture);
    expect(g.gitNotes).toBeUndefined();
    expect(g.commitBrackets).toBeUndefined();
  });
});
