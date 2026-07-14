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
  type GitLabelSide,
  type GitOrientation,
  layoutBlock,
  layoutFlow,
  layoutGit,
  layoutSequence,
  parseBlock,
  parseSequence,
  type PositionedGraph,
  themeFlowOptions,
  themeGitOptions,
  type TrazoTheme,
} from '@joycostudio/trazo'
import { Graph } from '@joycostudio/trazo/react'
import { Check, Copy, Download, Plus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CodeEditor } from '@/components/code-editor'
import { GraphViewport } from '@/components/graph-viewport'
import { ThemePanel } from '@/components/theme-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Cluster, Filler } from '@/components/ui/cluster'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipButton } from '@/components/ui/tooltip-button'
import { useGraphDocs } from '@/hooks/use-graph-docs'
import { useThemeUrl } from '@/hooks/use-theme-url'
import { parseDsl, type ParseError, SEED_PROGRAM } from '@/lib/dsl'
import { directionOf, parseFlow, SEED_FLOW } from '@/lib/flow-dsl'
import { SEED_BLOCK, SEED_SEQUENCE } from '@/lib/seeds'
import { DEFAULT_THEME } from '@/lib/themes'

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
  theme: TrazoTheme,
  git: GitOptions
): {
  graph: PositionedGraph | null
  error: ParseError | null
} {
  if (mode === 'flow') {
    const { graph, error } = parseFlow(source)
    if (graph.nodes.length === 0) return { graph: null, error }
    return {
      // maxNodeWidth wraps runaway labels (mermaid parity) — see docs.
      graph: layoutFlow(graph, themeFlowOptions(theme, { direction: directionOf(graph), maxNodeWidth: 260 })),
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
    graph: layoutGit(
      graph,
      themeGitOptions(theme, {
        orientation: git.orientation,
        labelSide: git.labelSide,
        // Ellipsis-truncate runaway commit subjects (like real git UIs).
        maxLabelWidth: 420,
      })
    ),
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
  // The active TrazoTheme. Defaults to the JOYCO preset — the SAME theme the
  // server laid out `initialGraph` with, so the first client render matches
  // the SSR markup. Editing any knob forks it into "custom".
  const [theme, setTheme] = useState<TrazoTheme>(DEFAULT_THEME)
  const [presetName, setPresetName] = useState(DEFAULT_THEME.name ?? 'custom')
  // Git-only preview options. The server's `initialGraph` is a FLOW seed, so the
  // git orientation only takes effect once the user switches to git mode — no SSR
  // mismatch. We default to "horizontal": that's where the branch-lane labels
  // (`main:` / `feature-x:`) live, so a multi-branch history reads like git log.
  const [git, setGit] = useState<GitOptions>({
    orientation: 'horizontal',
    labelSide: 'right',
  })

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const graphRef = useRef<HTMLDivElement>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [svgCopied, setSvgCopied] = useState(false)

  const activeDocs = docs[mode]
  const activeDocId = active[mode]
  const source = (activeDocs.find((d) => d.id === activeDocId) ?? activeDocs[0]).source

  const recompute = useCallback((nextMode: Mode, nextSource: string, nextTheme: TrazoTheme, nextGit: GitOptions) => {
    const { graph: next, error: nextError } = build(nextMode, nextSource, nextTheme, nextGit)
    setError(nextError)
    if (next) setGraph(next) // keep last good graph when parse yields nothing
  }, [])

  // After the localStorage restore swaps in persisted docs, the active source
  // may differ from the SSR seed — re-layout it once. Reacting to that
  // external-store restore is the legitimate setState-in-effect case.
  useEffect(() => {
    if (restoredAt === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    recompute(mode, source, theme, git)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoredAt])

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = event.target.value
      setDocSource(mode, next)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => recompute(mode, next, theme, git), DEBOUNCE_MS)
    },
    [mode, setDocSource, recompute, theme, git]
  )

  const handleMode = useCallback(
    (next: string) => {
      const m = next as Mode
      setMode(m)
      const doc = docs[m].find((d) => d.id === active[m]) ?? docs[m][0]
      if (debounceRef.current) clearTimeout(debounceRef.current)
      recompute(m, doc.source, theme, git) // immediate on an explicit switch
    },
    [recompute, docs, active, theme, git]
  )

  const handleAddDoc = useCallback(() => {
    const nextSource = addDoc(mode)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    recompute(mode, nextSource, theme, git)
  }, [addDoc, mode, recompute, theme, git])

  const handleSelectDoc = useCallback(
    (id: string) => {
      const nextSource = selectDoc(mode, id)
      if (nextSource === null) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      recompute(mode, nextSource, theme, git)
    },
    [selectDoc, mode, recompute, theme, git]
  )

  const handleDeleteDoc = useCallback(
    (id: string) => {
      const nextSource = deleteDoc(mode, id)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      recompute(mode, nextSource, theme, git)
    },
    [deleteDoc, mode, recompute, theme, git]
  )

  const handleTheme = useCallback(
    (nextTheme: TrazoTheme, nextPresetName: string) => {
      setTheme(nextTheme)
      setPresetName(nextPresetName)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      recompute(mode, source, nextTheme, git) // re-layout immediately on edit
    },
    [recompute, mode, source, git]
  )

  // Shareable themes: ?theme=<base64url> round-trips the full theme object.
  useThemeUrl(theme, presetName, DEFAULT_THEME, handleTheme)

  const handleOrientation = useCallback(
    (horizontal: boolean) => {
      const next: GitOptions = {
        ...git,
        orientation: horizontal ? 'horizontal' : 'vertical',
      }
      setGit(next)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      recompute(mode, source, theme, next)
    },
    [recompute, mode, source, theme, git]
  )

  const handleLabelSide = useCallback(
    (leading: boolean) => {
      const next: GitOptions = {
        ...git,
        labelSide: leading ? 'left' : 'right',
      }
      setGit(next)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      recompute(mode, source, theme, next)
    },
    [recompute, mode, source, theme, git]
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
    <Cluster
      id="inspector"
      direction="col"
      align="stretch"
      className="w-full flex-1 lg:grid lg:grid-flow-col lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:grid-rows-[2rem_1fr_auto]"
    >
      {/* LEFT — editor pane */}
      <Cluster bg="muted" align="center" className="h-8 *:h-full">
        <Tabs value={mode} onValueChange={handleMode}>
          <TabsList>
            <TabsTrigger value="flow">flowchart</TabsTrigger>
            <TabsTrigger value="git">git</TabsTrigger>
            <TabsTrigger value="sequence">sequence</TabsTrigger>
            <TabsTrigger value="block">block</TabsTrigger>
          </TabsList>
        </Tabs>
        {/* Per-mode documents: switch, start a fresh one from the seed, or
            delete the current one — all persisted to localStorage. */}
        <Cluster bg="accent" role="group" aria-label="Diagram documents" className="h-full *:h-full">
          {activeDocs.map((doc, i) => (
            <Button
              key={doc.id}
              variant={doc.id === activeDocId ? 'secondary' : 'muted'}
              size="icon-sm"
              onClick={() => handleSelectDoc(doc.id)}
              aria-pressed={doc.id === activeDocId}
              aria-label={`Open document ${i + 1}`}
              className="text-muted-foreground font-mono text-xs tabular-nums"
            >
              {i + 1}
            </Button>
          ))}
          {activeDocs.length > 1 ? (
            <TooltipButton
              variant="muted"
              size="icon-sm"
              onClick={() => handleDeleteDoc(activeDocId)}
              aria-label="Delete current document"
              className="text-muted-foreground"
            >
              <X />
            </TooltipButton>
          ) : null}
          <TooltipButton
            variant="muted"
            size="icon-sm"
            onClick={handleAddDoc}
            tooltip="New document"
            aria-label="New document from the seed"
            className="text-muted-foreground"
          >
            <Plus />
          </TooltipButton>
        </Cluster>
        <Filler />
        <TooltipButton
          variant="muted"
          size="icon-sm"
          onClick={handleCopyCode}
          aria-label={codeCopied ? 'Copied' : 'Copy code'}
        >
          {codeCopied ? <Check /> : <Copy />}
        </TooltipButton>
        <span className="flex items-center px-3 font-mono text-xs tabular-nums">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'}
        </span>
      </Cluster>

      <label htmlFor="dsl-editor" className="sr-only">
        {modeLabel[mode]} pseudo-code editor
      </label>
      <CodeEditor
        id="dsl-editor"
        value={source}
        onChange={handleChange}
        mode={mode}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'dsl-error' : undefined}
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

      {/* RIGHT — live preview pane */}
      <GraphViewport contentWidth={graph.width} contentHeight={graph.height}>
        <Cluster bg="muted" className="h-8">
          <div className="text-muted-foreground flex items-center px-3 text-xs uppercase">preview</div>
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
          {/* Theme editor: presets + knobs + tokens + export. Lanes mode
              replaced the old 45° switch (angular = elbow45). */}
          <ThemePanel theme={theme} presetName={presetName} onThemeChange={handleTheme} />
          <span className="flex items-center px-2 font-mono text-xs tabular-nums">
            {Math.round(graph.width)}×{Math.round(graph.height)}
          </span>
          <TooltipButton
            variant="muted"
            size="icon-sm"
            onClick={handleCopySvg}
            aria-label={svgCopied ? 'SVG copied' : 'Copy SVG'}
          >
            {svgCopied ? <Check /> : <Copy />}
          </TooltipButton>
          <TooltipButton
            variant="muted"
            size="icon-sm"
            onClick={handleDownloadSvg}
            tooltip="Download SVG"
            aria-label="Download SVG"
          >
            <Download />
          </TooltipButton>
        </Cluster>

        {/* The preview surface is `bg-card`, not the page background — so point
            the <Graph> node-border token (`--trazo-bg`) at the card color too,
            or the bg-colored chip seam shows as a ring against this panel.
            (Themes that paint their own canvas re-point --trazo-bg at the
            canvas color from inside resolveThemePaint.) */}
        <div ref={graphRef} className="relative min-h-[55vh] flex-1 bg-transparent lg:row-span-2 lg:min-h-0">
          {/* The framed label + number chips — HTML around the diagram (the
              theme reserves `frame` so in-SVG rendering can come later). */}
          {theme.frame?.label || theme.frame?.number ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2 font-mono text-xs tracking-wide"
            >
              <span
                className="truncate px-2 py-0.5"
                style={{
                  backgroundColor: theme.tokens?.accent ?? 'var(--color-accent)',
                  color: theme.tokens?.['accent-foreground'] ?? 'var(--color-accent-foreground)',
                }}
              >
                {theme.frame?.label}
              </span>
              {theme.frame?.number ? (
                <span
                  className="px-2 py-0.5 tabular-nums"
                  style={{
                    backgroundColor: theme.tokens?.accent ?? 'var(--color-accent)',
                    color: theme.tokens?.['accent-foreground'] ?? 'var(--color-accent-foreground)',
                  }}
                >
                  {theme.frame.number}
                </span>
              ) : null}
            </div>
          ) : null}
          {/* The canvas sits in an inset layer: when the frame chips are on,
              the fit viewport starts BELOW them so the graph never underlaps
              the chips. className-only toggle — no remount, pan/zoom survive. */}
          <div className={theme.frame?.label || theme.frame?.number ? 'absolute inset-0 top-12' : 'absolute inset-0'}>
            <GraphViewport.Canvas>
              <Graph graph={graph} title={modeLabel[mode]} theme={theme} />
            </GraphViewport.Canvas>
          </div>
        </div>
      </GraphViewport>
    </Cluster>
  )
}
