/**
 * Public git DSL parser — a tiny, forgiving line-based language for describing
 * a commit DAG, parsed into a `CommitGraph`.
 *
 * Grammar (one statement per line, `#` starts a comment, blank lines ignored):
 *
 *   commit [id] [(<author>)] [: message]
 *   branch <name>
 *   checkout <name>
 *   merge <name> [: message]
 *
 * First branch is `main`. Errors carry a 1-based line number and a friendly
 * message; callers can keep the last good graph rendered on error.
 */

import type { Commit, CommitGraph, ParseError } from "./types.js";

export interface GitParseResult {
  graph: CommitGraph;
  error: ParseError | null;
}

const DEFAULT_BRANCH = "main";

const HASH_RE = /^[0-9a-f]{6,}$/i;

function takeAuthor(input: string): { author?: string; rest: string } {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("(")) return { rest: input };
  const close = trimmed.indexOf(")");
  if (close === -1) return { rest: input };
  const name = trimmed.slice(1, close).trim();
  const rest = trimmed.slice(close + 1);
  return name ? { author: name, rest } : { rest };
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

export function parseGit(source: string): GitParseResult {
  const commits: Commit[] = [];
  const branchTips = new Map<string, string>();
  let currentBranch = DEFAULT_BRANCH;
  let autoCounter = 0;

  branchTips.set(DEFAULT_BRANCH, "");

  const fail = (line: number, message: string): GitParseResult => ({
    graph: { commits, refs: refsFrom(branchTips, currentBranch) },
    error: { line, message },
  });

  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    // noUncheckedIndexedAccess: lines[i] is string | undefined; the loop
    // stays within bounds so the assertion is safe.
    const withoutComment = (lines[i] ?? "").split("#")[0] ?? "";
    const raw = withoutComment.trim();
    if (raw === "") continue;

    const colonIndex = raw.indexOf(":");
    const head = (colonIndex === -1 ? raw : raw.slice(0, colonIndex)).trim();
    const message =
      colonIndex === -1 ? undefined : raw.slice(colonIndex + 1).trim() || undefined;

    const tokens = head.split(/\s+/);
    const keyword = (tokens[0] ?? "").toLowerCase();
    const arg = tokens[1];

    switch (keyword) {
      case "commit": {
        const parentTip = branchTips.get(currentBranch) ?? "";
        const afterKeyword = head.slice(keyword.length).trimStart();
        let idToken: string | undefined;
        let remainder = afterKeyword;
        if (afterKeyword !== "" && !afterKeyword.startsWith("(")) {
          const m = /^\S+/.exec(afterKeyword);
          idToken = m?.[0];
          remainder = afterKeyword.slice(idToken?.length ?? 0);
        }

        const { author, rest } = takeAuthor(remainder);
        if (rest.trim() !== "") {
          return fail(
            lineNumber,
            `unexpected "${rest.trim()}" after commit — use "commit [id] [(author)] [: message]"`,
          );
        }

        const id = idToken ?? `c${++autoCounter}`;
        if (commits.some((c) => c.id === id)) {
          return fail(lineNumber, `duplicate commit id "${id}"`);
        }
        // An explicit hex-ish id token doubles as the hash; otherwise the
        // commit carries no hash and none is rendered.
        const hash = idToken && HASH_RE.test(idToken) ? idToken : undefined;

        const commit: Commit = {
          id,
          parents: parentTip ? [parentTip] : [],
          branch: currentBranch,
        };
        if (hash !== undefined) commit.hash = hash;
        if (message !== undefined) commit.message = message;
        if (author !== undefined) commit.author = author;
        commits.push(commit);
        branchTips.set(currentBranch, id);
        break;
      }

      case "branch": {
        if (!arg) return fail(lineNumber, `branch needs a name, e.g. "branch feature"`);
        if (branchTips.has(arg)) {
          return fail(lineNumber, `branch "${arg}" already exists`);
        }
        branchTips.set(arg, branchTips.get(currentBranch) ?? "");
        currentBranch = arg;
        break;
      }

      case "checkout": {
        if (!arg) return fail(lineNumber, "checkout needs a branch name");
        if (!branchTips.has(arg)) {
          return fail(lineNumber, `unknown branch "${arg}" — branch it first`);
        }
        currentBranch = arg;
        break;
      }

      case "merge": {
        if (!arg) return fail(lineNumber, `merge needs a branch name, e.g. "merge feature"`);
        if (!branchTips.has(arg)) {
          return fail(lineNumber, `unknown branch "${arg}"`);
        }
        const mainlineTip = branchTips.get(currentBranch) ?? "";
        const mergedTip = branchTips.get(arg) ?? "";
        if (!mainlineTip || !mergedTip) {
          return fail(lineNumber, `nothing to merge — both branches need a commit`);
        }
        const id = `m${++autoCounter}`;
        const mergeCommit: Commit = {
          id,
          parents: [mainlineTip, mergedTip],
          branch: currentBranch,
          message: message ?? `merge ${arg}`,
        };
        commits.push(mergeCommit);
        branchTips.set(currentBranch, id);
        break;
      }

      default:
        return fail(
          lineNumber,
          `unknown command "${keyword}" — use commit, branch, checkout or merge`,
        );
    }
  }

  return {
    graph: { commits, refs: refsFrom(branchTips, currentBranch) },
    error: null,
  };
}
