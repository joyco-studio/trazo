"use client";

/**
 * Inspector — the client island that makes playground "live".
 *
 * Architecture (the whole point of playground):
 *   - The SERVER already rendered the editor + the graph for the seed program
 *     into the initial HTML (see app/page.tsx). This island hydrates over that
 *     markup, seeded with the SAME source + server-computed layout, so the
 *     first client render is byte-identical → no hydration mismatch, no flicker.
 *   - On each edit we re-parse → layout() → re-render <Graph> IN THE BROWSER,
 *     debounced. No server round-trip per keystroke.
 *   - Parse errors keep the LAST GOOD graph on screen with a friendly inline
 *     message.
 *   - A mode toggle switches between the git DSL (commit DAGs) and the flow DSL
 *     (flowcharts) — the two diagram families the JOYCO logs need. Each mode
 *     keeps its own source so toggling never loses your work.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  type EdgeStyle,
  layoutFlow,
  layoutGit,
  type PositionedGraph,
} from "trazo";
import { Graph } from "trazo/react";

import { GraphViewport } from "@/components/graph-viewport";
import { Badge } from "@/components/ui/badge";
import { Cluster, Filler } from "@/components/ui/cluster";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { parseDsl, type ParseError, SEED_PROGRAM } from "@/lib/dsl";
import { directionOf, parseFlow, SEED_FLOW } from "@/lib/flow-dsl";

const DEBOUNCE_MS = 140;

type Mode = "git" | "flow";

/** Parse + lay out a source string for a given mode; returns graph + error. */
function build(
  mode: Mode,
  source: string,
  edgeStyle: EdgeStyle,
): {
  graph: PositionedGraph | null;
  error: ParseError | null;
} {
  if (mode === "flow") {
    const { graph, error } = parseFlow(source);
    if (graph.nodes.length === 0) return { graph: null, error };
    return {
      graph: layoutFlow(graph, { direction: directionOf(graph), edgeStyle }),
      error,
    };
  }
  const { graph, error } = parseDsl(source);
  if (graph.commits.length === 0) return { graph: null, error };
  return { graph: layoutGit(graph, { edgeStyle }), error };
}

export interface InspectorProps {
  /** Which mode the server rendered (and the initial active tab). */
  initialMode: Mode;
  /** The seed source for `initialMode` — identical to what the server rendered. */
  initialSource: string;
  /** The server-computed layout for `initialSource` (avoids re-layout on mount). */
  initialGraph: PositionedGraph;
}

export function Inspector({
  initialMode,
  initialSource,
  initialGraph,
}: InspectorProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  // One source per mode so switching tabs preserves each editor's content. The
  // server-rendered mode keeps its exact seed; the other gets its default.
  const [sources, setSources] = useState<Record<Mode, string>>({
    git: initialMode === "git" ? initialSource : SEED_PROGRAM,
    flow: initialMode === "flow" ? initialSource : SEED_FLOW,
  });
  // The active mode's graph is seeded from the server; the other lays out lazily.
  const [graph, setGraph] = useState<PositionedGraph>(initialGraph);
  const [error, setError] = useState<ParseError | null>(null);
  // Edge routing. Defaults to "elbow45" — the same default the server used for
  // `initialGraph`, so the first client render matches the SSR markup.
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>("elbow45");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const source = sources[mode];

  const recompute = useCallback(
    (nextMode: Mode, nextSource: string, nextEdgeStyle: EdgeStyle) => {
      const { graph: next, error: nextError } = build(
        nextMode,
        nextSource,
        nextEdgeStyle,
      );
      setError(nextError);
      if (next) setGraph(next); // keep last good graph when parse yields nothing
    },
    [],
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value;
      setSources((prev) => ({ ...prev, [mode]: next }));
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        () => recompute(mode, next, edgeStyle),
        DEBOUNCE_MS,
      );
    },
    [mode, recompute, edgeStyle],
  );

  const handleMode = useCallback(
    (next: string) => {
      const m = next as Mode;
      setMode(m);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      recompute(m, sources[m], edgeStyle); // immediate on an explicit switch
    },
    [recompute, sources, edgeStyle],
  );

  const handleEdgeStyle = useCallback(
    (elbow45: boolean) => {
      const next: EdgeStyle = elbow45 ? "elbow45" : "orthogonal";
      setEdgeStyle(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      recompute(mode, source, next); // re-layout immediately on toggle
    },
    [recompute, mode, source],
  );

  const lineCount = useMemo(() => source.split("\n").length, [source]);
  const unit = mode === "flow" ? "nodes" : "commits";

  return (
    // Two bento panes. The wrapper is transparent; the gap-px seams reveal the
    // page's bg-muted field between the solid (bg-card / bg-muted) cells.
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
        <Cluster bg="muted" align="center" className="bg-muted text-muted-foreground gap-3 px-3 py-1.5">
          <Tabs value={mode} onValueChange={handleMode}>
            <TabsList>
              <TabsTrigger value="flow">flowchart</TabsTrigger>
              <TabsTrigger value="git">git</TabsTrigger>
            </TabsList>
          </Tabs>
          <Filler />
          <span className="font-mono text-xs tabular-nums">
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
        </Cluster>

        <label htmlFor="dsl-editor" className="sr-only">
          {mode === "flow" ? "Flowchart" : "Commit-graph"} pseudo-code editor
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
          className="bg-card min-h-[55vh] flex-1 resize-none rounded-none border-0 px-4 py-4 font-mono text-sm leading-relaxed shadow-none focus-visible:ring-0 lg:min-h-0"
        />

        <div aria-live="polite" className="contents">
          {error ? (
            <Cluster align="center" className="bg-destructive/15 px-3 py-2">
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
            <Cluster align="center" className="bg-card text-muted-foreground px-3 py-2">
              <span
                className="bg-mint-green inline-block size-2 rounded-full"
                aria-hidden="true"
              />
              <p className="font-mono text-xs">
                {graph.nodes.length} {unit} · {graph.edges.length} edges
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
        <Cluster bg="muted" align="center" className="bg-muted text-muted-foreground gap-3 px-3 py-2">
          <Badge variant="muted" size="sm">
            preview
          </Badge>
          <Filler />
          {/* Edge-style toggle: on = 45° diagonals, off = 90° orthogonal. */}
          <label className="flex cursor-pointer items-center gap-2">
            <span className="font-mono text-xs tracking-wide uppercase">45°</span>
            <Switch
              checked={edgeStyle === "elbow45"}
              onCheckedChange={handleEdgeStyle}
              aria-label="Toggle 45° edges (off = 90° orthogonal)"
            />
          </label>
          <span
            aria-hidden="true"
            className="bg-border h-4 w-px self-center"
          />
          <span className="font-mono text-xs tabular-nums">
            {Math.round(graph.width)}×{Math.round(graph.height)}
          </span>
        </Cluster>

        <div className="bg-card relative min-h-[55vh] flex-1 lg:min-h-0">
          <GraphViewport contentWidth={graph.width} contentHeight={graph.height}>
            <Graph
              graph={graph}
              title={mode === "flow" ? "Flowchart" : "Commit graph"}
            />
          </GraphViewport>
        </div>
      </Cluster>
    </Cluster>
  );
}
