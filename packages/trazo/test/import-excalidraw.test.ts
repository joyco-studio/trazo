import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { importExcalidraw, joycoTheme } from "../src/index.js";
import { Graph } from "../src/react/index.js";

const source = readFileSync(new URL("../../../examples/frame-buffer.excalidraw.json", import.meta.url), "utf8");

describe("importExcalidraw", () => {
  it("imports the reference drawing without deleted history or re-layout", () => {
    const graph = importExcalidraw(source);
    const drawing = graph.drawing!;
    const original = JSON.parse(source) as { elements: { id: string; isDeleted?: boolean }[] };
    expect(drawing.map((element) => element.id)).toEqual(
      original.elements.filter((element) => !element.isDeleted).map((element) => element.id),
    );
    expect(drawing).toHaveLength(25);
    expect(drawing.map((element) => element.kind).filter((kind) => kind === "rectangle")).toHaveLength(6);
    expect(drawing.map((element) => element.kind).filter((kind) => kind === "text")).toHaveLength(13);
    expect(drawing.map((element) => element.kind).filter((kind) => kind === "path")).toHaveLength(6);
    expect(drawing[0]).toMatchObject({ kind: "rectangle", role: "success" });
    expect(drawing[1]).toMatchObject({ kind: "text", text: "[1] decoded", role: "success", onRoleFill: true });
    expect(drawing[2]).toMatchObject({ kind: "rectangle", opacity: 0.5 });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);

    const rects = drawing.filter((element) => element.kind === "rectangle");
    expect(rects[0]!.x - rects[1]!.x).toBeCloseTo(180, 5);
    const horizontal = drawing.find((element) => element.id === "vyrBKS3GCZ4ItQHoHzEhp");
    expect(horizontal).toMatchObject({ kind: "path", arrowHead: "end", role: "info" });
    if (horizontal?.kind !== "path") throw new Error("reference arrow missing");
    expect(horizontal.points[1]!.x - horizontal.points[0]!.x).toBeCloseTo(160, 5);
    expect(horizontal.points[1]!.y).toBeCloseTo(horizontal.points[0]!.y, 5);
    const minX = Math.min(...drawing.flatMap((element) =>
      element.kind === "path" ? element.points.map((point) => point.x) : [element.x]));
    expect(minX).toBeCloseTo(24, 5);
  });

  it("renders deterministically and responds to Trazo theme tokens", () => {
    const graph = importExcalidraw(source);
    expect(importExcalidraw(source)).toEqual(graph);
    const render = (theme?: { tokens: { success: string }; textCase: "none" }) =>
      renderToStaticMarkup(createElement(Graph, { graph, title: "Buffer timeline", theme }));
    const original = render();
    expect(render()).toBe(original);
    expect(original.match(/data-slot="drawing-(?:rectangle|text|path)"/g)).toHaveLength(25);
    expect(original).toContain('marker-end="url(#trazo-arrow-role-info)"');
    expect(original).toContain("opacity=\"0.5\"");
    expect(original).toContain("this has been");

    const themed = render({ tokens: { success: "#123456" }, textCase: "none" });
    expect(themed).toContain("--trazo-success:#123456");
    expect(themed).not.toContain("text-transform:uppercase");
    expect(themed).toContain(`viewBox="0 0 ${graph.width} ${graph.height}"`);
    expect(graph).toEqual(importExcalidraw(source));

    const dark = renderToStaticMarkup(createElement(Graph, {
      graph,
      theme: {
        ...joycoTheme,
        textCase: "none",
        tokens: { canvas: "#202020", "canvas-hatch": "#303030", success: "#aaff00" },
      },
    }));
    expect(dark).toContain('data-slot="canvas"');
    expect(dark).toContain("--trazo-canvas:#202020");
    expect(dark).toContain("--trazo-canvas-hatch:#303030");
    expect(dark).toContain("fill=\"var(--trazo-success-foreground");
  });

  it("accepts parsed JSON and custom role mappings", () => {
    const parsed = JSON.parse(source) as { elements: unknown[] };
    const graph = importExcalidraw(parsed, { roleByColor: { "#2F9E44": "info" } });
    expect(graph.drawing?.[0]).toMatchObject({ role: "info" });
    expect(graph.drawing?.[1]).toMatchObject({ role: "info" });
  });

  it("names invalid and unsupported live elements", () => {
    const element = { id: "bad-one", type: "ellipse", x: 0, y: 0, width: 20, height: 20 };
    expect(() => importExcalidraw({ elements: [element] })).toThrow(/bad-one: unsupported type ellipse/);
    expect(() => importExcalidraw({ elements: [{ ...element, type: "rectangle", x: NaN }] }))
      .toThrow(/bad-one: invalid x/);
    expect(() => importExcalidraw({ elements: [{ ...element, type: "rectangle", angle: 1 }] }))
      .toThrow(/bad-one: rotation is unsupported/);
    expect(importExcalidraw({ elements: [{ ...element, isDeleted: true }] }).drawing).toEqual([]);
  });
});
