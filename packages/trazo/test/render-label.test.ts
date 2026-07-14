import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { layoutFlow } from "../src/index.js";
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
});
