'use client'

import { useMemo } from 'react'

import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'

import { formatOklch, OKLCH_MAX, oklchToHex, type OklchValue,parseOklch } from './oklch'

interface OklchPickerProps {
  /** Current color as an `oklch(L C H)` string. */
  value: string
  /** Called with the next `oklch(L C H)` string on any axis change. */
  onChange: (next: string) => void
  /** Accessible name for the trigger swatch (e.g. "Primary color"). */
  label: string
}

/** Per-axis slider: label, gradient track, value, and a numeric input. */
function AxisSlider({
  axis,
  value,
  max,
  step,
  gradient,
  onChange,
}: {
  axis: 'L' | 'C' | 'H'
  value: number
  max: number
  step: number
  /** CSS gradient string painted behind the track to preview the axis. */
  gradient: string
  onChange: (next: number) => void
}) {
  return (
    <label className="grid grid-cols-[1ch_1fr_3.5rem] items-center gap-2">
      <span className="text-muted-foreground font-mono text-xs">{axis}</span>
      <Slider
        value={[value]}
        min={0}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next ?? 0)}
        aria-label={`${axis} channel`}
        className="**:data-[slot=slider-track]:h-3 **:data-[slot=slider-track]:rounded-full **:data-[slot=slider-track]:[background-image:var(--axis-gradient)] **:data-[slot=slider-range]:bg-transparent **:data-[slot=slider-thumb]:h-4 **:data-[slot=slider-thumb]:w-4 **:data-[slot=slider-thumb]:rounded-full **:data-[slot=slider-thumb]:border-2 **:data-[slot=slider-thumb]:bg-white"
        style={{ '--axis-gradient': gradient } as React.CSSProperties}
      />
      <Input
        type="number"
        value={value}
        min={0}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number.parseFloat(event.target.value)
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(0, next)))
        }}
        aria-label={`${axis} value`}
        className="h-7 px-2 font-mono text-xs tabular-nums"
      />
    </label>
  )
}

/**
 * OKLCH color picker rendered in a Popover. A swatch button opens three sliders
 * (Lightness, Chroma, Hue) with gradient tracks; values round-trip as canonical
 * `oklch(L C H)` strings. The swatch fill is gamut-mapped to sRGB for display.
 */
export function OklchPicker({ value, onChange, label }: OklchPickerProps) {
  const parsed = useMemo<OklchValue>(() => parseOklch(value) ?? { l: 0, c: 0, h: 0 }, [value])
  const swatchHex = useMemo(() => oklchToHex(parsed), [parsed])

  const update = (patch: Partial<OklchValue>) => onChange(formatOklch({ ...parsed, ...patch }))

  // Track gradients: each sweeps the edited axis while holding the other two,
  // so the slider previews exactly where each value lands.
  const lGradient = `linear-gradient(to right, oklch(0 ${parsed.c} ${parsed.h}), oklch(1 ${parsed.c} ${parsed.h}))`
  const cGradient = `linear-gradient(to right, oklch(${parsed.l} 0 ${parsed.h}), oklch(${parsed.l} ${OKLCH_MAX.c} ${parsed.h}))`
  const hGradient = `linear-gradient(to right, oklch(${parsed.l} ${parsed.c} 0), oklch(${parsed.l} ${parsed.c} 90), oklch(${parsed.l} ${parsed.c} 180), oklch(${parsed.l} ${parsed.c} 270), oklch(${parsed.l} ${parsed.c} 360))`

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label} (edit)`}
        className="focus-visible:ring-ring border-border size-7 shrink-0 cursor-pointer rounded-md border focus-visible:ring-2 focus-visible:outline-none"
        style={{ backgroundColor: swatchHex }}
      />
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="border-border size-6 shrink-0 rounded-md border"
            style={{ backgroundColor: swatchHex }}
          />
          <span className="truncate text-xs font-medium">{label}</span>
        </div>
        <AxisSlider
          axis="L"
          value={parsed.l}
          max={OKLCH_MAX.l}
          step={0.001}
          gradient={lGradient}
          onChange={(l) => update({ l })}
        />
        <AxisSlider
          axis="C"
          value={parsed.c}
          max={OKLCH_MAX.c}
          step={0.001}
          gradient={cGradient}
          onChange={(c) => update({ c })}
        />
        <AxisSlider
          axis="H"
          value={parsed.h}
          max={OKLCH_MAX.h}
          step={1}
          gradient={hGradient}
          onChange={(h) => update({ h })}
        />
      </PopoverContent>
    </Popover>
  )
}
