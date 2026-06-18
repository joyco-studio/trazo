/**
 * Prop types for the "rama/react" renderers (FROZEN).
 *
 * Styling follows the JOYCO data-slot convention: the root carries a single
 * `className`; inner elements expose `data-slot` so a parent can style them via
 * `**:data-[slot=name]:…` without per-element className props. We still allow a
 * narrow `classNames` map for the few slots an app may want to target directly
 * in a type-safe way.
 */

import type { PositionedGraph } from "../types.js";

/** Optional per-slot class overrides. Prefer styling via `data-slot` from CSS. */
export interface GraphClassNames {
  /** The lane/edge connector paths. */
  edge?: string;
  /** The commit node dots. */
  node?: string;
  /** The commit message labels. */
  label?: string;
}

export interface GraphProps {
  /** Fully resolved layout from `layout()`. The component does not compute geometry. */
  graph: PositionedGraph;
  /** Single className on the root `<svg>` (data-slot="rama-graph"). */
  className?: string;
  /** Optional type-safe per-slot class overrides. */
  classNames?: GraphClassNames;
  /**
   * Accessible label for the `<svg>` (rendered as `<title>` + `aria-label`).
   * Defaults to a generic description when omitted.
   */
  title?: string;
}
