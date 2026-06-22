import { describe, it, expect } from "vitest";
import { parseGit } from "../src/parse-git.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function ok(source: string) {
  const result = parseGit(source);
  expect(result.error).toBeNull();
  return result.graph;
}

function err(source: string) {
  const result = parseGit(source);
  expect(result.error).not.toBeNull();
  return result.error!;
}

// ── basic parsing ─────────────────────────────────────────────────────────────

describe("parseGit — basic", () => {
  it("parses an empty source", () => {
    const g = ok("");
    expect(g.commits).toHaveLength(0);
  });

  it("ignores blank lines and comments", () => {
    const g = ok(`
      # a comment
      commit
      # another comment
    `);
    expect(g.commits).toHaveLength(1);
  });

  it("auto-assigns ids when none given", () => {
    const g = ok("commit\ncommit\ncommit");
    expect(g.commits.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("uses explicit id token", () => {
    const g = ok("commit abc");
    expect(g.commits[0]?.id).toBe("abc");
  });

  it("sets hash only when id is 6+ hex chars", () => {
    const g = ok("commit a1b2c3\ncommit abc");
    expect(g.commits[0]?.hash).toBe("a1b2c3");
    expect(g.commits[1]?.hash).toBeUndefined();
  });

  it("sets author from parens", () => {
    const g = ok("commit (Alice)");
    expect(g.commits[0]?.author).toBe("Alice");
  });

  it("sets message from colon syntax", () => {
    const g = ok("commit : hello world");
    expect(g.commits[0]?.message).toBe("hello world");
  });

  it("omits message when absent", () => {
    const g = ok("commit");
    expect(g.commits[0]?.message).toBeUndefined();
  });

  it("chains parent correctly", () => {
    const g = ok("commit\ncommit");
    expect(g.commits[1]?.parents).toEqual(["c1"]);
  });

  it("root commit has empty parents", () => {
    const g = ok("commit");
    expect(g.commits[0]?.parents).toEqual([]);
  });

  it("parses branch and checkout", () => {
    const g = ok("commit\nbranch feat\ncommit\ncheckout main\ncommit");
    const ids = g.commits.map((c) => c.id);
    expect(ids).toEqual(["c1", "c2", "c3"]);
    expect(g.commits[1]?.branch).toBe("feat");
    expect(g.commits[2]?.branch).toBe("main");
  });

  it("parses merge", () => {
    const g = ok("commit\nbranch feat\ncommit\ncheckout main\ncommit\nmerge feat");
    const merge = g.commits.at(-1)!;
    expect(merge.parents).toHaveLength(2);
  });
});

// ── quoted message syntax ─────────────────────────────────────────────────────

describe("parseGit — quoted messages", () => {
  it("parses a quoted message with a colon inside", () => {
    const g = ok('commit "feat: add feature"');
    expect(g.commits[0]?.message).toBe("feat: add feature");
  });

  it("quoted message with id and author", () => {
    const g = ok('commit a1b2c3 (Alice) "fix: crash"');
    expect(g.commits[0]?.hash).toBe("a1b2c3");
    expect(g.commits[0]?.author).toBe("Alice");
    expect(g.commits[0]?.message).toBe("fix: crash");
  });

  it("quoted message with multiple colons", () => {
    const g = ok('commit "feat: step 1: substep"');
    expect(g.commits[0]?.message).toBe("feat: step 1: substep");
  });

  it("empty quoted message is treated as no message", () => {
    const g = ok('commit ""');
    expect(g.commits[0]?.message).toBeUndefined();
  });

  it("errors on unclosed quote", () => {
    const e = err('commit "unclosed');
    expect(e.message).toMatch(/unclosed/i);
    expect(e.line).toBe(1);
  });

  it("errors on content after closing quote", () => {
    const e = err('commit "msg" extra');
    expect(e.message).toMatch(/unexpected/i);
  });
});

// ── comment stripping respects quotes ─────────────────────────────────────────

describe("parseGit — comment stripping", () => {
  it("strips a real comment after the statement", () => {
    const g = ok("commit # this is a comment");
    expect(g.commits).toHaveLength(1);
  });

  it("does not strip # inside a quoted message", () => {
    const g = ok('commit "fix #123 bug"');
    expect(g.commits[0]?.message).toBe("fix #123 bug");
  });

  it("still strips # in a colon message (use quoted syntax for # in messages)", () => {
    // The colon-syntax message is not a quoted span, so # is a comment char.
    // Use commit "fix #123 bug" to preserve the hash reference.
    const g = ok("commit : fix #123 bug");
    expect(g.commits[0]?.message).toBe("fix");
  });
});

// ── error cases ───────────────────────────────────────────────────────────────

describe("parseGit — errors", () => {
  it("errors on unknown keyword", () => {
    const e = err("rebase main");
    expect(e.line).toBe(1);
  });

  it("errors on duplicate commit id", () => {
    const e = err("commit abc\ncommit abc");
    expect(e.line).toBe(2);
    expect(e.message).toMatch(/duplicate/i);
  });

  it("errors on branch with no name", () => {
    const e = err("branch");
    expect(e.message).toMatch(/branch needs a name/i);
  });

  it("errors on checkout of unknown branch", () => {
    const e = err("checkout unknown");
    expect(e.message).toMatch(/unknown branch/i);
  });

  it("errors on merge with no name", () => {
    const e = err("commit\nmerge");
    expect(e.message).toMatch(/merge needs a branch name/i);
  });
});
