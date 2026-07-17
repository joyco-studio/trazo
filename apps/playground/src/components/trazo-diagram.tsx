import {
  layout,
  parseBlock,
  parseFlow,
  parseGit,
  parseSequence,
  type PositionedGraph,
} from "@joycostudio/trazo";
import { Graph } from "@joycostudio/trazo/react";

/**
 * Renders a single fenced trazo diagram authored in MDX. The `remarkTrazoDiagram`
 * transform rewrites ```` ```flow ```` / ```git``` / ```seq``` / ```block```
 * fences into `<TrazoDiagram lang source />`, so authors write plain pseudo-code
 * in prose and get a deterministic, server-rendered SVG.
 *
 * Pure and hook-free — runs as a React Server Component, so diagrams ship in the
 * initial HTML with zero client JS. Parse errors are also caught at build time
 * by the `@joycostudio/trazo/remark` validator; the inline fallback below only
 * exists as defense-in-depth (and for the `warn` severity path).
 */

type Positioned = { graph: PositionedGraph } | { error: { line: number; message: string } };

function positionedFor(lang: string, source: string): Positioned {
  switch (lang) {
    case "flow":
    case "flowchart": {
      const { graph, error } = parseFlow(source);
      return error ? { error } : { graph: layout(graph) };
    }
    case "git": {
      const { graph, error } = parseGit(source);
      return error ? { error } : { graph: layout(graph) };
    }
    case "seq":
    case "sequence": {
      const { graph, error } = parseSequence(source);
      return error ? { error } : { graph: layout(graph) };
    }
    case "block": {
      const { graph, error } = parseBlock(source);
      return error ? { error } : { graph: layout(graph) };
    }
    default:
      return { error: { line: 0, message: `unknown diagram language "${lang}"` } };
  }
}

/**
 * @param lang    One of flow/flowchart/git/seq/sequence/block.
 * @param source  The raw DSL from the fence.
 * @param source-only  When present, the source pseudo-code is shown above the
 *                     rendered SVG — the default in the docs so a grammar
 *                     reference still teaches the syntax that produced the shape.
 *                     Pass `source={false}` (via the transform) to render the
 *                     diagram alone.
 */
export function TrazoDiagram({
  lang,
  source,
  showSource = true,
}: {
  lang: string;
  source: string;
  showSource?: boolean;
}) {
  const trimmed = source.replace(/^\n+|\n+$/g, "");
  const result = positionedFor(lang.toLowerCase(), trimmed);

  if ("error" in result) {
    return (
      <pre
        role="alert"
        data-slot="trazo-diagram-error"
        className="my-4 overflow-x-auto rounded-md border border-red-500/40 bg-red-500/5 p-4 text-sm text-red-500"
      >
        trazo {lang} DSL line {result.error.line}: {result.error.message}
      </pre>
    );
  }

  return (
    <figure
      data-slot="trazo-diagram"
      className="my-6 flex flex-col gap-3 **:data-[slot=trazo-diagram-source]:m-0"
    >
      {showSource ? (
        <pre
          data-slot="trazo-diagram-source"
          className="overflow-x-auto rounded-md border bg-fd-secondary/50 p-4 text-sm"
        >
          <code>{trimmed}</code>
        </pre>
      ) : null}
      <div data-slot="trazo-diagram-render" className="flex justify-center overflow-x-auto">
        <Graph graph={result.graph} />
      </div>
    </figure>
  );
}
