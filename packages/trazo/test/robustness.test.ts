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
