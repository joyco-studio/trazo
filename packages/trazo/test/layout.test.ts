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
    expect(a?.x).toBe(10); // lane 0 → padding
    expect(a?.y).toBe(10); // row 0 → padding
    const b = g.nodes.find((n) => n.id === "C");
    expect(b?.y).toBe(110); // row 1 → padding + rowHeight
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
