'use client'

/**
 * GraphViewport — a pan/zoom/fit canvas around the <Graph> SVG.
 *
 * Hand-rolled (no library), ported from the atlas-cropper pattern: raw wheel +
 * pointer handlers driving a single CSS transform. The outer container clips
 * and captures input; the inner wrapper carries
 * `transform: translate(panX,panY) scale(zoom)` with `transform-origin: 0 0`,
 * so the <Graph> renders at its intrinsic size and the transform alone places
 * and scales it.
 *
 * Following atlas-cropper: pan lives in a ref and is written imperatively to the
 * element's `transform` (no React re-render per pan/zoom-anchor); only `zoom` is
 * React state, since it also drives the controls' percentage readout. `flushSync`
 * commits a zoom change before we read post-resize geometry to re-anchor the pan.
 *
 * Auto-fit only fires on mount and when the fit button is pressed — editing the
 * DSL (new content size) never steals the user's current zoom/pan.
 *
 * Split into a provider + two consumers so the zoom controls can live in a
 * sibling row (e.g. the preview header) instead of overlaid on the canvas. The
 * provider owns all state/handlers and shares them via context; <Canvas> is the
 * pan/zoom surface and <Controls> the +/-/fit buttons. Both must be descendants
 * of the same <GraphViewport> provider.
 *
 * SSR-safe: the server renders the <Graph> inside an identity transform (zoom 1,
 * pan 0). Fit is applied in a post-mount effect, so the first client render
 * matches the server HTML (no hydration mismatch); the transform is just an
 * instant visual adjustment afterwards.
 */

import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { TooltipButton } from '@/components/ui/tooltip-button'
import { cn } from '@/lib/utils'

const ZOOM_MIN = 0.02
const ZOOM_MAX = 5
/** Empty pixels kept around the content when fitting (atlas uses 80 ≈ 40/side). */
const FIT_MARGIN = 80
/** Multiplicative step for the +/- buttons. */
const ZOOM_STEP = 1.2
/** Wheel delta → zoom factor sensitivity (matches atlas-cropper). */
const ZOOM_SENSITIVITY = 0.005

const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))

interface Pan {
  x: number
  y: number
}

interface GraphViewportContextValue {
  zoom: number
  /**
   * The zoom that makes the content fill the pane — what the fit button lands on.
   * The controls display `zoom / fitZoom` as the percentage, so a fitted diagram
   * always reads 100% (whether it was scaled up or down to get there).
   */
  fitZoom: number
  isDragging: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  contentWidth: number
  contentHeight: number
  panRef: React.RefObject<Pan>
  fit: () => void
  zoomByStep: (factor: number) => void
  handlePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  handlePointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  endDrag: (e: React.PointerEvent<HTMLDivElement>) => void
}

const GraphViewportContext = createContext<GraphViewportContextValue | null>(null)

function useGraphViewport(): GraphViewportContextValue {
  const ctx = useContext(GraphViewportContext)
  if (!ctx) {
    throw new Error('GraphViewport.Canvas / GraphViewport.Controls must be used within <GraphViewport>')
  }
  return ctx
}

export interface GraphViewportProps {
  children: ReactNode
  /** Intrinsic content width (graph.width) — drives the fit math. */
  contentWidth: number
  /** Intrinsic content height (graph.height) — drives the fit math. */
  contentHeight: number
}

/**
 * Provider that owns the zoom/pan motor. Wrap both <GraphViewport.Canvas> and
 * <GraphViewport.Controls> with it; they can sit in different parts of the tree.
 */
