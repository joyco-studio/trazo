'use client'

/**
 * ThemePanel — the playground's theme editor, in a right-hand sheet.
 *
 * Edits ONE TrazoTheme object: preset picker (joyco / soft), the geometry and
 * style knobs (padding, roundness, lanes mode, lane style, lane gap,
 * background, border), the framed label/number chips, and every color token
 * (role pairs + surfaces + git lanes). Any edit forks the active preset into
 * "custom" (copy-on-write — presets themselves are immutable). Export copies
 * the theme as JSON (for `<Graph theme>`) or as a `--trazo-*` CSS block.
 */

import {
  contrastForeground,
  type ThemeBackground,
  type ThemeBorder,
  type ThemeLanesMode,
  type ThemeLaneStyle,
  type ThemePadding,
  type ThemeRoundness,
  type ThemeTextCase,
  type TrazoTheme,
  type TrazoTokenSlot,
} from '@joycostudio/trazo'
import { Check, Copy, Palette, X } from 'lucide-react'
import { useCallback, useState } from 'react'

import { OklchPicker } from '@/components/oklch-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { PRESETS, themeToCss } from '@/lib/themes'

export interface ThemePanelProps {
  theme: TrazoTheme
  /** Active preset name, or "custom" once any knob/token was edited. */
  presetName: string
  onThemeChange: (next: TrazoTheme, presetName: string) => void
}

/** Role slots edited as fill + foreground pairs. */
const ROLE_SLOTS = ['primary', 'secondary', 'ghost', 'muted', 'neutral', 'success', 'warning', 'error', 'info'] as const

/** Standalone surface slots (no foreground pairing edited here). */
const SURFACE_SLOTS: readonly TrazoTokenSlot[] = [
  'canvas',
  'canvas-hatch',
  'edge',
  'accent',
  'accent-foreground',
  'foreground',
  'code',
  'code-foreground',
]

const LANE_SLOTS: readonly TrazoTokenSlot[] = ['lane-1', 'lane-2', 'lane-3', 'lane-4', 'lane-5', 'lane-6']

function KnobRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  onChange: (next: T) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground font-mono text-xs tracking-wide uppercase">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={option === value ? 'default' : 'secondary'}
            aria-pressed={option === value}
            onClick={() => onChange(option)}
            className="h-7 px-2 font-mono text-xs uppercase"
          >
            {option}
          </Button>
        ))}
      </div>
    </div>
  )
}

function TokenSwatch({
  slot,
  value,
  onChange,
  derived,
  onClear,
}: {
  slot: TrazoTokenSlot
  value: string | undefined
  onChange: (slot: TrazoTokenSlot, color: string) => void
  /** Auto-derived value shown when there is no explicit one (foregrounds). */
  derived?: string
  /** Present on foreground slots with an explicit value — clears back to auto. */
  onClear?: (slot: TrazoTokenSlot) => void
}) {
  const isAuto = value === undefined && derived !== undefined
  return (
    <div className="flex min-w-0 items-center gap-2">
      <OklchPicker
        value={value ?? derived ?? 'oklch(0.5 0 0)'}
        onChange={(next) => onChange(slot, next)}
        label={`${slot} color`}
      />
      <span className="text-muted-foreground min-w-0 truncate font-mono text-[11px]">{slot}</span>
      {isAuto ? <span className="text-muted-foreground/60 shrink-0 font-mono text-[10px] uppercase">auto</span> : null}
      {value !== undefined && onClear !== undefined ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onClear(slot)}
          aria-label={`Reset ${slot} to automatic contrast`}
          className="text-muted-foreground size-4 shrink-0"
        >
          <X />
        </Button>
      ) : null}
    </div>
  )
}

