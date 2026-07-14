'use client'

/**
 * Share the active theme via the URL.
 *
 * Serializes `{ theme, preset }` into a `?theme=<base64url JSON>` query param
 * with `history.replaceState` (debounced — no navigation, no re-render), and
 * restores it once on mount. Opening a shared link reproduces the exact theme,
 * knobs and custom tokens included. The param is REMOVED while the pristine
 * default preset is active, so unshared sessions keep a clean URL.
 *
 * Deliberately not `useSearchParams` (would force a Suspense boundary on the
 * page) — the playground never routes on these params, so reading
 * `window.location` post-mount is equivalent and hydration-safe.
 */

import type { TrazoTheme } from '@joycostudio/trazo'
import { useEffect, useRef } from 'react'

const PARAM = 'theme'

interface SharedTheme {
  theme: TrazoTheme
  preset: string
}

/** base64url of the JSON (unicode-safe via UTF-8 bytes). */
function encodeShared(value: SharedTheme): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeShared(raw: string): SharedTheme | null {
  try {
    const binary = atob(raw.replaceAll('-', '+').replaceAll('_', '/'))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as SharedTheme).theme === 'object' &&
      typeof (parsed as SharedTheme).preset === 'string'
    ) {
      return parsed as SharedTheme
    }
  } catch {
    // Malformed share link — ignore it.
  }
  return null
}

export function useThemeUrl(
  theme: TrazoTheme,
  presetName: string,
  /** The pristine default — while active, the URL param is dropped. */
  defaultTheme: TrazoTheme,
  onRestore: (theme: TrazoTheme, presetName: string) => void
) {
  const onRestoreRef = useRef(onRestore)
  onRestoreRef.current = onRestore
  const restoredRef = useRef(false)

  // Mount: restore a shared theme from the URL (post-hydration by definition).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get(PARAM)
    if (raw !== null) {
      const shared = decodeShared(raw)
      if (shared !== null) onRestoreRef.current(shared.theme, shared.preset)
    }
    restoredRef.current = true
  }, [])

  // Reflect theme changes back into the URL (debounced replaceState).
  useEffect(() => {
    if (!restoredRef.current) return
    const t = setTimeout(() => {
      const params = new URLSearchParams(window.location.search)
      if (theme === defaultTheme) params.delete(PARAM)
      else params.set(PARAM, encodeShared({ theme, preset: presetName }))
      const query = params.toString()
      const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', url)
    }, 300)
    return () => clearTimeout(t)
  }, [theme, presetName, defaultTheme])
}
