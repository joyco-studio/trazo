/**
 * remark transform (playground-local): rewrites fenced trazo diagram blocks into
 * `<TrazoDiagram lang source />` MDX elements so they render as live SVG instead
 * of a syntax-highlighted code sample.
 *
 * It reuses `dslForLang` from `@joycostudio/trazo/remark`, so the set of
 * recognised fence languages stays identical to the build-time validator — a
 * block that validates is exactly a block that renders. Runs in the remark
 * (mdast) phase, before rehype/shiki ever sees the node, so trazo fences never
 * get double-processed as code.
 *
 * Pair it with the package's `remarkTrazo` validator (registered first) so a
 * malformed diagram fails the build with a source-accurate line, rather than
 * throwing from a React render.
 */

import { dslForLang } from "@joycostudio/trazo/remark";

interface MdastNode {
  type: string;
  lang?: string | null;
  value?: string;
  children?: MdastNode[];
}

function firstToken(lang: string | null | undefined): string {
  return (lang ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

function toDiagram(node: MdastNode): MdastNode {
  const lang = firstToken(node.lang);
  return {
    type: "mdxJsxFlowElement",
    name: "TrazoDiagram",
    attributes: [
      { type: "mdxJsxAttribute", name: "lang", value: lang },
      { type: "mdxJsxAttribute", name: "source", value: node.value ?? "" },
    ],
    children: [],
    // The mdast-util-mdx-jsx node shape isn't in our minimal MdastNode stub.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function transform(node: MdastNode): void {
  if (!node.children) return;
  node.children = node.children.map((child) =>
    child.type === "code" && dslForLang(child.lang) ? toDiagram(child) : child,
  );
  for (const child of node.children) transform(child);
}

export function remarkTrazoDiagram() {
  return function transformer(tree: MdastNode): void {
    transform(tree);
  };
}

export default remarkTrazoDiagram;
