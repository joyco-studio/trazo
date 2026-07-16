---
"@joycostudio/trazo": patch
---

fix(trazo): strip stray null byte from `layout-flow.ts` comment

A single `NUL` (`\x00`) byte had crept into a comment in `layout-flow.ts`,
where a space belonged — the comment reads `keyed "from to"`, matching how
`edgeKey` joins its two node ids. The byte had no runtime effect (it lived
inside a comment), but any file containing a null byte is treated as
**binary** by `grep`/`ripgrep`, so the whole file silently dropped out of
codebase-wide text searches. Replacing the `NUL` with the intended space
restores the file to plain text with no behavior change.