export function GraphViewport({ children, contentWidth, contentHeight }: GraphViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Identity by default so server HTML and the first client render match.
  // Only `zoom` is state — it drives the controls' percentage readout. Pan lives
  // in a ref and is written imperatively, so panning/zoom-anchoring never
  // re-renders (atlas-cropper pattern).
  const [zoom, setZoom] = useState(1)
  // The fill zoom, updated by fit(). Starts at 1 so the pre-measure percentage
  // reads 100%. The controls divide `zoom` by this so "fitted" always shows 100%.
  const [fitZoom, setFitZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)

  const zoomRef = useRef(zoom)
  const panRef = useRef<Pan>({ x: 0, y: 0 })

  // Live drag bookkeeping (refs, not state, so pointermove stays cheap).
  const dragState = useRef<{ startX: number; startY: number; startPan: Pan } | null>(null)

  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  /** Write the current pan ref to the element transform (zoom comes from state). */
  const applyPan = useCallback(() => {
    const cEl = contentRef.current
    if (!cEl) return
    cEl.style.transform = `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoomRef.current})`
  }, [])

  /** Fit the content to the viewport and center it. Mount + fit button only. */
  const fit = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const { width: vpW, height: vpH } = el.getBoundingClientRect()
    if (vpW === 0 || vpH === 0 || contentWidth === 0 || contentHeight === 0) {
      return
    }
    // Fill the pane: the largest uniform scale that fits width AND height (minus
    // the margin). This becomes the "100%" reference — small diagrams scale up,
    // large ones scale down, both landing on a full-frame fit.
    const nextFit = clampZoom(Math.min((vpW - FIT_MARGIN) / contentWidth, (vpH - FIT_MARGIN) / contentHeight))
    setFitZoom(nextFit)
    setZoom(nextFit)
    zoomRef.current = nextFit
    panRef.current = {
      x: (vpW - contentWidth * nextFit) / 2,
      y: (vpH - contentHeight * nextFit) / 2,
    }
    applyPan()
  }, [contentWidth, contentHeight, applyPan])

  // Auto-fit on mount only. Editing the DSL (new content size) must NOT steal the
  // user's current zoom/pan, so contentWidth/Height are deliberately not deps.
  useEffect(() => {
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Zoom toward an anchor point (in container-local coords), keeping it fixed.
   * `flushSync` commits the zoom (which the transform reads via zoomRef) before
   * we recompute the pan that keeps the anchor's content point under the anchor.
   */
  const zoomToward = useCallback(
    (anchorX: number, anchorY: number, factor: number) => {
      const oldZoom = zoomRef.current
      const newZoom = clampZoom(oldZoom * factor)
      if (newZoom === oldZoom) return

      const pan = panRef.current
      const contentX = (anchorX - pan.x) / oldZoom
      const contentY = (anchorY - pan.y) / oldZoom

      flushSync(() => setZoom(newZoom))
      zoomRef.current = newZoom
      panRef.current = {
        x: anchorX - contentX * newZoom,
        y: anchorY - contentY * newZoom,
      }
      applyPan()
    },
    [applyPan]
  )

  // Wheel zoom, cursor-anchored. Attached imperatively with { passive: false }
  // because React's synthetic onWheel is passive and can't preventDefault.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      const cursorY = e.clientY - rect.top
      zoomToward(cursorX, cursorY, 1 - e.deltaY * ZOOM_SENSITIVITY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomToward])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore drags that start on the controls (buttons).
    if ((e.target as HTMLElement).closest('[data-slot=button]')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPan: panRef.current,
    }
    setIsDragging(true)
  }, [])

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragState.current
      if (!drag) return
      panRef.current = {
        x: drag.startPan.x + (e.clientX - drag.startX),
        y: drag.startPan.y + (e.clientY - drag.startY),
      }
      applyPan()
    },
    [applyPan]
  )

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return
    dragState.current = null
    setIsDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  /** Step zoom toward the viewport center, used by the +/- buttons. */
  const zoomByStep = useCallback(
    (factor: number) => {
      const el = containerRef.current
      if (!el) return
      const { width, height } = el.getBoundingClientRect()
      zoomToward(width / 2, height / 2, factor)
    },
    [zoomToward]
  )

  return (
    <GraphViewportContext.Provider
      value={{
        zoom,
        fitZoom,
        isDragging,
        containerRef,
        contentRef,
        contentWidth,
        contentHeight,
        panRef,
        fit,
        zoomByStep,
        handlePointerDown,
        handlePointerMove,
        endDrag,
      }}
    >
      {children}
    </GraphViewportContext.Provider>
  )
}

export interface GraphViewportCanvasProps {
  /** The <Graph> SVG to display, rendered at its intrinsic size. */
  children: ReactNode
  className?: string
}

/** The pan/zoom surface that clips, captures input, and holds the transform. */
function GraphViewportCanvas({ children, className }: GraphViewportCanvasProps) {
  const {
    isDragging,
    containerRef,
    contentRef,
    contentWidth,
    contentHeight,
    panRef,
    zoom,
    handlePointerDown,
    handlePointerMove,
    endDrag,
  } = useGraphViewport()

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Graph preview — scroll to zoom, drag to pan"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        'relative h-full w-full touch-none overflow-hidden overscroll-contain',
        isDragging ? 'cursor-grabbing select-none' : 'cursor-grab',
        className
      )}
    >
      {/* Inner wrapper carries the transform; origin top-left so the math is
          a plain translate+scale. applyPan() writes the transform imperatively
          during pan/zoom; this inline value (read from the refs at render time)
          keeps a re-render — e.g. the zoom % readout — from clobbering it. */}
      <div
        ref={contentRef}
        data-slot="graph-viewport-content"
        style={{
          transform: `translate(${panRef.current.x}px, ${panRef.current.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          width: contentWidth || undefined,
          height: contentHeight || undefined,
        }}
        className="absolute top-0 left-0"
      >
        {children}
      </div>
    </div>
  )
}

export interface GraphViewportControlsProps {
  className?: string
}

/** Zoom out / % / zoom in / fit. Render anywhere inside the provider. */
function GraphViewportControls({ className }: GraphViewportControlsProps) {
  const { zoom, fitZoom, zoomByStep, fit } = useGraphViewport()
  // Percentage is relative to the fitted size, so a full-frame diagram reads 100%.
  const displayPct = Math.round((zoom / fitZoom) * 100)

  return (
    <div data-slot="graph-viewport-controls" className={cn('flex items-center', className)}>
      <TooltipButton
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom out"
        onClick={() => zoomByStep(1 / ZOOM_STEP)}
        className="h-full"
      >
        <ZoomOut aria-hidden="true" />
      </TooltipButton>
      <span className="text-muted-foreground w-12 text-center font-mono text-xs tabular-nums">{displayPct}%</span>
      <TooltipButton
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom in"
        onClick={() => zoomByStep(ZOOM_STEP)}
        className="h-full"
      >
        <ZoomIn aria-hidden="true" />
      </TooltipButton>
      <TooltipButton
        type="button"
        variant="ghost"
        size="icon-sm"
        tooltip="Fit to view"
        aria-label="Fit to view"
        onClick={fit}
        className="h-full"
      >
        <Maximize aria-hidden="true" />
      </TooltipButton>
    </div>
  )
}

GraphViewport.Canvas = GraphViewportCanvas
GraphViewport.Controls = GraphViewportControls
