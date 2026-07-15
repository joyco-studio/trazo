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

  it("places an interleaved note in its timeline row (between messages, no overlap)", () => {
    // m0, then a note, then m1: the note sits BELOW m0's arrow and ABOVE m1's,
    // and no message arrow passes through any note box.
    const g = layoutSequence({
      kind: "sequence",
      participants: [{ id: "A" }, { id: "B" }],
      messages: [
        { from: "A", to: "B", label: "first", kind: "sync", seq: 0 },
        { from: "A", to: "B", label: "second", kind: "sync", seq: 2 },
      ],
      notes: [{ over: ["A"], text: "between", seq: 1 }],
    });
    const arrowY = (i: number) =>
      g.edges[i]!.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number)[1]!;
    const note = g.groups![0]!;
    // Timeline order: m0 above the note, m1 below it.
    expect(arrowY(0)).toBeLessThan(note.y);
    expect(arrowY(1)).toBeGreaterThan(note.y + note.h);
    // No arrow runs through the note box.
    for (const e of g.edges) {
      const y = e.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number)[1]!;
      expect(y >= note.y && y <= note.y + note.h).toBe(false);
    }
    // Everything stays within the viewBox.
    expect(note.x).toBeGreaterThanOrEqual(0);
    expect(note.x + note.w).toBeLessThanOrEqual(g.width + 0.5);
  });

  it("sits the message label ABOVE the arrow and keeps its badge in the viewBox", () => {
    // A long horizontal message: the label must not sit on top of the arrow
    // line (which would hide it), and its badge must not be cropped on the right.
    const g = layoutSequence({
      kind: "sequence",
      participants: [{ id: "A" }, { id: "B" }],
      messages: [
        { from: "A", to: "B", label: "A fairly long message label here", kind: "sync", seq: 0 },
      ],
    });
    const e = g.edges[0]!;
    const arrowY = e.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number)[1]!;
    // Label center is clearly above the arrow line.
    expect(e.labelPoint!.y).toBeLessThan(arrowY - 5);
    // The badge's right edge fits inside the viewBox (badgeWidth = w + 28).
    const rightEdge = e.labelPoint!.x + (e.labelWidth! + 28) / 2;
    expect(rightEdge).toBeLessThanOrEqual(g.width + 0.5);
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

  it("spreads adjacent columns so a straight message label fits BETWEEN them", () => {
    // A message label wider than the base columnGap must push the two lifelines
    // apart, so the centered badge sits within the pair span (both ends reaching
    // a lifeline) instead of overhanging both and leaning the diagram left.
    const g = layoutSequence({
      kind: "sequence",
      participants: [{ id: "A" }, { id: "B" }],
      messages: [{ from: "A", to: "B", label: "a rather wide message label here", kind: "sync" }],
    });
    const ax = g.nodes.find((n) => n.id === "A")!.x;
    const bx = g.nodes.find((n) => n.id === "B")!.x;
    const e = g.edges[0]!;
    const badgeW = e.labelWidth! + 28; // badgeWidth = w + pads
    // Center-to-center distance is at least the badge width.
    expect(bx - ax).toBeGreaterThanOrEqual(badgeW - 0.5);
    // The badge is centered on the span and fits within [A, B].
    expect(e.labelPoint!.x - badgeW / 2).toBeGreaterThanOrEqual(ax - 0.5);
    expect(e.labelPoint!.x + badgeW / 2).toBeLessThanOrEqual(bx + 0.5);
  });

  it("reserves room so a self-loop label clears the next column", () => {
    // A self-message on the FIRST participant with a wide label must not overlap
    // the second participant's lifeline — the column spacing reserves the loop +
    // label reach.
    const g = layoutSequence({
      kind: "sequence",
      participants: [{ id: "A" }, { id: "B" }],
      messages: [{ from: "A", to: "A", label: "a wide self message label", kind: "sync" }],
    });
    const self = g.edges[0]!;
    const bx = g.nodes.find((n) => n.id === "B")!.x;
    const badgeRight = self.labelPoint!.x + (self.labelWidth! + 28) / 2;
    // The self-loop label's right edge clears B's lifeline.
    expect(badgeRight).toBeLessThanOrEqual(bx + 0.5);
  });

  it("offsets a multi-line message label by its taller badge height", () => {
    // A `<br/>` label's badge is taller; its center must sit far enough above the
    // arrow that the whole (multi-line) badge clears the line.
    const g = layoutSequence({
      kind: "sequence",
      participants: [{ id: "A" }, { id: "B" }],
      messages: [{ from: "A", to: "B", label: "first line\nsecond line\nthird line", kind: "sync" }],
    });
    const e = g.edges[0]!;
    const arrowY = e.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number)[1]!;
    // 3-line badge is BADGE_H(22) + 2*lineHeight(~16.9) ≈ 55.8 tall; its bottom
    // (labelPoint.y + h/2) sits above the arrow.
    const badgeBottom = e.labelPoint!.y + 55.8 / 2;
    expect(badgeBottom).toBeLessThan(arrowY);
    expect(g.height).toBeGreaterThan(0);
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
