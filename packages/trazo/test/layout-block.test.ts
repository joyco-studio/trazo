import { describe, it, expect } from "vitest";
import { layout, layoutBlock, parseBlock, block } from "../src/index.js";
import type { BlockGraph } from "../src/index.js";

const grid: BlockGraph = {
  kind: "block",
  columns: 2,
  cells: [
    { id: "nav", label: "Nav", span: 2 },
    { id: "a", label: "Sidebar" },
    { id: "b", label: "Content" },
  ],
};

describe("layoutBlock()", () => {
  it("is deterministic (repeat + clone)", () => {
    expect(layoutBlock(grid)).toEqual(layoutBlock(grid));
    const clone: BlockGraph = JSON.parse(JSON.stringify(grid));
    expect(layoutBlock(grid)).toEqual(layoutBlock(clone));
  });

  it("dispatches via layout() on kind === 'block'", () => {
    expect(layout(grid)).toEqual(layoutBlock(grid));
  });

  it("has no edges", () => {
    expect(layoutBlock(grid).edges).toHaveLength(0);
  });

  it("reports laneCount === columns", () => {
    expect(layoutBlock(grid).laneCount).toBe(2);
  });

  it("a span-2 cell is wider than a span-1 cell and wraps the next cells below", () => {
    const g = layoutBlock(grid);
    const nav = g.nodes.find((n) => n.id === "nav")!;
    const a = g.nodes.find((n) => n.id === "a")!;
    const b = g.nodes.find((n) => n.id === "b")!;
    expect(nav.w!).toBeGreaterThan(a.w!);
    // nav fills row 0; a and b sit on row 1 (below nav).
    expect(a.y).toBeGreaterThan(nav.y);
    expect(b.y).toBeCloseTo(a.y, 5);
    // a is left of b on the same row.
    expect(a.x).toBeLessThan(b.x);
  });

  it("wraps when cells exceed the column count", () => {
    const g = layoutBlock({
      kind: "block",
      columns: 2,
      cells: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
    });
    const y = (id: string) => g.nodes.find((n) => n.id === id)!.y;
    // a,b on row 0; c wraps to row 1.
    expect(y("a")).toBeCloseTo(y("b"), 5);
    expect(y("c")).toBeGreaterThan(y("a"));
  });

  it("sets positive bounds", () => {
    const g = layoutBlock(grid);
    expect(g.width).toBeGreaterThan(0);
    expect(g.height).toBeGreaterThan(0);
  });

  it("a label fits its cell even when span exceeds the column count", () => {
    // span 5 on a 2-column grid: sizing must use the CLAMPED span so the wide
    // label doesn't overflow the (2-column) cell box.
    const g = layoutBlock({
      kind: "block",
      columns: 2,
      cells: [{ id: "hero", label: "A VERY WIDE HERO LABEL HERE", span: 5 }],
    });
    const hero = g.nodes[0]!;
    expect(hero.labelWidth!).toBeLessThanOrEqual(hero.w!);
  });

  it("does not produce NaN geometry for a non-finite column count", () => {
    const g = layoutBlock({ kind: "block", columns: NaN as unknown as number, cells: [{ id: "a", label: "A" }] });
    expect(Number.isFinite(g.width)).toBe(true);
    expect(Number.isFinite(g.height)).toBe(true);
    expect(Number.isFinite(g.nodes[0]!.x)).toBe(true);
  });
});

describe("parseBlock()", () => {
  it("parses columns and cells with spans", () => {
    const { graph, error } = parseBlock('columns 2\nA["Nav"] :2\nB["Side"]');
    expect(error).toBeNull();
    expect(graph.columns).toBe(2);
    expect(graph.cells[0]).toMatchObject({ id: "A", label: "Nav", span: 2 });
    expect(graph.cells[1]).toMatchObject({ id: "B", label: "Side" });
  });

  it("ignores a bare `block` header", () => {
    expect(parseBlock("block\ncolumns 1\nA").error).toBeNull();
  });

  it("errors on an unparseable line", () => {
    const { error } = parseBlock("columns 2\n??? bad");
    expect(error?.line).toBe(2);
  });

  it("block template throws on error and returns a graph on success", () => {
    expect(() => block`??? nope`).toThrow(/block DSL/i);
    expect(block`columns 1\nA["x"]`.cells).toHaveLength(1);
  });
});
