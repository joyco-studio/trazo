import { describe, it, expect } from "vitest";
import { parseFlow } from "../src/parse-flow.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function ok(source: string) {
  const result = parseFlow(source);
  expect(result.error).toBeNull();
  return result.graph;
}

function err(source: string) {
  const result = parseFlow(source);
  expect(result.error).not.toBeNull();
  return result.error!;
}

function node(g: ReturnType<typeof ok>, id: string) {
  const n = g.nodes.find((n) => n.id === id);
  expect(n).toBeDefined();
  return n!;
}

// ── direction ─────────────────────────────────────────────────────────────────

describe("parseFlow — direction", () => {
  it("defaults to TD", () => {
    expect(ok("A --> B").direction).toBe("TD");
  });

  it("parses flow TD", () => {
    expect(ok("flow TD\nA --> B").direction).toBe("TD");
  });

  it("parses flow LR (case-insensitive)", () => {
    expect(ok("flow lr\nA --> B").direction).toBe("LR");
  });

  it("parses flowchart LR", () => {
    expect(ok("flowchart LR\nA --> B").direction).toBe("LR");
  });

  it("bare 'flow' line is ignored", () => {
    expect(ok("flow\nA").direction).toBe("TD");
  });
});

// ── nodes ─────────────────────────────────────────────────────────────────────

describe("parseFlow — nodes", () => {
  it("parses a bare node", () => {
    const g = ok("A");
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]?.id).toBe("A");
  });

  it("parses box shape", () => {
    expect(node(ok('A["hello"]'), "A").shape).toBe("box");
  });

  it("parses stadium shape", () => {
    expect(node(ok('A(["hello"])'), "A").shape).toBe("stadium");
  });

  it("parses cylinder shape", () => {
    expect(node(ok('A[("hello")]'), "A").shape).toBe("cylinder");
  });

  it("parses diamond shape", () => {
    expect(node(ok('A{"hello"}'), "A").shape).toBe("diamond");
  });

  it("strips outer quotes from label", () => {
    expect(node(ok('A["hello"]'), "A").label).toBe("hello");
  });

  it("strips outer single quotes from label", () => {
    expect(node(ok("A['hello']"), "A").label).toBe("hello");
  });

  it("parses role suffix", () => {
    expect(node(ok("A:primary"), "A").role).toBe("primary");
  });

  it("parses role on a shaped node", () => {
    const g = ok('A["label"]:good');
    expect(node(g, "A").role).toBe("good");
    expect(node(g, "A").label).toBe("label");
  });

  it("errors on an unknown role suffix", () => {
    // ":unknown" stays in `rest`, which the caller treats as trailing garbage.
    expect(err("A:unknown").line).toBe(1);
  });
});

// ── edges ─────────────────────────────────────────────────────────────────────

describe("parseFlow — edges", () => {
  it("parses a plain edge", () => {
    const g = ok("A --> B");
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]?.from).toBe("A");
    expect(g.edges[0]?.to).toBe("B");
    expect(g.edges[0]?.colored).toBeUndefined();
  });

  it("parses a colored edge", () => {
    const g = ok("A ==> B");
    expect(g.edges[0]?.colored).toBe(true);
  });

  it("parses an edge label", () => {
    const g = ok("A -->|yes| B");
    expect(g.edges[0]?.label).toBe("yes");
  });

  it("errors on unclosed pipe label", () => {
    const e = err("A -->|unclosed B");
    expect(e.message).toMatch(/closing/i);
  });

  it("creates nodes implicitly from edges", () => {
    const g = ok("A --> B");
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
  });

  it("first declaration wins for label/shape/role", () => {
    const g = ok('A["first"]\nA["second"]');
    expect(node(g, "A").label).toBe("first");
  });

  it("prefers first declaration for edge node info", () => {
    const g = ok('A["declared"] --> B\nA --> C');
    expect(node(g, "A").label).toBe("declared");
  });

  it("ignores --> inside a quoted label, picks the real ==>", () => {
    // A["x --> y"] ==> B: the --> is inside a label; ==> is the real arrow.
    const g = ok('A["x --> y"] ==> B');
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]?.colored).toBe(true);
    expect(node(g, "A").label).toBe("x --> y");
  });

  it("ignores ==> inside a quoted label, picks the real -->", () => {
    // A["x ==> y"] --> B: the ==> is inside a label; --> is the real arrow.
    const g = ok('A["x ==> y"] --> B');
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]?.colored).toBeUndefined();
    expect(node(g, "A").label).toBe("x ==> y");
  });
});

