import { describe, it, expect } from "vitest";
import { parseSequence, seq } from "../src/index.js";

function ok(source: string) {
  const result = parseSequence(source);
  expect(result.error).toBeNull();
  return result.graph;
}

function err(source: string) {
  const result = parseSequence(source);
  expect(result.error).not.toBeNull();
  return result.error!;
}

describe("parseSequence — participants", () => {
  it("declares participants in order", () => {
    const g = ok("participant A\nparticipant B");
    expect(g.participants.map((p) => p.id)).toEqual(["A", "B"]);
  });

  it("parses a quoted label and role", () => {
    const g = ok('participant A ["Alice"]:good');
    expect(g.participants[0]).toMatchObject({ id: "A", label: "Alice", role: "good" });
  });

  it("auto-registers participants from messages in first-seen order", () => {
    const g = ok("A ->> B : hi\nC ->> A : yo");
    expect(g.participants.map((p) => p.id)).toEqual(["A", "B", "C"]);
  });

  it("ignores a bare `sequence` header keyword", () => {
    expect(ok("sequence\nA ->> B").participants).toHaveLength(2);
  });
});

describe("parseSequence — messages", () => {
  it("parses a sync message (->>)", () => {
    const g = ok("A ->> B : do it");
    expect(g.messages[0]).toMatchObject({ from: "A", to: "B", kind: "sync", label: "do it" });
  });

  it("parses an async message (-->>) as kind async", () => {
    const g = ok("A -->> B : later");
    expect(g.messages[0]?.kind).toBe("async");
  });

  it("detects -->> before ->> (longest match)", () => {
    const g = ok("A -->> B");
    expect(g.messages).toHaveLength(1);
    expect(g.messages[0]?.kind).toBe("async");
  });

  it("a self-message keeps its sync/async line style (self-ness is geometry)", () => {
    expect(ok("A ->> A : think").messages[0]).toMatchObject({ from: "A", to: "A", kind: "sync" });
    // An async self-call stays async so it renders dashed.
    expect(ok("A -->> A : retry").messages[0]?.kind).toBe("async");
  });

  it("a message without a label has no label", () => {
    expect(ok("A ->> B").messages[0]?.label).toBeUndefined();
  });
});

describe("parseSequence — notes", () => {
  it("parses a note over multiple participants", () => {
    const g = ok("A ->> B\nNote over A,B : both busy");
    expect(g.notes).toHaveLength(1);
    expect(g.notes![0]).toMatchObject({ over: ["A", "B"], text: "both busy" });
  });

  it("stamps a global `seq` interleaving messages and notes by source order", () => {
    const g = ok("A ->> B : m1\nNote over A : n1\nA ->> B : m2");
    expect(g.messages[0]?.seq).toBe(0); // m1
    expect(g.notes![0]?.seq).toBe(1); // n1 between the two messages
    expect(g.messages[1]?.seq).toBe(2); // m2
  });

  it("emits no notes key when there are none", () => {
    expect(ok("A ->> B").notes).toBeUndefined();
  });
});

describe("parseSequence — errors", () => {
  it("errors on an unparseable line with a line number", () => {
    const e = err("A ->> B\n??? bad");
    expect(e.line).toBe(2);
  });

  it("seq template throws on error", () => {
    expect(() => seq`??? nope`).toThrow(/sequence DSL/i);
  });

  it("seq template returns a graph on success", () => {
    const g = seq`A ->> B : ok`;
    expect(g.kind).toBe("sequence");
    expect(g.messages).toHaveLength(1);
  });
});
