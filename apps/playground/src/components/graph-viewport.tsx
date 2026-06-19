"use client";

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
 * SSR-safe: the server renders the <Graph> inside an identity transform (zoom 1,
 * pan 0). Fit is applied in a post-mount effect, so the first client render
 * matches the server HTML (no hydration mismatch); the transform is just an
 * instant visual adjustment afterwards.
 */

import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 5;
/** Empty pixels kept around the content when fitting. */
const FIT_MARGIN = 48;
/** Multiplicative step for the +/- buttons. */
const ZOOM_STEP = 1.2;

const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

interface Pan {
  x: number;
  y: number;
}

export interface GraphViewportProps {
  /** The <Graph> SVG to display, rendered at its intrinsic size. */
  children: ReactNode;
  /** Intrinsic content width (graph.width) — drives the fit math. */
  contentWidth: number;
  /** Intrinsic content height (graph.height) — drives the fit math. */
  contentHeight: number;
  className?: string;
}

export function GraphViewport({
  children,
  contentWidth,
  contentHeight,
  className,
}: GraphViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Identity by default so server HTML and the first client render match.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // Live drag bookkeeping (refs, not state, so pointermove stays cheap).
  const dragState = useRef<{ startX: number; startY: number; startPan: Pan } | null>(
    null,
  );

  /** Compute the fit transform for the current container + content size. */
  const computeFit = useCallback((): { zoom: number; pan: Pan } | null => {
    const el = containerRef.current;
    if (!el) return null;
    const { width: vpW, height: vpH } = el.getBoundingClientRect();
    if (vpW === 0 || vpH === 0 || contentWidth === 0 || contentHeight === 0) {
      return null;
    }
    // Don't upscale past 100% just to fill the pane.
    const fitZoom = Math.min(
      1,
      Math.max(
        ZOOM_MIN,
        Math.min(
          (vpW - FIT_MARGIN) / contentWidth,
          (vpH - FIT_MARGIN) / contentHeight,
        ),
      ),
    );
    return {
      zoom: fitZoom,
      pan: {
        x: (vpW - contentWidth * fitZoom) / 2,
        y: (vpH - contentHeight * fitZoom) / 2,
      },
    };
  }, [contentWidth, contentHeight]);

  const fit = useCallback(() => {
    const next = computeFit();
    if (!next) return;
    setZoom(next.zoom);
    setPan(next.pan);
  }, [computeFit]);

  // A single effect handles every fit trigger:
  //  - mount: ResizeObserver fires its callback once on `observe`, with the
  //    initial container size.
  //  - container resize: subsequent observer callbacks (responsive panes,
  //    window resize).
  //  - new graph: `fit` is recreated when contentWidth/Height change (via
  //    computeFit), re-running this effect, which re-observes and re-fits.
  // fit() (which calls setState) runs inside the observer callback, never
  // synchronously in the effect body — so no cascading-render on mount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      const id = requestAnimationFrame(() => fit());
      return () => cancelAnimationFrame(id);
    }
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  /** Zoom toward an anchor point (in container-local coords), keeping it fixed. */
  const zoomToward = useCallback(
    (anchorX: number, anchorY: number, factor: number) => {
      setZoom((prevZoom) => {
        const nextZoom = clampZoom(prevZoom * factor);
        if (nextZoom === prevZoom) return prevZoom;
        setPan((prevPan) => {
          const contentX = (anchorX - prevPan.x) / prevZoom;
          const contentY = (anchorY - prevPan.y) / prevZoom;
          return {
            x: anchorX - contentX * nextZoom,
            y: anchorY - contentY * nextZoom,
          };
        });
        return nextZoom;
      });
    },
    [],
  );

  // Wheel zoom, cursor-anchored. Attached imperatively with { passive: false }
  // because React's synthetic onWheel is passive and can't preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      zoomToward(cursorX, cursorY, 1 - e.deltaY * 0.0015);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomToward]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Ignore drags that start on the controls (buttons).
      if ((e.target as HTMLElement).closest("[data-slot=button]")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPan: pan,
      };
      setIsDragging(true);
    },
    [pan],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    setPan({
      x: drag.startPan.x + (e.clientX - drag.startX),
      y: drag.startPan.y + (e.clientY - drag.startY),
    });
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    dragState.current = null;
    setIsDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  /** Step zoom toward the viewport center, used by the +/- buttons. */
  const zoomByStep = useCallback(
    (factor: number) => {
      const el = containerRef.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      zoomToward(width / 2, height / 2, factor);
    },
    [zoomToward],
  );

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
        "relative h-full w-full touch-none overflow-hidden overscroll-contain",
        isDragging ? "cursor-grabbing select-none" : "cursor-grab",
        className,
      )}
    >
      {/* Inner wrapper carries the transform; origin top-left so the math is
          a plain translate+scale. */}
      <div
        data-slot="graph-viewport-content"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          width: contentWidth || undefined,
          height: contentHeight || undefined,
        }}
        className="absolute top-0 left-0"
      >
        {children}
      </div>

      {/* CONTROLS — overlaid bottom-left. */}
      <div
        data-slot="graph-viewport-controls"
        className="bg-card/90 absolute bottom-3 left-3 flex items-center gap-1 rounded-md border p-1 shadow-xs backdrop-blur-sm"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => zoomByStep(1 / ZOOM_STEP)}
        >
          <ZoomOut aria-hidden="true" />
        </Button>
        <span className="text-muted-foreground w-12 text-center font-mono text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() => zoomByStep(ZOOM_STEP)}
        >
          <ZoomIn aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Fit to view"
          onClick={fit}
        >
          <Maximize aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