export function ThemePanel({ theme, presetName, onThemeChange }: ThemePanelProps) {
  const [jsonCopied, setJsonCopied] = useState(false)
  const [cssCopied, setCssCopied] = useState(false)

  const setKnob = useCallback(
    <K extends keyof TrazoTheme>(key: K, value: TrazoTheme[K]) => {
      onThemeChange({ ...theme, name: 'custom', [key]: value }, 'custom')
    },
    [theme, onThemeChange]
  )

  const setToken = useCallback(
    (slot: TrazoTokenSlot, color: string) => {
      onThemeChange({ ...theme, name: 'custom', tokens: { ...theme.tokens, [slot]: color } }, 'custom')
    },
    [theme, onThemeChange]
  )

  const clearToken = useCallback(
    (slot: TrazoTokenSlot) => {
      const tokens = { ...theme.tokens }
      delete tokens[slot]
      onThemeChange({ ...theme, name: 'custom', tokens }, 'custom')
    },
    [theme, onThemeChange]
  )

  const setFrame = useCallback(
    (part: 'label' | 'number', value: string) => {
      const frame = { ...theme.frame, [part]: value }
      onThemeChange({ ...theme, frame }, presetName)
    },
    [theme, presetName, onThemeChange]
  )

  const copyWith = useCallback((text: string, mark: (copied: boolean) => void) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        mark(true)
        setTimeout(() => mark(false), 1500)
      })
      .catch(() => {})
  }, [])

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="muted" size="sm">
          <Palette aria-hidden="true" className="size-3.5" />
          <span className="font-mono text-xs tracking-wide uppercase">theme</span>
          {presetName === 'custom' ? (
            <Badge variant="muted" size="sm">
              custom
            </Badge>
          ) : null}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" seeThrough className="flex w-80 flex-col gap-0 overflow-y-auto p-0">
        <div className="border-border flex flex-col gap-1 border-b px-4 py-3">
          <SheetTitle className="text-sm tracking-wide uppercase">Theme</SheetTitle>
          <SheetDescription className="text-xs">
            Knobs + tokens for the live preview. Export as JSON for{' '}
            <code className="font-mono">&lt;Graph theme&gt;</code> or as CSS vars.
          </SheetDescription>
        </div>

        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground font-mono text-xs tracking-wide uppercase">preset</span>
            <div role="group" aria-label="Theme preset" className="flex gap-1">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.name}
                  type="button"
                  size="sm"
                  variant={presetName === preset.name ? 'default' : 'secondary'}
                  aria-pressed={presetName === preset.name}
                  onClick={() => onThemeChange(preset, preset.name ?? 'custom')}
                  className="h-7 px-2 font-mono text-xs uppercase"
                >
                  {preset.name}
                </Button>
              ))}
            </div>
          </div>

          <KnobRow
            label="padding"
            value={(theme.padding ?? 'default') as ThemePadding}
            options={['sm', 'default', 'lg'] as const}
            onChange={(v) => setKnob('padding', v)}
          />
          <KnobRow
            label="roundness"
            value={(theme.roundness ?? 'none') as ThemeRoundness}
            options={['none', 'sm', 'default', 'lg'] as const}
            onChange={(v) => setKnob('roundness', v)}
          />
          <KnobRow
            label="lanes mode"
            value={(theme.lanesMode ?? 'angular') as ThemeLanesMode}
            options={['angular', 'orthogonal', 'rounded', 'bezier'] as const}
            onChange={(v) => setKnob('lanesMode', v)}
          />
          <KnobRow
            label="lane style"
            value={(theme.laneStyle ?? 'solid') as ThemeLaneStyle}
            options={['solid', 'dashed', 'dotted'] as const}
            onChange={(v) => setKnob('laneStyle', v)}
          />
          <KnobRow
            label="background"
            value={(theme.background ?? 'none') as ThemeBackground}
            options={['none', 'solid', 'texture'] as const}
            onChange={(v) => setKnob('background', v)}
          />
          <KnobRow
            label="border"
            value={(theme.border ?? 'default') as ThemeBorder}
            options={['none', 'default', 'large'] as const}
            onChange={(v) => setKnob('border', v)}
          />
          <KnobRow
            label="text case"
            value={(theme.textCase ?? 'uppercase') as ThemeTextCase}
            options={['uppercase', 'none'] as const}
            onChange={(v) => setKnob('textCase', v)}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="theme-lane-gap" className="text-muted-foreground font-mono text-xs tracking-wide uppercase">
              lane gap · {theme.laneGap ?? 0}
            </label>
            <Slider
              id="theme-lane-gap"
              min={0}
              max={10}
              step={1}
              value={[theme.laneGap ?? 0]}
              onValueChange={([v]) => setKnob('laneGap', v ?? 0)}
              aria-label="Git lane gap"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground font-mono text-xs tracking-wide uppercase">frame</span>
            <div className="flex gap-1">
              <Input
                value={theme.frame?.label ?? ''}
                onChange={(event) => setFrame('label', event.target.value)}
                placeholder="Label"
                aria-label="Frame label"
                autoComplete="off"
                spellCheck={false}
                className="h-7 min-w-0 flex-1 font-mono text-xs"
              />
              <Input
                value={theme.frame?.number ?? ''}
                onChange={(event) => setFrame('number', event.target.value)}
                placeholder="01"
                aria-label="Frame number"
                autoComplete="off"
                spellCheck={false}
                className="h-7 w-14 font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground font-mono text-xs tracking-wide uppercase">role tokens</span>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {ROLE_SLOTS.map((slot) => (
                <div key={slot} className="contents">
                  <TokenSwatch slot={slot} value={theme.tokens?.[slot]} onChange={setToken} />
                  <TokenSwatch
                    slot={`${slot}-foreground`}
                    value={theme.tokens?.[`${slot}-foreground`]}
                    derived={contrastForeground(theme.tokens?.[slot] ?? '')}
                    onChange={setToken}
                    onClear={clearToken}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground font-mono text-xs tracking-wide uppercase">surfaces</span>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {SURFACE_SLOTS.map((slot) => (
                <TokenSwatch key={slot} slot={slot} value={theme.tokens?.[slot]} onChange={setToken} />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground font-mono text-xs tracking-wide uppercase">git lanes</span>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {LANE_SLOTS.map((slot) => (
                <TokenSwatch key={slot} slot={slot} value={theme.tokens?.[slot]} onChange={setToken} />
              ))}
            </div>
          </div>

          <div className="flex gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => copyWith(JSON.stringify(theme, null, 2), setJsonCopied)}
              className="h-7 flex-1 gap-1.5 font-mono text-xs uppercase"
            >
              {jsonCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              JSON
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => copyWith(themeToCss(theme), setCssCopied)}
              className="h-7 flex-1 gap-1.5 font-mono text-xs uppercase"
            >
              {cssCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              CSS
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
