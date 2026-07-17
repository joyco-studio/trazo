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
 * Renders a single fenced trazo diagram authored in MDX. The package's
 * `remarkTrazoRender` transform rewrites ```` ```flow ```` / ```git``` / ```seq```
 * / ```block``` fences into `<TrazoDiagram lang index title …>{`<dsl>`}</TrazoDiagram>`,
 * so the DSL body arrives as `children`, `lang` carries the canonical kind, and
 * fence meta (`title="…"`) plus the auto `index` arrive as props.
 *
 * Pure and hook-free — runs as a React Server Component, so diagrams ship in the
 * initial HTML with zero client JS. Parse errors are also caught at build time
 * by the transform's own validation; the inline fallback below only exists as
 * defense-in-depth (and for the `warn` severity path).
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
 * @param lang      Canonical DSL kind (flow/git/seq/block) set by the transform.
 * @param children  The raw DSL body, passed as a string child by the transform.
 * @param title     Optional fence-meta caption (`title="…"`).
 * @param index     Optional per-document number stamped by the transform.
 * @param showSource When true (default), the source pseudo-code is shown above the
 *                   rendered SVG so a grammar reference still teaches the syntax.
 */
export function TrazoDiagram({
  lang,
  children,
  title,
  index,
  showSource = true,
}: {
  lang: string;
  children: string;
  title?: string;
  index?: number;
  showSource?: boolean;
}) {
  const source = String(children).replace(/^\n+|\n+$/g, "");
  const result = positionedFor(lang.toLowerCase(), source);

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

  const caption =
    index !== undefined || title ? (
      <figcaption
        data-slot="trazo-diagram-caption"
        className="text-fd-muted-foreground text-sm font-medium"
      >
        {index !== undefined ? <span className="tabular-nums">{`Fig. ${index}`}</span> : null}
        {index !== undefined && title ? " — " : null}
        {title}
      </figcaption>
    ) : null;

  return (
    <figure
      data-slot="trazo-diagram"
      className="my-6 flex flex-col gap-3 **:data-[slot=trazo-diagram-source]:m-0"
    >
      {caption}
      {showSource ? (
        <pre
          data-slot="trazo-diagram-source"
          className="overflow-x-auto rounded-md border bg-fd-secondary/50 p-4 text-sm"
        >
          <code>{source}</code>
        </pre>
      ) : null}
      <div data-slot="trazo-diagram-render" className="flex justify-center overflow-x-auto">
        <Graph graph={result.graph} title={title} />
      </div>
    </figure>
  );
}
