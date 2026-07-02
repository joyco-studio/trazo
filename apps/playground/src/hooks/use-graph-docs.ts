'use client'

/**
 * Per-mode graph documents with localStorage persistence.
 *
 * Lets the playground keep MULTIPLE sources per mode (start a fresh diagram
 * from the seed without losing the one you were editing) and survive reloads.
 *
 * Hydration safety: the initial state is exactly the server-rendered seeds
 * (one doc per mode), so the first client render matches the SSR markup. The
 * persisted state is restored in a post-mount effect, and `restoredAt` bumps
 * so the consumer knows to re-layout the (possibly different) active source.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface GraphDoc {
  id: string
  source: string
}

const STORAGE_KEY = 'trazo-playground-docs-v1'
const SEED_DOC_ID = 'seed'

interface DocsState<M extends string> {
  docs: Record<M, GraphDoc[]>
  active: Record<M, string>
}

function seedState<M extends string>(seeds: Record<M, string>): DocsState<M> {
  const docs = {} as Record<M, GraphDoc[]>
  const active = {} as Record<M, string>
  for (const mode of Object.keys(seeds) as M[]) {
    docs[mode] = [{ id: SEED_DOC_ID, source: seeds[mode] }]
    active[mode] = SEED_DOC_ID
  }
  return { docs, active }
}

/** Restored state is only trusted when every mode still has ≥1 valid doc. */
function isValidPersisted<M extends string>(value: unknown, modes: M[]): value is DocsState<M> {
  if (typeof value !== 'object' || value === null) return false
  const state = value as DocsState<M>
  if (typeof state.docs !== 'object' || typeof state.active !== 'object') return false
  return modes.every((mode) => {
    const list = state.docs[mode]
    return (
      Array.isArray(list) &&
      list.length > 0 &&
      list.every((d) => typeof d?.id === 'string' && typeof d?.source === 'string') &&
      list.some((d) => d.id === state.active[mode])
    )
  })
}

export function useGraphDocs<M extends string>(seeds: Record<M, string>) {
  const [state, setState] = useState<DocsState<M>>(() => seedState(seeds))
  /** 0 until the post-mount localStorage restore ran; then a monotonic tick. */
  const [restoredAt, setRestoredAt] = useState(0)
  const loadedRef = useRef(false)
  const seedsRef = useRef(seeds)
  // Ref mirror so the action callbacks can read the latest state without
  // side effects inside setState updaters (impure under StrictMode).
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw)
        const modes = Object.keys(seedsRef.current) as M[]
        if (isValidPersisted<M>(parsed, modes)) {
          // localStorage is invisible during SSR, so restoring it MUST happen
          // in a post-mount effect — the one legitimate setState-in-effect:
          // syncing state in from an external store exactly once.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setState(parsed)
          setRestoredAt((n) => n + 1)
        }
      }
    } catch {
      // Corrupt storage → keep the seeds; the next persist overwrites it.
    }
    loadedRef.current = true
  }, [])

  // Debounced persist. The loadedRef gate plus the debounce ensure the seed
  // state never clobbers stored docs before the restore effect applies them.
  useEffect(() => {
    if (!loadedRef.current) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {
        // Quota/private mode — persistence is best-effort.
      }
    }, 300)
    return () => clearTimeout(t)
  }, [state])

  const setSource = useCallback((mode: M, source: string) => {
    setState((prev) => ({
      ...prev,
      docs: {
        ...prev.docs,
        [mode]: prev.docs[mode].map((d) =>
          d.id === prev.active[mode] ? { ...d, source } : d
        ),
      },
    }))
  }, [])

  /** New doc starts from the mode's seed; becomes active. Returns its source. */
  const addDoc = useCallback((mode: M): string => {
    const source = seedsRef.current[mode]
    // Client-only action (button click), so Date.now is hydration-safe.
    const id = `d${Date.now().toString(36)}`
    setState((prev) => ({
      docs: { ...prev.docs, [mode]: [...prev.docs[mode], { id, source }] },
      active: { ...prev.active, [mode]: id },
    }))
    return source
  }, [])

  /** Select a doc; returns its source (null if the id is unknown). */
  const selectDoc = useCallback((mode: M, id: string): string | null => {
    const doc = stateRef.current.docs[mode].find((d) => d.id === id)
    if (doc === undefined) return null
    setState((prev) => ({ ...prev, active: { ...prev.active, [mode]: id } }))
    return doc.source
  }, [])

  /**
   * Delete a doc. The previous (or next) doc becomes active; deleting the
   * last doc replaces it with a fresh seed. Returns the new active source.
   */
  const deleteDoc = useCallback((mode: M, id: string): string => {
    const { docs, active } = stateRef.current
    const list = docs[mode]
    const index = list.findIndex((d) => d.id === id)
    if (index === -1) {
      return (list.find((d) => d.id === active[mode]) as GraphDoc).source
    }
    const remaining = list.filter((d) => d.id !== id)
    if (remaining.length === 0) {
      const fresh: GraphDoc = { id: SEED_DOC_ID, source: seedsRef.current[mode] }
      setState((prev) => ({
        docs: { ...prev.docs, [mode]: [fresh] },
        active: { ...prev.active, [mode]: fresh.id },
      }))
      return fresh.source
    }
    const nextActive =
      active[mode] === id ? (remaining[Math.max(0, index - 1)] as GraphDoc).id : active[mode]
    setState((prev) => ({
      docs: { ...prev.docs, [mode]: remaining },
      active: { ...prev.active, [mode]: nextActive },
    }))
    return (remaining.find((d) => d.id === nextActive) as GraphDoc).source
  }, [])

  return {
    docs: state.docs,
    active: state.active,
    restoredAt,
    setSource,
    addDoc,
    selectDoc,
    deleteDoc,
  }
}
