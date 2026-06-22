import { describe, it, expect } from "vitest";
import { layout, layoutSequence } from "../src/index.js";
import type { SequenceGraph } from "../src/index.js";

const fixture: SequenceGraph = {
  kind: "sequence",
  participants: [
    { id: "C", label: "Client", role: "primary" },
    { id: "S", label: "Server" },
  ],
  messages: [
    { from: "C", to: "S", label: "request", kind: "sync" },
    { from: "S", to: "S", label: "process", kind: "self" },
    { from: "S", to: "C", label: "response", kind: "async" },
  ],
  notes: [{ over: ["C", "S"], text: "handshake" }],
};

describe("layoutSequence()", () => {
  it("is deterministic (repeat + clone)", () => {
    expect(layoutSequence(fixture)).toEqual(layoutSequence(fixture));
    const clone: SequenceGraph = JSON.parse(JSON.stringify(fixture));
    expect(layoutSequence(fixture)).toEqual(layoutSequence(clone));
  });

  it("dispatches via layout() on kind === 'sequence'", () => {
    expect(layout(fixture)).toEqual(layoutSequence(fixture));
  });

  it("places participant columns in declaration order (increasing x)", () => {
    const g = layoutSequence(fixture);
    const x = (id: string) => g.nodes.find((n) => n.id === id)!.x;
    expect(x("C")).toBeLessThan(x("S"));
    expect(g.laneCount).toBe(2);
  });

  it("emits one lifeline per participant spanning header → past last row", () => {
    const g = layoutSequence(fixture);
    expect(g.lifelines).toBeDefined();
    expect(g.lifelines!.map((l) => l.id).sort()).toEqual(["C", "S"]);
    for (const l of g.lifelines!) {
      expect(l.x1).toBe(l.x2); // vertical
      expect(l.y2).toBeGreaterThan(l.y1);
    }
  });

  it("a straight message is horizontal at an increasing row y", () => {
    const g = layoutSequence(fixture);
    const req = g.edges.find((e) => e.from === "C" && e.to === "S")!;
    const nums = req.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5); // flat
  });

  it("messages are directed (arrowHead end) and async is dashed", () => {
    const g = layoutSequence(fixture);
    for (const e of g.edges) expect(e.arrowHead).toBe("end");
    const async = g.edges.find((e) => e.from === "S" && e.to === "C")!;
    expect(async.dashed).toBe(true);
    const sync = g.edges.find((e) => e.from === "C" && e.to === "S")!;
    expect(sync.dashed).toBeUndefined();
  });

  it("a self-message loops (bulges right of its lifeline)", () => {
    const g = layoutSequence(fixture);
    const self = g.edges.find((e) => e.from === "S" && e.to === "S")!;
    const xs = self.path
      .match(/-?\d+(?:\.\d+)?/g)!
      .map(Number)
      .filter((_, i) => i % 2 === 0);
    const lifelineX = g.nodes.find((n) => n.id === "S")!.x;
    expect(Math.max(...xs)).toBeGreaterThan(lifelineX);
  });

  it("a note becomes a group box (variant note) spanning its participants", () => {
    const g = layoutSequence(fixture);
    expect(g.groups).toBeDefined();
    const note = g.groups![0]!;
    expect(note.variant).toBe("note");
    expect(note.label).toBe("handshake");
    const cx = g.nodes.find((n) => n.id === "C")!.x;
    const sx = g.nodes.find((n) => n.id === "S")!.x;
    expect(note.x).toBeLessThanOrEqual(cx);
    expect(note.x + note.w).toBeGreaterThanOrEqual(sx);
  });

  it("sets positive viewBox bounds", () => {
    const g = layoutSequence(fixture);
    expect(g.width).toBeGreaterThan(0);
    expect(g.height).toBeGreaterThan(0);
  });

  it("an async self-message renders dashed (kind survives self routing)", () => {
    const g = layoutSequence({
      kind: "sequence",
      participants: [{ id: "A" }],
      messages: [{ from: "A", to: "A", kind: "async" }],
    });
    expect(g.edges[0]?.dashed).toBe(true);
  });

  it("grows the viewBox to contain stacked notes (no clipping)", () => {
    const g = layoutSequence({
      kind: "sequence",
      participants: [{ id: "A" }, { id: "B" }],
      messages: [{ from: "A", to: "B", kind: "sync" }],
      notes: [
        { over: ["A", "B"], text: "n1" },
        { over: ["A", "B"], text: "n2" },
        { over: ["A", "B"], text: "n3" },
        { over: ["A", "B"], text: "n4" },
      ],
    });
    for (const note of g.groups!) {
      expect(note.y + note.h).toBeLessThanOrEqual(g.height);
    }
    // Stacked notes don't overlap: each starts at or below the previous bottom.
    const sorted = [...g.groups!].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.y).toBeGreaterThanOrEqual(sorted[i - 1]!.y + sorted[i - 1]!.h - 0.5);
    }
  });

  it("handles a diagram with no notes (no groups key)", () => {
    const g = layoutSequence({
      kind: "sequence",
      participants: [{ id: "A" }, { id: "B" }],
      messages: [{ from: "A", to: "B", kind: "sync" }],
    });
    expect(g.groups).toBeUndefined();
    expect(g.lifelines).toHaveLength(2);
  });
});
