'use client'

import { Check, Copy, Download, RotateCcw } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

import { useColorEditor } from './context'
import { copyThemeCss, downloadThemeCss } from './export-theme'
import { parseOklch } from './oklch'
import { OklchPicker } from './oklch-picker'
import { COLOR_SLOTS, type ColorSlot, SLOT_GROUPS } from './slots'

/** A single slot row: OKLCH swatch-picker + label + editable value + per-slot reset. */
function SlotRow({ slot }: { slot: ColorSlot }) {
  const { overrides, setColor, resetColor } = useColorEditor()
  const overridden = slot.slot in overrides
  const value = overrides[slot.slot] ?? slot.defaultColor

  // Local draft so typing an oklch() string isn't blocked by transient invalid
  // states; we only commit to context when the draft parses cleanly. When the
  // committed value changes from elsewhere (the picker or a reset), resync the
  // draft DURING render via a tracked previous value — no effect, no extra pass.
  const [draft, setDraft] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setDraft(value)
  }

  const valid = parseOklch(draft) !== null

  return (
    <div className="flex items-center gap-3">
      <OklchPicker value={value} onChange={(next) => setColor(slot.slot, next)} label={slot.label} />
      <span className="min-w-0 flex-1 truncate text-sm">{slot.label}</span>
      <Input
        type="text"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={!valid || undefined}
        aria-label={`${slot.label} OKLCH value`}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          if (parseOklch(next)) setColor(slot.slot, next)
        }}
        className="h-7 w-36 font-mono text-xs tabular-nums"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => resetColor(slot.slot)}
        disabled={!overridden}
        aria-label={`Reset ${slot.label} to default`}
        className="text-muted-foreground shrink-0"
      >
        <RotateCcw />
      </Button>
    </div>
  )
}

/**
 * Header trigger + side drawer for the diagram color editor. Lists every
 * `--trazo-*` override slot grouped by purpose; edits flow through the
 * ColorEditorProvider to the live preview. Reset is per-slot or all at once.
 */
export function ColorEditorSheet() {
  const { resetAll, overrides } = useColorEditor()
  const hasOverrides = Object.keys(overrides).length > 0
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    copyThemeCss(overrides)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }, [overrides])

  const handleDownload = useCallback(() => downloadThemeCss(overrides), [overrides])

  return (
    <Sheet>
      <SheetTrigger className="text-muted-foreground hover:text-foreground focus-visible:ring-ring text-xs tracking-wide uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none">
        Colors
      </SheetTrigger>
      <SheetContent side="right" className="gap-0">
        <header className="border-border bg-card flex h-14 shrink-0 items-center gap-2 border-b px-6">
          <SheetTitle className="text-sm font-semibold tracking-wide uppercase">
            Diagram colors
          </SheetTitle>
          <SheetDescription className="text-muted-foreground sr-only">
            Override the diagram color tokens live. Changes reset on reload.
          </SheetDescription>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
          {SLOT_GROUPS.map((group) => (
            <section key={group} className="space-y-3">
              <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {group}
              </h2>
              <div className="space-y-2">
                {COLOR_SLOTS.filter((s) => s.group === group).map((slot) => (
                  <SlotRow key={slot.slot} slot={slot} />
                ))}
              </div>
              {group !== SLOT_GROUPS[SLOT_GROUPS.length - 1] ? <Separator /> : null}
            </section>
          ))}
        </div>

        <div className="border-border bg-card flex shrink-0 items-center gap-2 border-t px-6 py-3">
          <Button variant="outline" size="sm" onClick={handleCopy} className="h-8 flex-1 gap-2">
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy theme CSS'}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleDownload}
            aria-label="Download theme CSS"
            className="h-8"
          >
            <Download />
          </Button>
        </div>

        <footer className="border-border bg-card text-muted-foreground flex h-9 shrink-0 items-center justify-between border-t px-6 text-xs">
          <Button
            variant="ghost"
            size="sm"
            onClick={resetAll}
            disabled={!hasOverrides}
            className="text-muted-foreground hover:text-foreground -ml-2 h-7 tracking-wide uppercase"
          >
            Reset all
          </Button>
          <SheetClose className="hover:text-foreground tracking-wide uppercase transition-colors">
            Close
          </SheetClose>
        </footer>
      </SheetContent>
    </Sheet>
  )
}
