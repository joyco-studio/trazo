'use client'

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
 *   - A mode toggle switches between the flow (flowcharts), git (commit DAGs),
 *     sequence (sequence diagrams), and block (block-grid wireframes) DSLs — the
 *     diagram families the JOYCO logs need. Each mode keeps its own source so
 *     toggling never loses your work.
 */

import {
  type EdgeStyle,
  type GitLabelSide,
  type GitOrientation,
  layoutBlock,
  layoutFlow,
  layoutGit,
  layoutSequence,
  parseBlock,
  parseSequence,
  type PositionedGraph,
} from '@joycostudio/trazo'
import { Graph } from '@joycostudio/trazo/react'
import { Check, Copy, Download, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { GraphViewport } from '@/components/graph-viewport'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Cluster, Filler } from '@/components/ui/cluster'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useGraphDocs } from '@/hooks/use-graph-docs'
import { parseDsl, type ParseError, SEED_PROGRAM } from '@/lib/dsl'
import { directionOf, parseFlow, SEED_FLOW } from '@/lib/flow-dsl'
import { SEED_BLOCK, SEED_SEQUENCE } from '@/lib/seeds'

const DEBOUNCE_MS = 140

type Mode = 'git' | 'flow' | 'sequence' | 'block'

/** Git-only layout options surfaced as preview toggles. */
interface GitOptions {
  orientation: GitOrientation
  labelSide: GitLabelSide
}

/** Parse + lay out a source string for a given mode; returns graph + error. */
function build(
  mode: Mode,
  source: string,
  edgeStyle: EdgeStyle,
  git: GitOptions
): {
  graph: PositionedGraph | null
  error: ParseError | null
} {
  if (mode === 'flow') {
    const { graph, error } = parseFlow(source)
    if (graph.nodes.length === 0) return { graph: null, error }
    return {
      graph: layoutFlow(graph, { direction: directionOf(graph), edgeStyle }),
      error,
    }
  }
  if (mode === 'sequence') {
    const { graph, error } = parseSequence(source)
    if (graph.participants.length === 0) return { graph: null, error }
    return { graph: layoutSequence(graph), error }
  }
  if (mode === 'block') {
    const { graph, error } = parseBlock(source)
    if (graph.cells.length === 0) return { graph: null, error }
    return { graph: layoutBlock(graph), error }
  }
  const { graph, error } = parseDsl(source)
  if (graph.commits.length === 0) return { graph: null, error }
  return {
    graph: layoutGit(graph, {
      edgeStyle,
      orientation: git.orientation,
      labelSide: git.labelSide,
    }),
    error,
  }
}

export interface InspectorProps {
  /** Which mode the server rendered (and the initial active tab). */
  initialMode: Mode
  /** The seed source for `initialMode` — identical to what the server rendered. */
  initialSource: string
  /** The server-computed layout for `initialSource` (avoids re-layout on mount). */
  initialGraph: PositionedGraph
}

