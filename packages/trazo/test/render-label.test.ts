import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { joycoTheme, layoutFlow } from "../src/index.js";
import type { FlowGraph, TrazoTheme } from "../src/index.js";
import { Graph } from "../src/react/index.js";

function render(graph: FlowGraph, theme?: TrazoTheme): string {
  const positioned = layoutFlow(graph, theme ? { textCase: theme.textCase } : undefined);
  return renderToStaticMarkup(createElement(Graph, { graph: positioned, theme }));
}

describe("<Graph> label casing", () => {
  const g: FlowGraph = {
    kind: "flow",
    nodes: [{ id: "n", label: "hello", shape: "box", role: "neutral" }],
    edges: [],
  };

  it("applies text-transform:uppercase by default", () => {
    expect(render(g)).toContain("text-transform:uppercase");
  });

  it("omits text-transform when textCase is 'none'", () => {
    const html = render(g, { textCase: "none" });
    expect(html).not.toContain("text-transform:uppercase");
    // Tracking is still applied in either casing.
    expect(html).toContain("letter-spacing");
  });
});

describe("<Graph> inline code", () => {
  const g: FlowGraph = {
    kind: "flow",
    nodes: [{ id: "n", label: "run `fn` here", shape: "box", role: "neutral" }],
    edges: [],
  };

  it("renders a code chip rect and a monospace, non-transformed code tspan", () => {
    const html = render(g);
    expect(html).toContain('data-slot="label-code-chip"');
    expect(html).toContain('data-slot="label-code"');
    // The code run opts out of uppercasing so it stays case-sensitive.
    expect(html).toContain("text-transform:none");
    expect(html).toContain("--font-mono");
    // Backticks are consumed — the delimiter never reaches the DOM.
    expect(html).not.toContain("`");
    // The prose runs survive.
    expect(html).toContain("run");
    expect(html).toContain("fn");
    expect(html).toContain("here");
  });

  it("defaults to a transparent chip and inherits the node foreground", () => {
    const html = render(g);
    // No override: the chip rect is transparent (no visible box) and the code
    // tspan omits an explicit color so it inherits the parent label's per-node
    // role foreground.
    expect(html).toContain("var(--trazo-code, transparent)");
    expect(html).toContain("var(--trazo-code-foreground, inherit)");
  });

  it("draws a distinct boxed chip when code tokens are overridden", () => {
    const html = render(g, {
      tokens: { code: "#123456", "code-foreground": "#abcdef" },
    });
    // The override flows through the `--trazo-code*` vars on the <svg> root.
    expect(html).toContain("--trazo-code:#123456");
    expect(html).toContain("--trazo-code-foreground:#abcdef");
  });

  it("does not emit a code chip for a plain label", () => {
    const plain: FlowGraph = {
      kind: "flow",
      nodes: [{ id: "n", label: "plain label", shape: "box", role: "neutral" }],
      edges: [],
    };
    expect(render(plain)).not.toContain('data-slot="label-code-chip"');
  });

  it("renders edge labels verbatim — backticks stay literal, no code chip", () => {
    const g: FlowGraph = {
      kind: "flow",
      nodes: [
        { id: "a", label: "A", shape: "box", role: "neutral" },
        { id: "b", label: "B", shape: "box", role: "neutral" },
      ],
      edges: [{ from: "a", to: "b", label: "call `fn`" }],
    };
    const html = render(g);
    expect(html).toContain("`fn`");
    expect(html).not.toContain('data-slot="label-code"');
  });

  it("draws theme-shaped attachment markers for displaced parallel badges", () => {
    const g: FlowGraph = {
      kind: "flow", direction: "TD",
      nodes: [{ id: "a", label: "Worker" }, { id: "b", label: "Notion" }],
      edges: [
        { from: "a", to: "b", label: "server-side, one integration" },
        { from: "b", to: "a", label: "markdown index" },
      ],
    };
    const square = render(g, joycoTheme);
    expect(square.match(/data-slot="edge-label-leader"/g)).toHaveLength(2);
    expect(square.match(/data-slot="edge-label-anchor"/g)).toHaveLength(2);
    expect(square).toMatch(/<rect data-slot="edge-label-anchor"[^>]*rx="0"[^>]*ry="0"/);
    expect(square).not.toContain('<circle data-slot="edge-label-anchor"');
    const rounded = render(g, { roundness: "lg" });
    expect(rounded).toMatch(/<rect data-slot="edge-label-anchor"[^>]*rx="2.5"[^>]*ry="2.5"/);
  });
});

describe("<Graph> annotations (notes)", () => {
  const g: FlowGraph = {
    kind: "flow",
    nodes: [
      { id: "a", label: "A", shape: "box", role: "neutral" },
      { id: "b", label: "B", shape: "box", role: "neutral" },
    ],
    edges: [{ from: "a", to: "b" }],
    notes: [{ target: "b", side: "below", label: "watch `this`" }],
  };

  it("renders the note under data-slot=annotation with a leader edge", () => {
    const html = render(g);
    expect(html).toContain('data-slot="annotation"');
    expect(html).toContain('data-slot="annotation-box"');
    // Leader edge is drawn as a plain connector with kind="note".
    expect(html).toContain('data-kind="note"');
    // Note text obeys the same inline-code rule as node labels.
    expect(html).toContain('data-slot="label-code"');
  });

  it("does not emit an annotation slot for a note-free graph", () => {
    const plain: FlowGraph = {
      kind: "flow",
      nodes: [{ id: "a", label: "A", shape: "box", role: "neutral" }],
      edges: [],
    };
    expect(render(plain)).not.toContain('data-slot="annotation"');
  });
});

describe("<Graph> multi-line edge labels", () => {
  it("stacks a multi-line edge label into per-line tspan rows (#15)", () => {
    // Regression: SVG <text> collapses `\n` to a space, so a multi-line edge
    // label used to render on one line inside an under-sized badge. The renderer
    // must split it into stacked <tspan> rows like node labels do.
    const g: FlowGraph = {
      kind: "flow",
      nodes: [
        { id: "a", label: "A", shape: "box", role: "neutral" },
        { id: "b", label: "B", shape: "box", role: "neutral" },
      ],
      edges: [{ from: "a", to: "b", label: "commit\nscroll deltas" }],
    };
    const html = render(g);
    const label = html.slice(html.indexOf('data-slot="edge-label"'));
    // Both lines survive as their own tspans — not run together on one line.
    // (Uppercasing is CSS `text-transform`, so the DOM text stays as authored.)
    expect(label).toContain(">commit</tspan>");
    expect(label).toContain(">scroll deltas</tspan>");
    // The concatenated single-line form never appears.
    expect(html).not.toContain("commit scroll deltas");
  });
});

describe("<Graph> reversed (start) arrow", () => {
  it("emits marker-start (not marker-end) for an arrow:start edge", () => {
    const g: FlowGraph = {
      kind: "flow",
      direction: "LR",
      nodes: [
        { id: "a", label: "A", shape: "box", role: "neutral" },
        { id: "b", label: "B", shape: "box", role: "neutral" },
      ],
      edges: [{ from: "a", to: "b", arrow: "start" }],
    };
    const html = render(g);
    const edgePath = html.match(/<path data-slot="edge"[^>]*>/)![0];
    expect(edgePath).toContain("marker-start");
    expect(edgePath).not.toContain("marker-end");
  });
});
