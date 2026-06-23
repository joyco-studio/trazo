'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

/**
 * Shares the diagram color overrides between the editor Sheet (in the header) and
 * the preview wrapper (deep inside the Inspector island). Both live under this
 * provider in app/page.tsx, so neither has to prop-drill across the tree.
 *
 * Overrides are slot → hex (e.g. `primary` → `#ff0000`). Only slots the user has
 * actually changed are stored; unset slots fall through to the shadcn token
 * defaults baked into trazo's `--trazo-<slot>` fallback chain. State is in-memory
 * only — a refresh restores every default.
 */

interface ColorEditorContextValue {
  /** Map of changed slots (without the `--trazo-` prefix) to their hex value. */
  overrides: Record<string, string>
  /** CSS custom properties to spread onto the graph wrapper, one per override. */
  style: React.CSSProperties
  setColor: (slot: string, hex: string) => void
  resetColor: (slot: string) => void
  resetAll: () => void
}

const ColorEditorContext = createContext<ColorEditorContextValue | null>(null)

export function ColorEditorProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, string>>({})

  const setColor = useCallback((slot: string, hex: string) => {
    setOverrides((prev) => ({ ...prev, [slot]: hex }))
  }, [])

  const resetColor = useCallback((slot: string) => {
    setOverrides((prev) => {
      const next = { ...prev }
      delete next[slot]
      return next
    })
  }, [])

  const resetAll = useCallback(() => setOverrides({}), [])

  // Each override becomes a `--trazo-<slot>` custom property. Spreading these onto
  // the graph wrapper re-themes only the slots the user touched; the rest keep
  // falling through to the app's shadcn tokens.
  const style = useMemo(() => {
    const vars: Record<string, string> = {}
    for (const [slot, hex] of Object.entries(overrides)) {
      vars[`--trazo-${slot}`] = hex
    }
    return vars as React.CSSProperties
  }, [overrides])

  const value = useMemo<ColorEditorContextValue>(
    () => ({ overrides, style, setColor, resetColor, resetAll }),
    [overrides, style, setColor, resetColor, resetAll]
  )

  return <ColorEditorContext.Provider value={value}>{children}</ColorEditorContext.Provider>
}

export function useColorEditor(): ColorEditorContextValue {
  const ctx = useContext(ColorEditorContext)
  if (!ctx) {
    throw new Error('useColorEditor must be used within a ColorEditorProvider')
  }
  return ctx
}