export function Inspector({ initialMode, initialSource, initialGraph }: InspectorProps) {
  const [mode, setMode] = useState<Mode>(initialMode)
  // Documents per mode (multiple diagrams, localStorage-persisted). The
  // server-rendered mode keeps its exact seed; the others get their defaults —
  // so the first client render matches the SSR markup.
  const {
    docs,
    active,
    restoredAt,
    setSource: setDocSource,
    addDoc,
    selectDoc,
    deleteDoc,
  } = useGraphDocs<Mode>({
    git: initialMode === 'git' ? initialSource : SEED_PROGRAM,
    flow: initialMode === 'flow' ? initialSource : SEED_FLOW,
    sequence: initialMode === 'sequence' ? initialSource : SEED_SEQUENCE,
    block: initialMode === 'block' ? initialSource : SEED_BLOCK,
  })
  // The active mode's graph is seeded from the server; the other lays out lazily.
  const [graph, setGraph] = useState<PositionedGraph>(initialGraph)
  const [error, setError] = useState<ParseError | null>(null)
  // Edge routing. Defaults to "elbow45" — the same default the server used for
  // `initialGraph`, so the first client render matches the SSR markup.
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>('elbow45')
  // Git-only preview options. Defaults ("vertical" / "right") match the server's
  // `initialGraph`, so the first client render stays byte-identical.
  const [git, setGit] = useState<GitOptions>({
    orientation: 'vertical',
    labelSide: 'right',
  })

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const graphRef = useRef<HTMLDivElement>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [svgCopied, setSvgCopied] = useState(false)

  const activeDocs = docs[mode]
  const activeDocId = active[mode]
  const source = (activeDocs.find((d) => d.id === activeDocId) ?? activeDocs[0]).source

  const recompute = useCallback((nextMode: Mode, nextSource: string, nextEdgeStyle: EdgeStyle, nextGit: GitOptions) => {
    const { graph: next, error: nextError } = build(nextMode, nextSource, nextEdgeStyle, nextGit)
    setError(nextError)
    if (next) setGraph(next) // keep last good graph when parse yields nothing
  }, [])

  // After the localStorage restore swaps in persisted docs, the active source
  // may differ from the SSR seed — re-layout it once. Reacting to that
  // external-store restore is the legitimate setState-in-effect case.
  useEffect(() => {
    if (restoredAt === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    recompute(mode, source, edgeStyle, git)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredAt])

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value
      setDocSource(mode, next)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => recompute(mode, next, edgeStyle, git), DEBOUNCE_MS)
    },
    [mode, setDocSource, recompute, edgeStyle, git]
  )

  const handleMode = useCallback(
    (next: string) => {
      const m = next as Mode
      setMode(m)
      const doc = docs[m].find((d) => d.id === active[m]) ?? docs[m][0]
      if (debounceRef.current) clearTimeout(debounceRef.current)
      recompute(m, doc.source, edgeStyle, git) // immediate on an explicit switch
    },
    [recompute, docs, active, edgeStyle, git]
  )

  const handleAddDoc = useCallback(() => {
    const nextSource = addDoc(mode)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    recompute(mode, nextSource, edgeStyle, git)
  }, [addDoc, mode, recompute, edgeStyle, git])

  const handleSelectDoc = useCallback(
    (id: string) => {
      const nextSource = selectDoc(mode, id)
      if (nextSource === null) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      recompute(mode, nextSource, edgeStyle, git)
    },
    [selectDoc, mode, recompute, edgeStyle, git]
  )

  const handleDeleteDoc = useCallback(
    (id: string) => {
      const nextSource = deleteDoc(mode, id)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      recompute(mode, nextSource, edgeStyle, git)
    },
    [deleteDoc, mode, recompute, edgeStyle, git]
  )

  const handleEdgeStyle = useCallback(
    (elbow45: boolean) => {
      const next: EdgeStyle = elbow45 ? 'elbow45' : 'orthogonal'
      setEdgeStyle(next)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      recompute(mode, source, next, git) // re-layout immediately on toggle
    },
    [recompute, mode, source, git]
  )

  const handleOrientation = useCallback(
    (horizontal: boolean) => {
      const next: GitOptions = {
        ...git,
        orientation: horizontal ? 'horizontal' : 'vertical',
      }
      setGit(next)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      recompute(mode, source, edgeStyle, next)
    },
    [recompute, mode, source, edgeStyle, git]
  )

  const handleLabelSide = useCallback(
    (leading: boolean) => {
      const next: GitOptions = {
        ...git,
        labelSide: leading ? 'left' : 'right',
      }
      setGit(next)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      recompute(mode, source, edgeStyle, next)
    },
    [recompute, mode, source, edgeStyle, git]
  )

  const handleCopyCode = useCallback(() => {
    navigator.clipboard
      .writeText(source)
      .then(() => {
        setCodeCopied(true)
        setTimeout(() => setCodeCopied(false), 1500)
      })
      .catch(() => {})
  }, [source])

  const getSvgString = useCallback((): string | null => {
    const svgEl = graphRef.current?.querySelector<SVGElement>('[data-slot="trazo-graph"]')
    if (!svgEl) return null
    return new XMLSerializer().serializeToString(svgEl)
  }, [])

  const handleCopySvg = useCallback(() => {
    const svg = getSvgString()
    if (!svg) return
    navigator.clipboard
      .writeText(svg)
      .then(() => {
        setSvgCopied(true)
        setTimeout(() => setSvgCopied(false), 1500)
      })
      .catch(() => {})
  }, [getSvgString])

  const handleDownloadSvg = useCallback(() => {
    const svg = getSvgString()
    if (!svg) return
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trazo-${mode}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }, [getSvgString, mode])

  const lineCount = useMemo(() => source.split('\n').length, [source])
  // The noun for the left-pane status count + the editor/preview labels, per mode.
  const unit = mode === 'git' ? 'commits' : mode === 'block' ? 'cells' : 'nodes'
  const modeLabel: Record<Mode, string> = {
    flow: 'Flowchart',
    git: 'Commit graph',
    sequence: 'Sequence diagram',
    block: 'Block grid',
  }

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
      <Cluster direction="col" align="stretch" className="min-w-0 flex-1 basis-full gap-px lg:basis-1/2">
        <Cluster bg="muted" align="center" className="bg-muted text-muted-foreground py-gap gap-3">
          <Tabs value={mode} onValueChange={handleMode}>
            <TabsList>
              <TabsTrigger value="flow">flowchart</TabsTrigger>
              <TabsTrigger value="git">git</TabsTrigger>
              <TabsTrigger value="sequence">sequence</TabsTrigger>
              <TabsTrigger value="block">block</TabsTrigger>
            </TabsList>
          </Tabs>
          <span aria-hidden="true" className="bg-border h-4 w-px self-center" />
          {/* Per-mode documents: switch, start a fresh one from the seed, or
            delete the current one — all persisted to localStorage. */}
          <div role="group" aria-label="Diagram documents" className="flex items-center gap-0.5">
            {activeDocs.map((doc, i) => (
              <Button
                key={doc.id}
                variant={doc.id === activeDocId ? 'secondary' : 'ghost'}
                size="icon-sm"
                onClick={() => handleSelectDoc(doc.id)}
                aria-pressed={doc.id === activeDocId}
                aria-label={`Open document ${i + 1}`}
                className="text-muted-foreground size-6 font-mono text-xs tabular-nums"
              >
                {i + 1}
              </Button>
            ))}
            {activeDocs.length > 1 ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => handleDeleteDoc(activeDocId)}
                aria-label="Delete current document"
                className="text-muted-foreground size-6"
              >
                <X />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleAddDoc}
              aria-label="New document from the seed"
              className="text-muted-foreground size-6"
            >
              <Plus />
            </Button>
          </div>
          <Filler />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCopyCode}
            aria-label={codeCopied ? 'Copied' : 'Copy code'}
            className="text-muted-foreground"
          >
            {codeCopied ? <Check /> : <Copy />}
          </Button>
          <span className="font-mono text-xs tabular-nums">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
        </Cluster>

        <label htmlFor="dsl-editor" className="sr-only">
          {modeLabel[mode]} pseudo-code editor
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
          aria-describedby={error ? 'dsl-error' : undefined}
          className="bg-card min-h-[55vh] flex-1 resize-none rounded-none border-0 px-4 py-4 font-mono text-sm leading-relaxed shadow-none focus-visible:ring-0 lg:min-h-0"
        />

        <div aria-live="polite" className="contents">
          {error ? (
            <Cluster align="center" className="bg-destructive/15 px-3 py-2">
              <Badge variant="destructive" size="sm">
                line&nbsp;{error.line}
              </Badge>
              <p id="dsl-error" className="text-destructive min-w-0 truncate font-mono text-xs">
                {error.message}
              </p>
            </Cluster>
          ) : (
            <Cluster align="center" className="bg-card text-muted-foreground px-3 py-2">
              <span className="bg-mint-green inline-block size-2 rounded-full" aria-hidden="true" />
              <p className="font-mono text-xs">
                {graph.nodes.length} {unit} · {graph.edges.length} edges
              </p>
            </Cluster>
          )}
        </div>
      </Cluster>

      {/* RIGHT — live preview pane */}
      <Cluster direction="col" align="stretch" className="min-w-0 flex-1 basis-full gap-px lg:basis-1/2">
        <GraphViewport contentWidth={graph.width} contentHeight={graph.height}>
          <Cluster bg="muted" align="center" className="bg-muted text-muted-foreground py-gap gap-3">
            <Badge variant="muted" size="sm">
              preview
            </Badge>
            <GraphViewport.Controls />
            <Filler />
            {/* Git-only: orientation + label-side toggles. Hidden in flow mode
              since they only affect the commit-lane layout. */}
            {mode === 'git' ? (
              <>
                {/* Orientation: off = vertical (default), on = horizontal. */}
                <label className="flex cursor-pointer items-center gap-2">
                  <span className="font-mono text-xs tracking-wide uppercase">horiz</span>
                  <Switch
                    checked={git.orientation === 'horizontal'}
                    onCheckedChange={handleOrientation}
                    aria-label="Toggle horizontal git layout (off = vertical)"
                  />
                </label>
                {/* Label side: off = trailing (right/below), on = leading (left/above). */}
                <label className="flex cursor-pointer items-center gap-2">
                  <span className="font-mono text-xs tracking-wide uppercase">
                    {git.orientation === 'horizontal' ? 'above' : 'left'}
                  </span>
                  <Switch
                    checked={git.labelSide === 'left'}
                    onCheckedChange={handleLabelSide}
                    aria-label={
                      git.orientation === 'horizontal'
                        ? 'Toggle labels above the commits (off = below)'
                        : 'Toggle labels left of the commits (off = right)'
                    }
                  />
                </label>
                <span aria-hidden="true" className="bg-border h-4 w-px self-center" />
              </>
            ) : null}
            {/* Edge-style toggle: on = 45° diagonals, off = 90° orthogonal. Only
              flow + git honor it; sequence uses fixed orthogonal and block has
              no edges, so hide it there. */}
            {mode === 'flow' || mode === 'git' ? (
              <>
                <label className="flex cursor-pointer items-center gap-2">
                  <span className="font-mono text-xs tracking-wide uppercase">45°</span>
                  <Switch
                    checked={edgeStyle === 'elbow45'}
                    onCheckedChange={handleEdgeStyle}
                    aria-label="Toggle 45° edges (off = 90° orthogonal)"
                  />
                </label>
                <span aria-hidden="true" className="bg-border h-4 w-px self-center" />
              </>
            ) : null}
            <span className="font-mono text-xs tabular-nums">
              {Math.round(graph.width)}×{Math.round(graph.height)}
            </span>
            <span aria-hidden="true" className="bg-border h-4 w-px self-center" />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleCopySvg}
              aria-label={svgCopied ? 'SVG copied' : 'Copy SVG'}
              className="text-muted-foreground"
            >
              {svgCopied ? <Check /> : <Copy />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleDownloadSvg}
              aria-label="Download SVG"
              className="text-muted-foreground"
            >
              <Download />
            </Button>
          </Cluster>

          {/* The preview surface is `bg-card`, not the page background — so point
            the <Graph> node-border token (`--trazo-bg`) at the card color too,
            or the bg-colored chip seam shows as a ring against this panel. */}
          <div
            ref={graphRef}
            className="bg-card relative min-h-[55vh] flex-1 [--trazo-bg:var(--color-card)] lg:min-h-0"
          >
            <GraphViewport.Canvas>
              <Graph graph={graph} title={modeLabel[mode]} />
            </GraphViewport.Canvas>
          </div>
        </GraphViewport>
      </Cluster>
    </Cluster>
  )
}
