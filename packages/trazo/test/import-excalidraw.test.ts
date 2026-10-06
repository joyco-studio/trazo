import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { importExcalidraw, joycoTheme } from "../src/index.js";
import type { DrawingPrimitive } from "../src/index.js";
import { Graph } from "../src/react/index.js";

const source = readFileSync(new URL("../../../examples/frame-buffer.excalidraw", import.meta.url), "utf8");

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
    expect(horizontal.points[1]!.x - horizontal.points[0]!.x).toBeCloseTo(169.97444404331816, 5);
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
    expect(original).toMatch(/marker-end="url\(#trazo-arrow-[^" ]*role-info-1\)"/);
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

  it("places rectangle-bound connector ends on the box border", () => {
    const drawing = importExcalidraw(source).drawing!;
    const byId = new Map(drawing.map((element) => [element.id, element]));
    for (const [pathId, boxId, side] of [
      ["m-XX5tV6e9k6NwR8vNrpI", "29oXbK89tIH0kde1SdvYk", "bottom"],
      ["wifTg_mVkNH_JmXXmQjmt", "XY-owaTb42rzjvWB9-1Go", "bottom"],
      ["dxru3yrHp0UU4wXWX_NIz", "h_fUsRzWupWIAuhdmDdte", "bottom"],
      ["PFvDmtEd7-1KuB6TgE6rq", "uMzoaBGSggXG-ra_FbSYD", "top"],
    ] as const) {
      const path = byId.get(pathId);
      const box = byId.get(boxId);
      if (path?.kind !== "path" || box?.kind !== "rectangle") throw new Error("reference binding missing");
      expect(path.points[0]!.y).toBeCloseTo(side === "bottom" ? box.y + box.h : box.y, 5);
      expect(path.points[0]!.x).toBeCloseTo(box.x + box.w / 2, 1);
    }

    const endBound = importExcalidraw({ elements: [
      { id: "box", type: "rectangle", x: 20, y: 20, width: 100, height: 40 },
      { id: "arrow", type: "arrow", x: 70, y: 90, points: [[0, 0], [0, -23]],
        endArrowhead: "arrow", endBinding: { elementId: "box", fixedPoint: [0.5, 1] } },
    ] }).drawing!;
    const arrow = endBound[1];
    if (arrow?.kind !== "path") throw new Error("end-bound arrow missing");
    expect(arrow.points[1]).toEqual({ x: 74, y: 64 });
  });

  it("accepts parsed JSON and custom role mappings", () => {
    const parsed = JSON.parse(source) as { elements: unknown[] };
    const graph = importExcalidraw(parsed, { roleByColor: { "#2F9E44": "info" } });
    expect(graph.drawing?.[0]).toMatchObject({ role: "info" });
    expect(graph.drawing?.[1]).toMatchObject({ role: "info" });
  });

  it("rejects calculated overflow and impractically large canvases", () => {
    const box = { id: "large", type: "rectangle", x: 1e308, y: 0, width: 1e308, height: 20 };
    expect(() => importExcalidraw({ elements: [box] })).toThrow(/large: invalid calculated right edge/);
    expect(() => importExcalidraw({ elements: [{ ...box, x: 0, width: 32_768 }] }))
      .toThrow(/calculated canvas must be finite and at most 32768px/);
    expect(() => importExcalidraw({ elements: [
      { ...box, id: "left", x: -1e308, width: 1 },
      { ...box, id: "right", x: 1e308, width: 1 },
    ] })).toThrow(/calculated canvas must be finite/);
    expect(() => importExcalidraw({ elements: [
      { id: "line", type: "line", x: 1e308, y: 0, points: [[0, 0], [1e308, 0]] },
    ] })).toThrow(/line: invalid calculated point 1 x/);
  });

  it("rejects arrowhead shapes the renderer cannot preserve", () => {
    const arrow = { id: "special", type: "arrow", x: 0, y: 0, points: [[0, 0], [20, 0]] };
    expect(() => importExcalidraw({ elements: [{ ...arrow, startArrowhead: "circle" }] }))
      .toThrow(/special: unsupported startArrowhead circle/);
    expect(() => importExcalidraw({ elements: [{ ...arrow, endArrowhead: "bar" }] }))
      .toThrow(/special: unsupported endArrowhead bar/);
  });

  it("scopes markers per Graph and matches an imported arrow's opacity", () => {
    const graph = importExcalidraw({ elements: [
      { id: "faded", type: "arrow", x: 0, y: 0, points: [[0, 0], [100, 0]],
        strokeColor: "#1971c2", endArrowhead: "arrow", opacity: 50 },
    ] });
    const markup = renderToStaticMarkup(createElement("div", null,
      createElement(Graph, { graph, theme: { tokens: { info: "#ff0000" } } }),
      createElement(Graph, { graph, theme: { tokens: { info: "#00ff00" } } }),
    ));
    const svgSections = [...markup.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((match) => match[0]);
    expect(svgSections).toHaveLength(2);
    expect(svgSections[0]).toContain("--trazo-info:#ff0000");
    expect(svgSections[1]).toContain("--trazo-info:#00ff00");
    const ids = svgSections.map((svg) => {
      const id = svg.match(/<marker[^>]*id="([^"]+)"/)?.[1];
      expect(id).toBeDefined();
      expect(svg).toContain(`marker-end="url(#${id})"`);
      expect(svg).toContain('opacity="0.5" marker-end=');
      expect(svg).toMatch(/<marker[^>]*>[\s\S]*?<path[^>]*opacity="0.5"/);
      return id;
    });
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("preserves authored dashed and dotted rectangle borders", () => {
    const graph = importExcalidraw({ elements: [
      { id: "dash", type: "rectangle", x: 0, y: 0, width: 20, height: 20, strokeStyle: "dashed" },
      { id: "dot", type: "rectangle", x: 30, y: 0, width: 20, height: 20, strokeStyle: "dotted" },
    ] });
    const rectangles = graph.drawing!.filter((element): element is Extract<DrawingPrimitive, { kind: "rectangle" }> =>
      element.kind === "rectangle");
    expect(rectangles.map((rectangle) => rectangle.strokeStyle)).toEqual(["dashed", "dotted"]);
    const markup = renderToStaticMarkup(createElement(Graph, { graph }));
    expect(markup).toMatch(/data-slot="drawing-rectangle"[^>]*stroke-dasharray="6 4"/);
    expect(markup).toMatch(/data-slot="drawing-rectangle"[^>]*stroke-dasharray="1 5"/);
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
