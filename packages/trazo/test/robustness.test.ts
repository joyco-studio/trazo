import { describe, it, expect } from "vitest";
import { layoutFlow, layoutGit } from "../src/index.js";
import type {
  CommitGraph,
  FlowGraph,
  PositionedGraph,
} from "../src/index.js";

/**
 * Structural robustness suite: every case a user can plausibly type must
 * produce a sane PositionedGraph — no crash, no NaN, no node overlap, nothing
 * outside the canvas, and byte-identical output across runs (determinism).
 * Born from the stakeholder requirement that flow/git diagrams stay
 * predictable on edge cases (cycles, self-loops, long text, dense graphs).
 */

const flow = (
  nodes: FlowGraph["nodes"],
  edges: FlowGraph["edges"],
): FlowGraph => ({ kind: "flow", nodes, edges });

const git = (
  commits: CommitGraph["commits"],
  refs?: CommitGraph["refs"],
): CommitGraph => (refs === undefined ? { commits } : { commits, refs });

function expectSane(g: PositionedGraph): void {
  expect(Number.isFinite(g.width)).toBe(true);
  expect(Number.isFinite(g.height)).toBe(true);

  for (const n of g.nodes) {
    expect(Number.isFinite(n.x), `node ${n.id} x`).toBe(true);
    expect(Number.isFinite(n.y), `node ${n.id} y`).toBe(true);
  }
  for (const e of g.edges) {
    expect(e.path, `edge ${e.from}->${e.to} path`).toBeTruthy();
    expect(e.path.includes("NaN"), `edge ${e.from}->${e.to} NaN`).toBe(false);
    expect(e.path.includes("Infinity")).toBe(false);
  }

  // No two node boxes may intersect.
  const rects = g.nodes.map((n) => {
    const w = n.w ?? 12;
    const h = n.h ?? 12;
    return {
      id: n.id,
      x0: n.x - w / 2,
      x1: n.x + w / 2,
      y0: n.y - h / 2,
      y1: n.y + h / 2,
    };
  });
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!;
      const b = rects[j]!;
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      expect(ox > 0.5 && oy > 0.5, `overlap ${a.id} <-> ${b.id}`).toBe(false);
    }
  }

  // Every node box stays inside the canvas.
  for (const r of rects) {
    expect(r.x0 >= -0.5 && r.y0 >= -0.5, `${r.id} before origin`).toBe(true);
    expect(
      r.x1 <= g.width + 0.5 && r.y1 <= g.height + 0.5,
      `${r.id} past canvas`,
    ).toBe(true);
  }

  // Edge label badges stay inside the canvas too (the A2 contract fix).
  for (const e of g.edges) {
    if (e.labelPoint === undefined || e.labelWidth === undefined) continue;
    const halfW = e.labelWidth / 2;
    expect(e.labelPoint.x - halfW >= -0.5, `label ${e.from}->${e.to} left`).toBe(true);
    expect(
      e.labelPoint.x + halfW <= g.width + 0.5,
      `label ${e.from}->${e.to} right`,
    ).toBe(true);
  }
}

function expectDeterministic(fn: () => PositionedGraph): PositionedGraph {
  const a = fn();
  const b = fn();
  expect(a).toEqual(b);
  return a;
}

