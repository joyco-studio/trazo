/**
 * Playground flow DSL — a thin wrapper over the PUBLISHED parser.
 *
 * The flow parser used to be duplicated here, which let the two copies drift
 * (the playground silently lagged behind `@joycostudio/trazo` on subgraphs,
 * arrow tokens, multi-line labels, …). It now re-exports the package's
 * `parseFlow` so the editor and the published API accept exactly the same
 * grammar — no divergence. Only the seed program and the direction accessor are
 * playground-specific.
 */

import { type FlowDirection, type FlowGraph, parseFlow } from "@joycostudio/trazo";

export { parseFlow };
export type { FlowParseResult } from "@joycostudio/trazo";

/** Parse error shape the inspector renders (line + message). */
export interface ParseError {
  line: number;
  message: string;
}

/**
 * Seed flowchart for the initial render — a real fan-out/fan-in from JOYCO log
 * 07 ("Don't await. Forward."): a request fans out to parallel work that fans
 * back into a single streaming node. Produces a multi-layer graph with mixed
 * shapes and semantic roles so the first paint is a non-trivial illustration.
 */
export const SEED_FLOW = `# playground — flowchart mode
# nodes: id["box"] ([stadium]) {diamond} [(cylinder)] ; optional :role
# edges: --> directed   ==> colored   --- undirected   <--> bidirectional
# group nodes with: subgraph G ["Label"] … end
flow TD

A(["Request arrives"]):primary --> B["getCart() started"]:warning
A --> C["getFlags() started"]:warning
A --> D["Render shell immediately"]:info
B ==> E["Stream data as promises settle"]:success
C --> E
D --> E
`;

/** The layout direction parsed from a flow source (the app reads this back). */
export function directionOf(graph: FlowGraph): FlowDirection {
  return graph.direction === "LR" ? "LR" : "TD";
}