// ── quote-aware: comment stripping ───────────────────────────────────────────

describe("parseFlow — comment stripping respects quotes", () => {
  it("strips a real # comment", () => {
    const g = ok('A["label"] # comment');
    expect(g.nodes).toHaveLength(1);
    expect(node(g, "A").label).toBe("label");
  });

  it("does not strip # inside a quoted label", () => {
    const g = ok('A["label #1"]');
    expect(node(g, "A").label).toBe("label #1");
  });

  it("does not strip # inside a quoted label on an edge line", () => {
    const g = ok('A["node #1"] --> B');
    expect(node(g, "A").label).toBe("node #1");
    expect(g.edges).toHaveLength(1);
  });
});

// ── quote-aware: closing delimiter search ────────────────────────────────────

describe("parseFlow — delimiter search respects quotes", () => {
  it("handles ] inside a quoted box label", () => {
    const g = ok('A["step ] done"]');
    expect(node(g, "A").label).toBe("step ] done");
  });

  it("handles } inside a quoted diamond label", () => {
    const g = ok('A{"step } done"}');
    expect(node(g, "A").label).toBe("step } done");
  });

  it("handles ) inside a quoted stadium label", () => {
    const g = ok('A(["step ) done"])');
    expect(node(g, "A").label).toBe("step ) done");
  });

  it("unescapes \\\" inside a double-quoted label", () => {
    const g = ok('A["say \\"hello\\""]');
    expect(node(g, "A").label).toBe('say "hello"');
  });
});

// ── quote-aware: arrow detection ─────────────────────────────────────────────

describe("parseFlow — arrow detection respects quotes", () => {
  it("does not treat --> inside a label as an edge arrow", () => {
    const g = ok('A["A --> B"]');
    expect(g.edges).toHaveLength(0);
    expect(node(g, "A").label).toBe("A --> B");
  });

  it("does not treat ==> inside a label as a colored edge", () => {
    const g = ok('A["A ==> B"]');
    expect(g.edges).toHaveLength(0);
    expect(node(g, "A").label).toBe("A ==> B");
  });

  it("correctly finds the real --> after a quoted label containing -->", () => {
    const g = ok('A["A --> B"] --> C');
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ from: "A", to: "C" });
    expect(node(g, "A").label).toBe("A --> B");
  });
});

// ── quote-aware: pipe label ───────────────────────────────────────────────────

describe("parseFlow — pipe label respects quotes", () => {
  it("handles a quoted string inside a pipe label without early-closing", () => {
    const g = ok('A -->|step "a|b"| B');
    expect(g.edges[0]?.label).toBe('step "a|b"');
  });
});

// ── error cases ───────────────────────────────────────────────────────────────

describe("parseFlow — errors", () => {
  it("errors on a line that is not a node or edge", () => {
    const e = err("??? bad line");
    expect(e.line).toBe(1);
  });

  it("reports the correct line number", () => {
    const e = err("A --> B\n??? bad");
    expect(e.line).toBe(2);
  });

  it("errors on invalid left side of arrow", () => {
    const e = err("--> B");
    expect(e.message).toMatch(/left side/i);
  });

  it("errors on invalid right side of arrow", () => {
    const e = err("A --> ---");
    expect(e.message).toMatch(/right side/i);
  });

  it("errors on unexpected trailing content after edge target", () => {
    const e = err("A --> B extra");
    expect(e.message).toMatch(/unexpected/i);
  });
});