/** Liang-Barsky segment-vs-rect: does p→q pass through the rect's interior? */
function segmentCrossesRect(
  p: { x: number; y: number },
  q: { x: number; y: number },
  r: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const clips: Array<[number, number]> = [
    [-dx, p.x - r.x0],
    [dx, r.x1 - p.x],
    [-dy, p.y - r.y0],
    [dy, r.y1 - p.y],
  ];
  for (const [den, num] of clips) {
    if (den === 0) {
      if (num < 0) return false;
      continue;
    }
    const t = num / den;
    if (den < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return t1 > t0;
}

/**
 * No edge segment may pass through a node's box interior (its own endpoints'
 * boxes excluded — edges legitimately touch those faces). Rects are shrunk 1px
 * so face-touching approaches don't false-positive. elbow45/orthogonal paths
 * are pure M/L polylines, so the `d` numbers pair up into vertices.
 */
function expectEdgesClearOfNodes(g: PositionedGraph): void {
  for (const e of g.edges) {
    const nums = (e.path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pts.push({ x: nums[i] as number, y: nums[i + 1] as number });
    }
    for (const n of g.nodes) {
      if (n.id === e.from || n.id === e.to) continue;
      const w = n.w ?? 12;
      const h = n.h ?? 12;
      const rect = {
        x0: n.x - w / 2 + 1,
        y0: n.y - h / 2 + 1,
        x1: n.x + w / 2 - 1,
        y1: n.y + h / 2 - 1,
      };
      for (let i = 1; i < pts.length; i++) {
        expect(
          segmentCrossesRect(pts[i - 1]!, pts[i]!, rect),
          `edge ${e.from}->${e.to} segment ${i} crosses node ${n.id}`,
        ).toBe(false);
      }
    }
  }
}

describe("flow robustness", () => {
  it("routes a self-loop instead of dropping it", () => {
    const g = expectDeterministic(() =>
      layoutFlow(flow([{ id: "a", label: "Retry" }], [{ from: "a", to: "a" }])),
    );
    expectSane(g);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.path).toBeTruthy();
  });

  it("places a self-loop label on the corridor", () => {
    const g = layoutFlow(
      flow(
        [{ id: "a", label: "Retry" }, { id: "b", label: "Done" }],
        [{ from: "a", to: "a", label: "on failure" }, { from: "a", to: "b" }],
      ),
    );
    expectSane(g);
    const loop = g.edges.find((e) => e.from === "a" && e.to === "a")!;
    expect(loop.labelPoint).toBeDefined();
    expect(loop.labelWidth).toBeGreaterThan(0);
  });

  it("nests multiple self-loops on one node without colliding", () => {
    const g = layoutFlow(
      flow(
        [{ id: "a", label: "Node" }, { id: "s", label: "Sibling" }],
        [
          { from: "a", to: "a" },
          { from: "a", to: "a" },
        ],
      ),
    );
    expectSane(g);
    expect(g.edges).toHaveLength(2);
    expect(g.edges[0]!.path).not.toEqual(g.edges[1]!.path);
  });

  it("keeps a rank sibling clear of a self-loop corridor", () => {
    // Both nodes are sources → same rank; the loop corridor on `a` must not
    // run through `b`'s box.
    const g = layoutFlow(
      flow(
        [{ id: "a", label: "Loops" }, { id: "b", label: "Neighbor" }],
        [{ from: "a", to: "a" }],
      ),
    );
    expectSane(g);
  });

  it("wraps a long node label under maxNodeWidth", () => {
    const label =
      "This is an extremely long node label that keeps going and going and should wrap";
    const g = expectDeterministic(() =>
      layoutFlow(flow([{ id: "a", label }, { id: "b" }], [{ from: "a", to: "b" }]), {
        maxNodeWidth: 260,
      }),
    );
    expectSane(g);
    const a = g.nodes.find((n) => n.id === "a")!;
    expect(a.w!).toBeLessThanOrEqual(260 + 0.5);
    expect(a.label).toContain("\n");
    // Unwrapped for comparison: far wider than the budget.
    const wide = layoutFlow(
      flow([{ id: "a", label }, { id: "b" }], [{ from: "a", to: "b" }]),
    );
    expect(wide.nodes.find((n) => n.id === "a")!.w!).toBeGreaterThan(400);
  });

  it("keeps a single over-budget word whole when wrapping", () => {
    const g = layoutFlow(
      flow(
        [{ id: "a", label: "Supercalifragilisticexpialidocious-configuration-manager" }],
        [],
      ),
      { maxNodeWidth: 120 },
    );
    expectSane(g);
    expect(g.nodes[0]!.label).not.toContain("\n");
  });

  it("contains a long edge label inside the canvas", () => {
    const g = expectDeterministic(() =>
      layoutFlow(
        flow(
          [{ id: "a" }, { id: "b" }],
          [
            {
              from: "a",
              to: "b",
              label:
                "a very very very long edge label describing the transition in detail",
            },
          ],
        ),
      ),
    );
    expectSane(g);
  });

  it("handles cycles (2-cycle, triangle, cycle with tail)", () => {
    expectSane(
      expectDeterministic(() =>
        layoutFlow(
          flow(
            [{ id: "a" }, { id: "b" }],
            [{ from: "a", to: "b" }, { from: "b", to: "a" }],
          ),
        ),
      ),
    );
    expectSane(
      layoutFlow(
        flow(
          [{ id: "a" }, { id: "b" }, { id: "c" }],
          [
            { from: "a", to: "b" },
            { from: "b", to: "c" },
            { from: "c", to: "a" },
          ],
        ),
      ),
    );
    expectSane(
      layoutFlow(
        flow(
          [{ id: "s" }, { id: "a" }, { id: "b" }, { id: "c" }, { id: "t" }],
          [
            { from: "s", to: "a" },
            { from: "a", to: "b" },
            { from: "b", to: "c" },
            { from: "c", to: "a" },
            { from: "c", to: "t" },
          ],
        ),
      ),
    );
  });

  it("keeps every edge clear of unrelated node boxes (torture case)", () => {
    // Cycles + a wide middle node + a self-loop + a skip edge: back-edge
    // corridors must clear the WIDE box, long edges must pass ranks through
    // their reserved dummy columns, and nothing may slice a box interior.
    const g = layoutFlow(
      flow(
        [
          { id: "a", label: "Start" },
          { id: "b", label: "Process with a very long label that keeps going and going" },
          { id: "c", label: "Retry?", shape: "diamond" },
          { id: "d", label: "Done" },
        ],
        [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "c", to: "b" },
          { from: "c", to: "a" },
          { from: "b", to: "b" },
          { from: "c", to: "d" },
        ],
      ),
      { maxNodeWidth: 260 },
    );
    expectSane(g);
    expectEdgesClearOfNodes(g);
  });

  it("keeps long-edge rank pass-throughs clear of siblings (dense case)", () => {
    const g = layoutFlow(
      flow(
        [
          { id: "a", label: "Gateway" },
          { id: "b", label: "Auth" },
          { id: "c", label: "Cart" },
          { id: "f", label: "Session" },
          { id: "h", label: "Response" },
        ],
        [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
          { from: "b", to: "f" },
          { from: "c", to: "f" },
          { from: "f", to: "h" },
          { from: "b", to: "h" },
        ],
      ),
    );
    expectSane(g);
    expectEdgesClearOfNodes(g);
  });

  it("centers a root over its fan-out and children under parents", () => {
    const g = layoutFlow(
      flow(
        [
          { id: "root", label: "Root" },
          { id: "l", label: "Left" },
          { id: "m", label: "Mid" },
          { id: "r", label: "Right" },
          { id: "child", label: "Child" },
        ],
        [
          { from: "root", to: "l" },
          { from: "root", to: "m" },
          { from: "root", to: "r" },
          { from: "m", to: "child" },
        ],
      ),
    );
    const at = (id: string) => g.nodes.find((n) => n.id === id)!;
    // Root sits on the median of its three children; the lone child under its parent.
    expect(at("root").x).toBeCloseTo(at("m").x, 5);
    expect(at("child").x).toBeCloseTo(at("m").x, 5);
  });

  it("anchors cylinder entries at the cap apex (the box edge)", () => {
    const g = layoutFlow(
      flow(
        [{ id: "a", label: "A" }, { id: "cyl", label: "DB", shape: "cylinder" }],
        [{ from: "a", to: "cyl" }],
      ),
    );
    const cyl = g.nodes.find((n) => n.id === "cyl")!;
    const nums = (g.edges[0]!.path.match(/-?\d+(?:\.\d+)?/g) as string[]).map(Number);
    const endY = nums[nums.length - 1]!;
    expect(endY).toBeCloseTo(cyl.y - cyl.h! / 2, 5);
  });

  it("handles a 100-node chain", () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      id: `n${i}`,
      label: `Step ${i}`,
    }));
    const edges = Array.from({ length: 99 }, (_, i) => ({
      from: `n${i}`,
      to: `n${i + 1}`,
    }));
    expectSane(expectDeterministic(() => layoutFlow(flow(nodes, edges))));
  });

  it("handles a 30-way fan-out", () => {
    const nodes = [
      { id: "root", label: "Root" },
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `c${i}`,
        label: `Child ${i}`,
      })),
    ];
    const edges = Array.from({ length: 30 }, (_, i) => ({
      from: "root",
      to: `c${i}`,
    }));
    expectSane(layoutFlow(flow(nodes, edges)));
  });

  it("handles a dense 10x10 bipartite graph", () => {
    const nodes = [
      ...Array.from({ length: 10 }, (_, i) => ({ id: `a${i}` })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `b${i}` })),
    ];
    const edges: FlowGraph["edges"] = [];
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) edges.push({ from: `a${i}`, to: `b${j}` });
    }
    expectSane(expectDeterministic(() => layoutFlow(flow(nodes, edges))));
  });

  it("handles duplicate edges, disconnected components, isolated and empty", () => {
    expectSane(
      layoutFlow(
        flow(
          [{ id: "a" }, { id: "b" }],
          [
            { from: "a", to: "b" },
            { from: "a", to: "b" },
          ],
        ),
      ),
    );
    expectSane(
      layoutFlow(
        flow(
          [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
          [
            { from: "a", to: "b" },
            { from: "c", to: "d" },
          ],
        ),
      ),
    );
    expectSane(layoutFlow(flow([{ id: "a" }, { id: "b" }, { id: "c" }], [])));
    expectSane(layoutFlow(flow([], [])));
  });

  it("handles LR direction with cycles and self-loops", () => {
    expectSane(
      layoutFlow(
        {
          kind: "flow",
          nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
          edges: [
            { from: "a", to: "b" },
            { from: "b", to: "c" },
            { from: "c", to: "a" },
          ],
        },
        { direction: "LR" },
      ),
    );
    const loop = layoutFlow(
      {
        kind: "flow",
        nodes: [{ id: "a", label: "Loop" }],
        edges: [{ from: "a", to: "a" }],
      },
      { direction: "LR" },
    );
    expectSane(loop);
    expect(loop.edges).toHaveLength(1);
  });
});

