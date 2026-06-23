/**
 * The complete list of `--trazo-*` override slots the color editor exposes,
 * grouped for display. This is the single source of truth for both the editor's
 * row list and the default color each picker is seeded with.
 *
 * Slot ids mirror the `themed(slot, token, hex)` calls in
 * `packages/trazo/src/react/graph.tsx`. The default is the OKLCH equivalent of
 * that slot's hex fallback — the "factory" color shown before the user overrides
 * it. Authored in OKLCH so it matches globals.css and the picker round-trips
 * losslessly. Keep these in sync if graph.tsx's fallbacks change.
 */

export type SlotGroup = 'Roles' | 'Git lanes' | 'Surfaces'

export interface ColorSlot {
  /** The CSS custom property name without the `--trazo-` prefix (e.g. "primary"). */
  slot: string
  /** Human label shown in the editor row. */
  label: string
  group: SlotGroup
  /** Default color as an `oklch(L C H)` string — graph.tsx's hex fallback in OKLCH. */
  defaultColor: string
}

export const COLOR_SLOTS: ColorSlot[] = [
  // Semantic roles (flow nodes/edges) — ROLE_VARS / ROLE_FG_VARS in graph.tsx.
  { slot: 'primary', label: 'Primary', group: 'Roles', defaultColor: 'oklch(0.4522 0.2742 264.15)' },
  { slot: 'primary-foreground', label: 'Primary text', group: 'Roles', defaultColor: 'oklch(1 0 0)' },
  { slot: 'success', label: 'Success', group: 'Roles', defaultColor: 'oklch(0.6853 0.1346 160.83)' },
  { slot: 'success-foreground', label: 'Success text', group: 'Roles', defaultColor: 'oklch(0.1448 0 0)' },
  { slot: 'error', label: 'Error', group: 'Roles', defaultColor: 'oklch(0.6256 0.1933 23.03)' },
  { slot: 'error-foreground', label: 'Error text', group: 'Roles', defaultColor: 'oklch(1 0 0)' },
  { slot: 'warning', label: 'Warning', group: 'Roles', defaultColor: 'oklch(0.7677 0.1585 81.32)' },
  { slot: 'warning-foreground', label: 'Warning text', group: 'Roles', defaultColor: 'oklch(0.1448 0 0)' },
  { slot: 'streamed', label: 'Streamed', group: 'Roles', defaultColor: 'oklch(0.7845 0.1325 181.91)' },
  { slot: 'streamed-foreground', label: 'Streamed text', group: 'Roles', defaultColor: 'oklch(0.1448 0 0)' },
  { slot: 'neutral', label: 'Neutral', group: 'Roles', defaultColor: 'oklch(0.709 0 0)' },
  { slot: 'neutral-foreground', label: 'Neutral text', group: 'Roles', defaultColor: 'oklch(0.1448 0 0)' },

  // Git lane palette — LANE_VARS / LANE_FG_VARS in graph.tsx.
  { slot: 'lane-1', label: 'Lane 1', group: 'Git lanes', defaultColor: 'oklch(0.4522 0.2742 264.15)' },
  { slot: 'lane-1-foreground', label: 'Lane 1 text', group: 'Git lanes', defaultColor: 'oklch(1 0 0)' },
  { slot: 'lane-2', label: 'Lane 2', group: 'Git lanes', defaultColor: 'oklch(0.6853 0.1346 160.83)' },
  { slot: 'lane-2-foreground', label: 'Lane 2 text', group: 'Git lanes', defaultColor: 'oklch(0.1448 0 0)' },
  { slot: 'lane-3', label: 'Lane 3', group: 'Git lanes', defaultColor: 'oklch(0.7677 0.1585 81.32)' },
  { slot: 'lane-3-foreground', label: 'Lane 3 text', group: 'Git lanes', defaultColor: 'oklch(0.1448 0 0)' },
  { slot: 'lane-4', label: 'Lane 4', group: 'Git lanes', defaultColor: 'oklch(0.7845 0.1325 181.91)' },
  { slot: 'lane-4-foreground', label: 'Lane 4 text', group: 'Git lanes', defaultColor: 'oklch(0.1448 0 0)' },
  { slot: 'lane-5', label: 'Lane 5', group: 'Git lanes', defaultColor: 'oklch(0.709 0.1592 293.54)' },
  { slot: 'lane-5-foreground', label: 'Lane 5 text', group: 'Git lanes', defaultColor: 'oklch(0.1448 0 0)' },
  { slot: 'lane-6', label: 'Lane 6', group: 'Git lanes', defaultColor: 'oklch(0.7253 0.1752 349.76)' },
  { slot: 'lane-6-foreground', label: 'Lane 6 text', group: 'Git lanes', defaultColor: 'oklch(0.1448 0 0)' },

  // Surfaces / structure.
  { slot: 'foreground', label: 'Foreground', group: 'Surfaces', defaultColor: 'oklch(0.9461 0 0)' },
  { slot: 'bg', label: 'Node surface', group: 'Surfaces', defaultColor: 'oklch(0.1448 0 0)' },
  { slot: 'accent', label: 'Accent', group: 'Surfaces', defaultColor: 'oklch(0.285 0 0)' },
  { slot: 'accent-foreground', label: 'Accent text', group: 'Surfaces', defaultColor: 'oklch(0.9851 0 0)' },
  { slot: 'muted', label: 'Muted', group: 'Surfaces', defaultColor: 'oklch(0.2264 0 0)' },
  { slot: 'muted-foreground', label: 'Muted text', group: 'Surfaces', defaultColor: 'oklch(0.709 0 0)' },
]

export const SLOT_GROUPS: SlotGroup[] = ['Roles', 'Git lanes', 'Surfaces']
