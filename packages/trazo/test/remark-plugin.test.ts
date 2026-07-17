import { describe, expect, it } from "vitest";

import { dslForLang, remarkTrazo, remarkTrazoRender } from "../src/remark/index.js";

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

// ── Render transform ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function metaNode(lang: string, value: string, meta?: string, line = 1): any {
  return { ...codeNode(lang, value, line), meta: meta ?? null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attrMap(element: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const a of element.attributes) {
    if (a.value === null) out[a.name] = true;
    else if (typeof a.value === "string") out[a.name] = a.value;
    else out[a.name] = a.value?.data?.estree?.body?.[0]?.expression?.value;
  }
  return out;
}

describe("remarkTrazoRender", () => {
  it("rewrites a valid fence into the configured component with lang + string body child", () => {
    const tree = root(metaNode("flow", "flow LR\nA --> B"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    remarkTrazoRender({ componentName: "Diagram" })(tree as any, fakeFile() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = (tree as any).children[0];
    expect(el.type).toBe("mdxJsxFlowElement");
    expect(el.name).toBe("Diagram");
    expect(attrMap(el).lang).toBe("flow");
    expect(el.children).toEqual([{ type: "text", value: "flow LR\nA --> B" }]);
  });

  it("normalises the lang alias to its canonical kind", () => {
    const tree = root(metaNode("sequence", "sequence\nA ->> B : hi"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    remarkTrazoRender()(tree as any, fakeFile() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(attrMap((tree as any).children[0]).lang).toBe("seq");
  });

  it("forwards meta: title=\"…\" as a string prop and a bare flag as boolean true", () => {
    const tree = root(metaNode("flow", "flow TD\nA --> B", 'title="Blocking await chain" ascii'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    remarkTrazoRender()(tree as any, fakeFile() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attrs = attrMap((tree as any).children[0]);
    expect(attrs.title).toBe("Blocking await chain");
    expect(attrs.ascii).toBe(true);
  });

  it("stamps document-order numbers (numberAttr) across trazo fences only", () => {
    const tree = root(
      metaNode("flow", "flow LR\nA --> B"),
      codeNode("ts", "const x = 1"),
      { type: "list", children: [metaNode("git", "commit : init")] },
      metaNode("block", 'columns 1\nA["x"]'),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    remarkTrazoRender({ numberAttr: "index" })(tree as any, fakeFile() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kids = (tree as any).children;
    expect(attrMap(kids[0]).index).toBe(1); // flow
    expect(kids[1].type).toBe("code"); // ts untouched, not counted
    expect(attrMap(kids[2].children[0]).index).toBe(2); // nested git — document order
    expect(attrMap(kids[3]).index).toBe(3); // block
  });

  it("throws on a malformed fence and leaves it as a code node (no broken element)", () => {
    const tree = root(metaNode("flow", "end", "", 5));
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      remarkTrazoRender()(tree as any, fakeFile() as any),
    ).toThrow(/flow DSL line 1/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tree as any).children[0].type).toBe("code");
  });

  it("warn severity keeps the fence as code and does not throw", () => {
    const tree = root(metaNode("flow", "end"));
    const file = fakeFile();
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      remarkTrazoRender({ severity: "warn" })(tree as any, file as any),
    ).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((tree as any).children[0].type).toBe("code");
    expect(file.messages[0].fatal).toBe(false);
  });

  it("ignores non-trazo langs and langs outside an explicit allow-list", () => {
    const tree = root(metaNode("flow", "flow LR\nA --> B"), metaNode("git", "commit : init"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    remarkTrazoRender({ langs: ["git"] })(tree as any, fakeFile() as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kids = (tree as any).children;
    expect(kids[0].type).toBe("code"); // flow excluded by allow-list
    expect(kids[1].type).toBe("mdxJsxFlowElement"); // git rendered
  });
});