describe("git robustness", () => {
  it("truncates a long commit message under maxLabelWidth", () => {
    const commits = [
      {
        id: "a",
        parents: [],
        hash: "abc1234",
        author: "Ana",
        message:
          "an extremely long commit subject line that would definitely overflow any badge width",
      },
    ];
    const capped = layoutGit(git(commits), { maxLabelWidth: 300 });
    const free = layoutGit(git(commits));
    const cappedNode = capped.nodes[0]!;
    expect(cappedNode.message!.endsWith("…")).toBe(true);
    expect(cappedNode.hash).toBe("abc1234");
    expect(cappedNode.author).toBe("Ana");
    expect(cappedNode.labelWidth!).toBeLessThanOrEqual(300);
    expect(free.nodes[0]!.labelWidth!).toBeGreaterThan(300);
    expect(capped.width).toBeLessThan(free.width);
    expectSane(capped);
    // Determinism with the option on.
    expect(layoutGit(git(commits), { maxLabelWidth: 300 })).toEqual(capped);
  });

  it("handles a 100-commit linear history", () => {
    const commits = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      parents: i ? [`c${i - 1}`] : [],
      message: `commit ${i}`,
    }));
    expectSane(expectDeterministic(() => layoutGit(git(commits))));
  });

  it("handles an octopus merge", () => {
    expectSane(
      layoutGit(
        git([
          { id: "a", parents: [] },
          { id: "b", parents: ["a"] },
          { id: "c", parents: ["a"] },
          { id: "d", parents: ["a"] },
          { id: "m", parents: ["b", "c", "d"], message: "octopus" },
        ]),
      ),
    );
  });

  it("handles 12 parallel branches", () => {
    const commits: CommitGraph["commits"] = [{ id: "root", parents: [] }];
    for (let b = 0; b < 12; b++) {
      commits.push({ id: `b${b}-1`, parents: ["root"], branch: `branch-${b}` });
      commits.push({
        id: `b${b}-2`,
        parents: [`b${b}-1`],
        branch: `branch-${b}`,
      });
    }
    expectSane(expectDeterministic(() => layoutGit(git(commits))));
  });

  it("aligns every badge to a shared gutter column past the last lane", () => {
    const commits: CommitGraph["commits"] = [
      { id: "a", parents: [], message: "root" },
      { id: "b", parents: ["a"], branch: "feat", message: "feat work" },
      { id: "c", parents: ["a"], message: "main work" },
      { id: "m", parents: ["c", "b"], message: "merge" },
    ];
    const g = layoutGit(git(commits));
    const anchors = g.nodes
      .filter((n) => n.labelAnchor !== undefined)
      .map((n) => n.labelAnchor!.x);
    expect(anchors.length).toBeGreaterThan(0);
    // git-log style: one message column — every badge starts at the same x.
    for (const x of anchors) expect(x).toBeCloseTo(anchors[0]!, 5);
  });

  it("survives missing parents, duplicate ids, and empty input", () => {
    expectSane(
      layoutGit(git([{ id: "a", parents: ["ghost"] }, { id: "b", parents: ["a"] }])),
    );
    expectSane(
      layoutGit(git([{ id: "a", parents: [] }, { id: "a", parents: [] }])),
    );
    expectSane(layoutGit(git([])));
  });
});
