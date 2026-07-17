import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { layoutFlow } from "../src/index.js";
import type { FlowGraph } from "../src/index.js";
import { Graph } from "../src/react/index.js";

function render(graph: FlowGraph): string {
  return renderToStaticMarkup(createElement(Graph, { graph: layoutFlow(graph) }));
}

/** A two-node subgraph with a `:success` tint and one edge, so the render emits
 * a group fill, an edges pass and a group frame — the three order-dependent
 * slots this suite pins. */
const tinted: FlowGraph = {
  kind: "flow",
  nodes: [
    { id: "A", label: "A", shape: "box", group: "G" },
    { id: "B", label: "B", shape: "box", group: "G" },
  ],
  edges: [{ from: "A", to: "B" }],
  groups: [{ id: "G", label: "Group", role: "success" }],
};

/** Same shape, but the subgraph has no `:role` — the default transparent box. */
const plain: FlowGraph = {
  kind: "flow",
  nodes: [
    { id: "A", label: "A", shape: "box", group: "G" },
    { id: "B", label: "B", shape: "box", group: "G" },
  ],
  edges: [{ from: "A", to: "B" }],
  groups: [{ id: "G", label: "Group" }],
};

describe("<Graph> subgraph background tint", () => {
  it("fills a role'd subgraph with the role color at low opacity", () => {
    const html = render(tinted);
    expect(html).toContain('data-slot="group-fill"');
    // The fill rect carries the `success` token chain…
    expect(html).toMatch(/data-slot="group-fill"[^>]*--trazo-success/);
    // …at the low group opacity.
    expect(html).toContain('fill-opacity="0.14"');
  });

  it("draws the subgraph border in the same role color", () => {
    const html = render(tinted);
    // The frame (border + title) lives in the late `data-slot="groups"` pass;
    // slicing from there skips the earlier fill rect so the match is the border.
    const frame = html.slice(html.indexOf('data-slot="groups"'));
    expect(frame).toMatch(/stroke="var\(--trazo-success/);
  });

  it("keeps a roleless subgraph transparent with a neutral outline", () => {
    const html = render(plain);
    // No fill pass at all for a transparent subgraph…
    expect(html).not.toContain('data-slot="group-fill"');
    expect(html).not.toContain('fill-opacity="0.14"');
    // …and the border falls back to the neutral muted-foreground gray.
    const frame = html.slice(html.indexOf('data-slot="groups"'));
    expect(frame).toMatch(/stroke="var\(--trazo-muted-foreground/);
  });
});

describe("<Graph> member-node border tint", () => {
  it("washes a member node's border with the group role so no seam ring shows", () => {
    const html = render(tinted);
    // Each member node emits a decorative tint overlay in the role color…
    expect(html).toContain('data-slot="node-border-tint"');
    expect(html).toMatch(/data-slot="node-border-tint"[^>]*stroke="var\(--trazo-success/);
    // …at the same low wash as the group fill (BG + wash = the tinted backdrop).
    expect(html).toMatch(/data-slot="node-border-tint"[^>]*stroke-opacity="0.14"/);
    // The overlay is decorative-only — no fill so the solid node body shows through.
    expect(html).toMatch(/data-slot="node-border-tint"[^>]*fill="none"/);
  });

  it("emits no tint overlay for a roleless subgraph's members", () => {
    expect(render(plain)).not.toContain('data-slot="node-border-tint"');
  });

  it("paints the tint overlay after the solid node so it lands on the border band", () => {
    const html = render(tinted);
    const node = html.indexOf('data-slot="node"');
    const tint = html.indexOf('data-slot="node-border-tint"');
    expect(node).toBeGreaterThanOrEqual(0);
    expect(tint).toBeGreaterThan(node);
  });
});

describe("<Graph> subgraph paint order", () => {
  // The whole point of the two-pass split: the tint fill must sit BEHIND the
  // lanes while the border + title sit ON TOP of them, so connector lanes
  // entering a subgraph never cross over its outline or title. In SVG paint
  // order IS document order, so we assert the slots appear fill → edges → frame.
  it("paints the fill before the lanes and the frame after them", () => {
    const html = render(tinted);
    const fill = html.indexOf('data-slot="group-fill"');
    const edges = html.indexOf('data-slot="edges"');
    const frame = html.indexOf('data-slot="groups"');
    expect(fill).toBeGreaterThanOrEqual(0);
    expect(edges).toBeGreaterThan(fill);
    expect(frame).toBeGreaterThan(edges);
  });
});
