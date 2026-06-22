/**
 * Playground git DSL — a thin wrapper over the PUBLISHED parser.
 *
 * The git parser used to be duplicated here; it now re-exports the package's
 * `parseGit` (aliased to `parseDsl`, the name the inspector uses) so the editor
 * and the published `@joycostudio/trazo` API accept exactly the same grammar.
 * The package is the single source of truth — only the seed program lives here.
 */

import { parseGit } from "@joycostudio/trazo";

/** Parse a git DSL source into a `CommitGraph` (re-export of the package parser). */
export const parseDsl = parseGit;
export { parseGit };
export type { GitParseResult, GitParseResult as ParseResult } from "@joycostudio/trazo";

/** Parse error shape the inspector renders (line + message). */
export interface ParseError {
  line: number;
  message: string;
}

/**
 * Seed git program for the initial render — the "phantom merge conflicts" story
 * from the JOYCO log. Two base commits, then Elvira branches for checkout and
 * Homero stacks receipts on top of her branch. Back on `main` a single squash
 * commit collapses Elvira's branch, and Homero's two commits are REPLAYED
 * (rebased) on top of that squash. The commit messages carry the narrative.
 */
export const SEED_PROGRAM = `# Trazo Playground — git mode
# phantom merge conflicts (JOYCO log)
# commit [id] [(author)] [: message]

commit a1b2c3d (JOYCO) : Initial commit
commit b2c3d4e (JOYCO) : Base commit

# Elvira branches off the base for the checkout feature.
branch elvira/checkout
commit e1f2a3b (Elvira) : checkout: scaffold flow
commit e2f3a4c (Elvira) : checkout: wire payment step

# Homero stacks receipts ON TOP of Elvira's branch.
branch homero/receipts
commit h1a2b3c (Homero) : receipts: add receipt page
commit h2b3c4d (Homero) : receipts: render line items

# Back on main: Elvira's branch lands as ONE squashed commit.
checkout main
commit 5c6d7e8 (Elvira) : Squash of elvira/checkout

# Homero's commits are REPLAYED onto the squash (the phantom conflict).
commit f1e2d3c (Homero) : receipts: add receipt page (rebased)
commit f2e3d4b (Homero) : receipts: render line items (rebased)
`;

/** Backward-compatible alias — the inspector imports the git seed by this name. */
export const SEED_GIT = SEED_PROGRAM;
