/**
 * playground DSL — a tiny, forgiving line-based language for describing a commit
 * DAG, parsed into a rama `CommitGraph`.
 *
 * Grammar (one statement per line, `#` starts a comment, blank lines ignored):
 *
 *   commit [id] [(<author>)] [: message]
 *   commit [id] [(<author>)] ["message with : colons"]
 *                             add a commit on the current branch; parent is the
 *                             branch's current tip. `id` optional (auto: c1, c2…).
 *                             `(<author>)` optional author name in parens.
 *                             Message is either `: text` or `"text"` (double
 *                             quotes allow any characters, including colons).
 *                             Examples:
 *                               commit : init repo
 *                               commit "feat: add feature"
 *                               commit e1 (Elvira) : checkout work
 *                               commit (Homero) "fix: receipt page"
 *   branch <name>             create <name> off the current tip and check it out.
 *   checkout <name>           switch the current branch to <name>.
 *   merge <name> [: message]  merge branch <name> into the current branch
 *   merge <name> ["message"]  (creates a merge commit with two parents).
 *
 * A commit only carries a `hash` when one is supplied explicitly — i.e. the
 * `id` token itself is a 6+ hex-digit hash (e.g. `commit a1b2c3d`). Without one
 * the commit has no hash and none is rendered. Author and message are likewise
 * optional; a commit with no hash, author, or message renders as a bare node.
 *
 * The first branch is `main`. Errors are reported with a 1-based line number and
 * a friendly message; the caller keeps the last good graph rendered.
 */

import type { Commit, CommitGraph } from "@joycostudio/trazo";

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  graph: CommitGraph;
  error: ParseError | null;
}

const DEFAULT_BRANCH = "main";

/** A token that already looks like a short git hash (6+ hex digits). */
const HASH_RE = /^[0-9a-f]{6,}$/i;

/**
 * Pull an optional leading `(author)` group off a string, returning the author
 * (if present) and the remaining text.
 */
function takeAuthor(input: string): { author?: string; rest: string } {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("(")) return { rest: input };
  const close = trimmed.indexOf(")");
  if (close === -1) return { rest: input };
  const author = trimmed.slice(1, close).trim() || undefined;
  return { author, rest: trimmed.slice(close + 1) };
}

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

    // Extract the optional message: quoted syntax ("...") takes priority over
    // colon syntax (: ...) so messages can contain colons freely.
    let head: string;
    let message: string | undefined;
    const quoteStart = raw.indexOf('"');
    if (quoteStart !== -1) {
      const quoteEnd = raw.indexOf('"', quoteStart + 1);
      if (quoteEnd === -1) {
        return fail(lineNumber, 'unclosed string — close the message with "');
      }
      if (raw.slice(quoteEnd + 1).trim() !== "") {
        return fail(lineNumber, 'unexpected content after closing " — nothing should follow the message');
      }
      head = raw.slice(0, quoteStart).trim();
      message = raw.slice(quoteStart + 1, quoteEnd) || undefined;
    } else {
      const colonIndex = raw.indexOf(":");
      head = (colonIndex === -1 ? raw : raw.slice(0, colonIndex)).trim();
      message = colonIndex === -1 ? undefined : raw.slice(colonIndex + 1).trim() || undefined;
    }

    const tokens = head.split(/\s+/);
    const keyword = tokens[0].toLowerCase();
    const arg = tokens[1];

    switch (keyword) {
      case "commit": {
        const parentTip = branchTips.get(currentBranch) ?? "";

        // After the `commit` keyword, the head may hold `[id] [(author)]`. The
        // id is an optional first token that is NOT an opening paren.
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
            `unexpected “${rest.trim()}” after commit — use “commit [id] [(author)] [: message]” or “commit [id] [(author)] [\\”message\\”]”`,
          );
        }

        const id = idToken ?? `c${++autoCounter}`;
        if (commits.some((c) => c.id === id)) {
          return fail(lineNumber, `duplicate commit id “${id}”`);
        }
        // An explicit hex-ish id token doubles as the hash; otherwise the
        // commit carries no hash and none is rendered.
        const hash = idToken && HASH_RE.test(idToken) ? idToken : undefined;

        commits.push({
          id,
          parents: parentTip ? [parentTip] : [],
          branch: currentBranch,
          message,
          ...(hash !== undefined ? { hash } : {}),
          ...(author !== undefined ? { author } : {}),
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
 * The default git seed — a reconstruction of the JOYCO log "phantom merge
 * conflicts" story, annotated with branch names, authors, and short hashes.
 *
 * The DSL can't literally model a squash + rebase transplant, so the graph
 * APPROXIMATES it to tell the story visually: two branches diverge off `B`
 * (Elvira's checkout work, with Homero's receipts stacked on top of it), then
 * back on `main` a single squash commit `S` collapses Elvira's branch, and
 * Homero's two commits are REPLAYED (h1'/h2') on top of that squash. The
 * commit messages carry the narrative. Hashes are short hex-ish.
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
