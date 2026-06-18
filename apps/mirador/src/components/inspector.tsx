"use client";

/**
 * Inspector — the client island that makes mirador "live".
 *
 * Architecture (the whole point of mirador):
 *   - The SERVER already rendered the editor + the graph for SEED_PROGRAM into
 *     the initial HTML (see app/page.tsx). This island hydrates over that markup.
 *   - `useState` is seeded with the SAME SEED_PROGRAM, and the initial layout is
 *     computed from it with the SAME `layout()` + `<Graph>` the server used, so
 *     the first client render is byte-identical to the server's → no hydration
 *     mismatch, zero flicker.
 *   - On each edit we re-parse → `layout()` → re-render `<Graph>` IN THE BROWSER,
 *     debounced. No server round-trip per keystroke.
 *   - Parse errors keep the LAST GOOD graph on screen and surface a friendly
 *     inline message.
 *
 * SWAP AT INTEGRATION: `layout` comes from "@/lib/rama-stub". Change that import
 * to "rama" and this island uses the real engine with no other change.
 */

import { useCallback, useMemo, useRef, useState } from "react";

import { Graph } from "@/components/graph";
import { Badge } from "@/components/ui/badge";
import { Cluster, Filler } from "@/components/ui/cluster";
import { Textarea } from "@/components/ui/textarea";
import { parseDsl, type ParseError } from "@/lib/dsl";
// SWAP AT INTEGRATION: replace "@/lib/rama-stub" with "rama".
import { layout, type PositionedGraph } from "@/lib/rama-stub";

const DEBOUNCE_MS = 140;

export interface InspectorProps {
  /** The seed program — identical to what the server rendered. */
  initialSource: string;
  /** The server-computed layout for `initialSource` (avoids a re-layout on mount). */
  initialGraph: PositionedGraph;
}

export function Inspector({ initialSource, initialGraph }: InspectorProps) {
  const [source, setSource] = useState(initialSource);
  const [graph, setGraph] = useState<PositionedGraph>(initialGraph);
  const [error, setError] = useState<ParseError | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recompute = useCallback((nextSource: string) => {
    const { graph: nextGraph, error: nextError } = parseDsl(nextSource);
    setError(nextError);
    // Keep the last good graph when the parse fails but a partial graph exists.
    if (nextGraph.commits.length > 0) {
      setGraph(layout(nextGraph));
    }
  }, []);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      setSource(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => recompute(next), DEBOUNCE_MS);
    },
    [recompute],
  );

  const lineCount = useMemo(() => source.split("\n").length, [source]);

  return (
    <Cluster
      direction="row"
      align="stretch"
      wrap
      className="w-full flex-1 gap-px **:data-[slot=cluster-filler]:hidden lg:flex-nowrap"
    >
      {/* LEFT — editor pane */}
      <Cluster
        direction="col"
        align="stretch"
        className="min-w-0 flex-1 basis-full gap-px lg:basis-1/2"
      >
        <Cluster bg="muted" className="px-4 py-2 text-muted-foreground">
          <Badge variant="muted" size="sm">
            editor
          </Badge>
          <Filler />
          <span className="font-mono text-xs tabular-nums">
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
        </Cluster>

        <label htmlFor="dsl-editor" className="sr-only">
          Commit-graph pseudo-code editor
        </label>
        <Textarea
          id="dsl-editor"
          value={source}
          onChange={handleChange}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "dsl-error" : undefined}
          className="bg-card min-h-[60vh] flex-1 resize-none rounded-none border-0 px-4 py-4 font-mono text-sm leading-relaxed shadow-none focus-visible:ring-0 lg:min-h-0"
        />

        <div aria-live="polite" className="min-h-9">
          {error ? (
            <Cluster bg="muted" className="bg-destructive/15 px-4 py-2">
              <Badge variant="destructive" size="sm">
                line&nbsp;{error.line}
              </Badge>
              <p
                id="dsl-error"
                className="text-destructive min-w-0 truncate font-mono text-xs"
              >
                {error.message}
              </p>
            </Cluster>
          ) : (
            <Cluster bg="muted" className="text-muted-foreground px-4 py-2">
              <p className="font-mono text-xs">
                ok — {graph.nodes.length} commits, {graph.laneCount} lanes
              </p>
            </Cluster>
          )}
        </div>
      </Cluster>

      {/* RIGHT — live preview pane */}
      <Cluster
        direction="col"
        align="stretch"
        className="min-w-0 flex-1 basis-full gap-px lg:basis-1/2"
      >
        <Cluster bg="muted" className="px-4 py-2 text-muted-foreground">
          <Badge variant="muted" size="sm">
            graph
          </Badge>
          <Filler />
          <span className="font-mono text-xs tabular-nums">
            {Math.round(graph.width)}×{Math.round(graph.height)}
          </span>
        </Cluster>

        <div className="bg-card min-h-[60vh] flex-1 overflow-auto p-6 lg:min-h-0">
          <Graph graph={graph} />
        </div>
      </Cluster>
    </Cluster>
  );
}
