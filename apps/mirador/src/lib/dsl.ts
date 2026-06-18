/**
 * mirador DSL — a tiny, forgiving line-based language for describing a commit
 * DAG, parsed into a rama `CommitGraph`.
 *
 * Grammar (one statement per line, `#` starts a comment, blank lines ignored):
 *
 *   commit [id] [: message]   add a commit on the current branch; parent is the
 *                             branch's current tip. `id` optional (auto: c1, c2…).
 *                             `: message` optional human label.
 *   branch <name>             create <name> off the current tip and check it out.
 *   checkout <name>           switch the current branch to <name>.
 *   merge <name> [: message]  merge branch <name> into the current branch
 *                             (creates a merge commit with two parents).
 *
 * The first branch is `main`. Errors are reported with a 1-based line number and
 * a friendly message; the caller keeps the last good graph rendered.
 */

import type { Commit, CommitGraph } from "rama";

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  graph: CommitGraph;
  error: ParseError | null;
}

const DEFAULT_BRANCH = "main";

export function parseDsl(source: string): ParseResult {
  const commits: Commit[] = [];
  const branchTips = new Map<string, string>(); // branch → current tip id
  let currentBranch = DEFAULT_BRANCH;
  let autoCounter = 0;

  branchTips.set(DEFAULT_BRANCH, ""); // empty tip = no commits yet

  const fail = (line: number, message: string): ParseResult => ({
    graph: { commits, refs: refsFrom(branchTips, currentBranch) },
    error: { line, message },
  });

  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const withoutComment = lines[i].split("#")[0];
    const raw = withoutComment.trim();
    if (raw === "") continue;

    // Split off an optional `: message` tail first.
    const colonIndex = raw.indexOf(":");
    const head = (colonIndex === -1 ? raw : raw.slice(0, colonIndex)).trim();
    const message =
      colonIndex === -1 ? undefined : raw.slice(colonIndex + 1).trim() || undefined;

    const tokens = head.split(/\s+/);
    const keyword = tokens[0].toLowerCase();
    const arg = tokens[1];

    switch (keyword) {
      case "commit": {
        const parentTip = branchTips.get(currentBranch) ?? "";
        const id = arg ?? `c${++autoCounter}`;
        if (commits.some((c) => c.id === id)) {
          return fail(lineNumber, `duplicate commit id “${id}”`);
        }
        commits.push({
          id,
          parents: parentTip ? [parentTip] : [],
          branch: currentBranch,
          message,
        });
        branchTips.set(currentBranch, id);
        break;
      }

      case "branch": {
        if (!arg) return fail(lineNumber, "branch needs a name, e.g. “branch feature”");
        if (branchTips.has(arg)) {
          return fail(lineNumber, `branch “${arg}” already exists`);
        }
        branchTips.set(arg, branchTips.get(currentBranch) ?? "");
        currentBranch = arg;
        break;
      }

      case "checkout": {
        if (!arg) return fail(lineNumber, "checkout needs a branch name");
        if (!branchTips.has(arg)) {
          return fail(lineNumber, `unknown branch “${arg}” — branch it first`);
        }
        currentBranch = arg;
        break;
      }

      case "merge": {
        if (!arg) return fail(lineNumber, "merge needs a branch name, e.g. “merge feature”");
        if (!branchTips.has(arg)) {
          return fail(lineNumber, `unknown branch “${arg}”`);
        }
        const mainlineTip = branchTips.get(currentBranch) ?? "";
        const mergedTip = branchTips.get(arg) ?? "";
        if (!mainlineTip || !mergedTip) {
          return fail(lineNumber, `nothing to merge — both branches need a commit`);
        }
        const id = `m${++autoCounter}`;
        commits.push({
          id,
          parents: [mainlineTip, mergedTip],
          branch: currentBranch,
          message: message ?? `merge ${arg}`,
        });
        branchTips.set(currentBranch, id);
        break;
      }

      default:
        return fail(
          lineNumber,
          `unknown command “${keyword}” — use commit, branch, checkout or merge`,
        );
    }
  }

  return {
    graph: { commits, refs: refsFrom(branchTips, currentBranch) },
    error: null,
  };
}

function refsFrom(
  branchTips: Map<string, string>,
  currentBranch: string,
): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const [branch, tip] of branchTips) {
    if (tip) refs[branch] = tip;
  }
  const head = branchTips.get(currentBranch);
  if (head) refs.HEAD = head;
  return refs;
}

/**
 * The seed program used for the initial SSR render. It deliberately produces a
 * branch AND a merge so the first server-rendered SVG is a real, non-trivial
 * git graph (multiple lanes / x-positions) — verifiable via view-source.
 */
export const SEED_PROGRAM = `# mirador — live rama inspector
# edit me: each line mutates the graph on the right

commit : init repo
commit : add layout engine

branch feature
commit : sketch lane solver
commit : curve the edges

checkout main
commit : harden the core

merge feature : land feature

commit : tag release
`;
