/**
 * rama React entry ("./react") — FROZEN public API.
 *
 * React is an OPTIONAL peer dependency: importing "rama" never pulls React in;
 * only "rama/react" does. Apps that just call `layout()`/`measure()` on a
 * server pay nothing for React.
 *
 * Renderer purity contract — every component exported here MUST be renderable:
 *  1. as a React Server Component (no hooks, no effects, no event handlers,
 *     no browser globals) so the hub can emit graph illustrations as pure SSR
 *     with zero client JS, and
 *  2. hydrated on the client, where it renders byte-identically to the server
 *     output so mirador's live preview can recompute and swap it in without
 *     hydration mismatch.
 *
 * Because the geometry is fully resolved by `layout()` upstream, `<Graph>` is a
 * pure function of its `graph` prop — it only maps a `PositionedGraph` to SVG.
 */

export type { GraphProps, GraphClassNames } from "./types.js";

import type { GraphProps } from "./types.js";
import type { JSX } from "react";

/**
 * Render a `PositionedGraph` as an inline `<svg>`. Pure: same `graph` →
 * same markup, on server or client. Styling comes from theme tokens via
 * `className`/CSS, not from props baked into the engine.
 *
 * Stubbed in the contract commit; Track A lands the SVG implementation behind
 * this signature.
 */
export declare function Graph(props: GraphProps): JSX.Element;
