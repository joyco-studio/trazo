/**
 * rama React entry ("./react") — FROZEN public API.
 *
 * React is an OPTIONAL peer dependency: importing "rama" never pulls React in;
 * only "rama/react" does. Apps that just call `layout()`/`measure()` on a
 * server pay nothing for React.
 *
 * Renderer purity contract — `<Graph>` is a PURE FUNCTION of its props:
 *  1. as a React Server Component (no hooks, no effects, no event handlers, no
 *     browser globals) so the hub can emit graph illustrations as pure SSR with
 *     zero client JS, and
 *  2. hydrated on the client, where it renders byte-identically to the server
 *     output so mirador's live preview can swap it in without a mismatch.
 *
 * The JSX implementation lives in `./graph.tsx` (a `.tsx` so JSX compiles);
 * this frozen `.ts` entry only re-exports it behind the contract signature.
 */

export type { GraphProps, GraphClassNames } from "./types.js";

export { Graph } from "./graph.js";
