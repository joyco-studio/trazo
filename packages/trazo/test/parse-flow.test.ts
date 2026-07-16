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
    const g = ok('A["label"]:success');
    expect(node(g, "A").role).toBe("success");
    expect(node(g, "A").label).toBe("label");
  });

  it("errors on an unknown role suffix", () => {
    // ":unknown" stays in `rest`, which the caller treats as trailing garbage.
    expect(err("A:unknown").line).toBe(1);
  });

  it("parses every semantic role, including the new theme tokens", () => {
    for (const role of [
      "primary",
      "secondary",
      "ghost",
      "muted",
      "neutral",
      "success",
      "warning",
      "error",
      "info",
      "streamed",
    ]) {
      expect(node(ok(`A:${role}`), "A").role).toBe(role);
    }
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

  it("strips surrounding quotes from an edge label (like node labels)", () => {
    expect(ok('A ===|"base of"| B').edges[0]?.label).toBe("base of");
    expect(ok("A -->|'yes'| B").edges[0]?.label).toBe("yes");
    // A bare (unquoted) label is unchanged.
    expect(ok("A -->|base of| B").edges[0]?.label).toBe("base of");
  });

  it("keeps an inner pipe inside a quoted edge label", () => {
    // The quotes let the inner `|` through, then are stripped from the result.
    expect(ok('A -->|"a | b"| B').edges[0]?.label).toBe("a | b");
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

// ── multi-line labels ────────────────────────────────────────────────────────

describe("parseFlow — multi-line labels", () => {
  it("converts a literal \\n in a label to a newline", () => {
    expect(node(ok('A["line one\\nline two"]'), "A").label).toBe("line one\nline two");
  });

  it("converts <br> and <br/> to newlines", () => {
    expect(node(ok('A["a<br>b<br/>c"]'), "A").label).toBe("a\nb\nc");
  });

  it("converts \\n inside an edge label", () => {
    expect(ok("A -->|first\\nsecond| B").edges[0]?.label).toBe("first\nsecond");
  });

  it("converts <br/> inside a quoted edge label (multi-line wrap)", () => {
    expect(ok('A -->|"first line<br/>second line"| B').edges[0]?.label).toBe(
      "first line\nsecond line",
    );
  });

  it("leaves a single-line label unchanged", () => {
    expect(node(ok('A["just one"]'), "A").label).toBe("just one");
  });

  it("preserves a literal backslash-N (only lowercase \\n is a break)", () => {
    // `C:\Newdir` must NOT become `C:` / `ewdir` — \N is not a line break.
    expect(node(ok('A["C:\\Newdir"]'), "A").label).toBe("C:\\Newdir");
  });
});

// ── arrow tokens (directed / undirected / bidirectional) ─────────────────────

describe("parseFlow — arrow tokens", () => {
  it("--> is directed (no explicit arrow recorded; default end)", () => {
    expect(ok("A --> B").edges[0]?.arrow).toBeUndefined();
  });

  it("--- is undirected (arrow: none)", () => {
    const g = ok("A --- B");
    expect(g.edges[0]).toMatchObject({ from: "A", to: "B", arrow: "none" });
    expect(g.edges[0]?.colored).toBeUndefined();
  });

  it("=== is undirected and colored", () => {
    const g = ok("A === B");
    expect(g.edges[0]?.arrow).toBe("none");
    expect(g.edges[0]?.colored).toBe(true);
  });

  it("<--> is bidirectional (arrow: both)", () => {
    const g = ok("A <--> B");
    expect(g.edges[0]).toMatchObject({ from: "A", to: "B", arrow: "both" });
  });

  it("<==> is bidirectional AND colored", () => {
    const g = ok("A <==> B");
    expect(g.edges[0]).toMatchObject({ from: "A", to: "B", arrow: "both", colored: true });
  });

  it("<-- is a reversed arrow (arrow: start), still from → to for layout", () => {
    const g = ok("A <-- B");
    expect(g.edges[0]).toMatchObject({ from: "A", to: "B", arrow: "start" });
    expect(g.edges[0]?.colored).toBeUndefined();
  });

  it("<== is a reversed arrow AND colored", () => {
    const g = ok("A <== B");
    expect(g.edges[0]).toMatchObject({ from: "A", to: "B", arrow: "start", colored: true });
  });

  it("longest-match: <--> is not read as <-- or -->", () => {
    const g = ok("A <--> B");
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ from: "A", to: "B", arrow: "both" });
    // And <== is not read as <-- + stray =
    expect(ok("A <==> B").edges[0]?.arrow).toBe("both");
  });

  it("every arrow token supports an edge label", () => {
    expect(ok("A ---|sync| B").edges[0]?.label).toBe("sync");
    expect(ok("A <-->|two-way| B").edges[0]?.label).toBe("two-way");
  });

  it("ignores an arrow token inside a quoted label", () => {
    const g = ok('A["x --- y"] --> B');
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]?.arrow).toBeUndefined();
    expect(node(g, "A").label).toBe("x --- y");
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

// ── subgraphs ─────────────────────────────────────────────────────────────────

describe("parseFlow — subgraphs", () => {
  it("declares a group and tags its members", () => {
    const g = ok('subgraph G ["Build"]\nA --> B\nend\nB --> C');
    expect(g.groups).toEqual([{ id: "G", label: "Build" }]);
    expect(node(g, "A").group).toBe("G");
    expect(node(g, "B").group).toBe("G");
    // C is declared outside the block → ungrouped.
    expect(node(g, "C").group).toBeUndefined();
  });

  it("supports a bare (unlabeled) subgraph", () => {
    const g = ok("subgraph G\nA\nend");
    expect(g.groups).toEqual([{ id: "G" }]);
    expect(node(g, "A").group).toBe("G");
  });

  it("accepts a quoted title without brackets", () => {
    expect(ok('subgraph G "Title"\nA\nend').groups?.[0]?.label).toBe("Title");
  });

  it("errors on a nested subgraph", () => {
    const e = err("subgraph A\nsubgraph B\nend\nend");
    expect(e.line).toBe(2);
    expect(e.message).toMatch(/nested/i);
  });

  it("errors on `end` with no open subgraph", () => {
    const e = err("A\nend");
    expect(e.line).toBe(2);
    expect(e.message).toMatch(/end/i);
  });

  it("first group wins when a node would join two", () => {
    const g = ok("subgraph G1\nA\nend\nsubgraph G2\nA\nend");
    expect(node(g, "A").group).toBe("G1");
  });

  it("emits no groups key when there are none", () => {
    expect(ok("A --> B").groups).toBeUndefined();
  });

  it("tints a labeled subgraph with a trailing :role", () => {
    const g = ok('subgraph G ["Build"] :success\nA\nend');
    expect(g.groups).toEqual([{ id: "G", label: "Build", role: "success" }]);
  });

  it("tints a bare subgraph with a trailing :role", () => {
    expect(ok("subgraph G :error\nA\nend").groups).toEqual([{ id: "G", role: "error" }]);
  });

  it("leaves a bogus :role token in the title untouched", () => {
    // `:nope` is not a role, so it is not peeled — it becomes part of the title.
    const g = ok("subgraph G :nope\nA\nend");
    expect(g.groups?.[0]?.role).toBeUndefined();
    expect(g.groups?.[0]?.label).toBe(":nope");
  });
});

// ── notes (annotations) ─────────────────────────────────────────────────────

describe("parseFlow — notes", () => {
  it("parses a quoted note on all four sides", () => {
    const g = ok(
      [
        "layout",
        'note layout above "top"',
        'note layout below "bottom"',
        'note layout left "left"',
        'note layout right "right"',
      ].join("\n"),
    );
    expect(g.notes).toBeDefined();
    expect(g.notes!.map((n) => n.side)).toEqual(["above", "below", "left", "right"]);
    expect(g.notes!.map((n) => n.label)).toEqual(["top", "bottom", "left", "right"]);
    expect(g.notes!.every((n) => n.target === "layout")).toBe(true);
  });

  it("does not create a node for the note keyword or forward-referenced target", () => {
    const g = ok('note layout below "hi"\nlayout["Layout"]');
    // Only the real `layout` node exists — no `note` node, no ghost target.
    expect(g.nodes.map((n) => n.id)).toEqual(["layout"]);
    expect(g.notes).toHaveLength(1);
    expect(g.notes![0]!.target).toBe("layout");
  });

  it("normalizes <br/> and \\n breaks in note text", () => {
    const g = ok('a\nnote a below "line1<br/>line2"');
    expect(g.notes![0]!.label).toBe("line1\nline2");
  });

  it("parses an optional trailing :role after a quoted note", () => {
    const g = ok('a\nnote a below "watch out" :warning');
    expect(g.notes![0]!.role).toBe("warning");
    expect(g.notes![0]!.label).toBe("watch out");
  });

  it("case-insensitive side keyword", () => {
    const g = ok('a\nnote a BELOW "x"');
    expect(g.notes![0]!.side).toBe("below");
  });

  it("keeps `note` usable as an ordinary node id when not a full note statement", () => {
    const g = ok("note --> other");
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["note", "other"]);
    expect(g.notes).toBeUndefined();
  });

  it("errors on a note statement with empty text", () => {
    const e = err('a\nnote a below ""');
    expect(e.line).toBe(2);
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
