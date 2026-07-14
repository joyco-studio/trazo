/**
 * Prop types for the "trazo/react" renderers (FROZEN).
 *
 * Styling follows the JOYCO data-slot convention: the root carries a single
 * `className`; inner elements expose `data-slot` so a parent can style them via
 * `**:data-[slot=name]:…` without per-element className props. We still allow a
 * narrow `classNames` map for the few slots an app may want to target directly
 * in a type-safe way.
 */

import type { PositionedGraph } from "../types.js";
import type { TrazoTheme } from "../theme.js";

/** Optional per-slot class overrides. Prefer styling via `data-slot` from CSS. */
export interface GraphClassNames {
  /** The lane/edge connector paths. */
  edge?: string;
  /** The commit node dots (git) / shape outlines (flow). */
  node?: string;
  /** The commit message labels / centered flow node labels. */
  label?: string;
  /** The box-like flow node shapes (rect/stadium/diamond/cylinder). */
  nodeBox?: string;
  /** The flow edge labels. */
  edgeLabel?: string;
  /** The subgraph container boxes (flow) / note boxes (sequence). */
  group?: string;
  /** The subgraph / note container titles. */
  groupLabel?: string;
  /** The sequence-diagram lifelines (vertical dashed lines). */
  lifeline?: string;
  /** The git branch-lane labels (`main:` / `feature-x:` tags). */
  laneLabel?: string;
  /** The git commit-range group brackets. */
  commitBracket?: string;
  /** The git free-form legend note lines. */
  gitNote?: string;
}

export interface GraphProps {
  /** Fully resolved layout from `layout()`. The component does not compute geometry. */
  graph: PositionedGraph;
  /** Single className on the root `<svg>` (data-slot="trazo-graph"). */
  className?: string;
  /** Optional type-safe per-slot class overrides. */
  classNames?: GraphClassNames;
  /**
   * Accessible label for the `<svg>` (rendered as `<title>` + `aria-label`).
   * Defaults to a generic description when omitted.
   */
  title?: string;
  /**
   * Paint half of a {@link TrazoTheme}: color tokens become `--trazo-*` vars on
   * the root, plus lane style / roundness / border / background draw knobs.
   * Pair it with `themeFlowOptions`/`themeGitOptions` at layout time so both
   * halves of the theme apply. Omitted → current defaults (non-breaking).
   */
  theme?: TrazoTheme;
}
