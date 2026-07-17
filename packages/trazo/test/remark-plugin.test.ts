import { describe, expect, it } from "vitest";

import { dslForLang, remarkTrazo } from "../src/remark/index.js";

// ── mdast + vfile fakes (dependency-light, matches the shapes the plugin reads) ─

function codeNode(lang: string | null, value: string, line = 1) {
  return {
    type: "code",
    lang,
    value,
    position: { start: { line, column: 1 }, end: { line: line + 2, column: 1 } },
  };
}

function root(...children: unknown[]) {
  return { type: "root", children };
}

interface FakeMessage extends Error {
  place?: unknown;
  fatal?: boolean | null;
}

function fakeFile() {
  const messages: FakeMessage[] = [];
  return {
    messages,
    message(reason: string, place?: unknown): FakeMessage {
      const m = Object.assign(new Error(reason), { place, fatal: null }) as FakeMessage;
      messages.push(m);
      return m;
    },
  };
}

describe("remarkTrazo", () => {
  it("passes well-formed diagrams without messages", () => {
    const file = fakeFile();
    const transform = remarkTrazo();
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transform(root(codeNode("flow", "flow LR\nA --> B")) as any, file as any),
    ).not.toThrow();
    expect(file.messages).toHaveLength(0);
  });

  it("throws on a malformed diagram and maps the DSL line to an absolute position", () => {
    const file = fakeFile();
    const transform = remarkTrazo();
    expect(() =>
      // fence opens on line 5, DSL error is on DSL line 1 → absolute line 6.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transform(root(codeNode("flow", "end", 5)) as any, file as any),
    ).toThrow(/flow DSL line 1/);
    expect(file.messages[0].place).toMatchObject({ line: 6 });
    expect(file.messages[0].fatal).toBe(true);
  });

  it("warns without throwing when severity is 'warn'", () => {
    const file = fakeFile();
    const transform = remarkTrazo({ severity: "warn" });
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transform(root(codeNode("git", "checkout ghost")) as any, file as any),
    ).not.toThrow();
    expect(file.messages).toHaveLength(1);
    expect(file.messages[0].fatal).toBe(false);
  });

  it("collects every error but throws once (fail-the-build)", () => {
    const file = fakeFile();
    const transform = remarkTrazo();
    expect(() =>
      transform(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        root(codeNode("flow", "end", 1), codeNode("block", "@@@", 10)) as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        file as any,
      ),
    ).toThrow();
    expect(file.messages).toHaveLength(2);
  });

  it("ignores non-trazo fence languages", () => {
    const file = fakeFile();
    const transform = remarkTrazo();
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transform(root(codeNode("ts", "const x: number = 'no'")) as any, file as any),
    ).not.toThrow();
    expect(file.messages).toHaveLength(0);
  });

  it("recognises every DSL lang (including seq/sequence and block)", () => {
    expect(dslForLang("flow")?.label).toBe("flow DSL");
    expect(dslForLang("flowchart")?.label).toBe("flow DSL");
    expect(dslForLang("git")?.label).toBe("git DSL");
    expect(dslForLang("seq")?.label).toBe("sequence DSL");
    expect(dslForLang("sequence")?.label).toBe("sequence DSL");
    expect(dslForLang("block")?.label).toBe("block DSL");
    expect(dslForLang('flow title="x"')?.label).toBe("flow DSL");
    expect(dslForLang("ts")).toBeNull();
    expect(dslForLang(null)).toBeNull();
  });
});
