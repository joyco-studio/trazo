'use client'

/**
 * CodeEditor — a lightweight syntax-highlighted editor for the DSL panes.
 *
 * No editor library: a transparent <textarea> sits ON TOP of a highlighted
 * <pre> layer, both sharing identical font/metrics/padding so the caret and
 * selection line up with the painted tokens. A line-number gutter scrolls in
 * lock-step with the textarea. Highlighting is a pure, per-mode tokenizer —
 * deterministic and SSR-safe (server and client paint the same markup).
 *
 * The textarea remains the single source of truth for editing (native caret,
 * selection, undo, IME, paste) — we only paint behind it.
 */

import { useCallback, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export type EditorMode = 'git' | 'flow' | 'sequence' | 'block'

/** Per-mode statement/keyword sets, matched at the start of a token. */
const KEYWORDS: Record<EditorMode, readonly string[]> = {
  git: ['commit', 'branch', 'checkout', 'merge', 'note', 'group', 'end'],
  flow: ['flow', 'subgraph', 'end'],
  sequence: ['sequence', 'participant', 'note', 'over'],
  block: ['block', 'columns'],
}

type Tok = { text: string; cls?: string }

/**
 * Tokenize ONE line into styled spans. Kept intentionally simple — enough to
 * make structure pop (keywords, strings, comments, arrows, :role tags, (author))
 * without a real grammar. Order matters: comments and strings win first.
 */
function tokenizeLine(line: string, mode: EditorMode): Tok[] {
  // Whole-line comment.
  const hashAt = commentIndex(line)
  if (hashAt === 0) return [{ text: line, cls: 'text-muted-foreground/60' }]

  const head = hashAt === -1 ? line : line.slice(0, hashAt)
  const comment = hashAt === -1 ? '' : line.slice(hashAt)

  const out: Tok[] = []
  let i = 0
  const keywords = KEYWORDS[mode]
  // Leading whitespace.
  const wsMatch = /^\s*/.exec(head)
  if (wsMatch && wsMatch[0]) {
    out.push({ text: wsMatch[0] })
    i = wsMatch[0].length
  }
  // Leading keyword (only at the statement head, after indentation).
  const rest = head.slice(i)
  const kw = keywords.find((k) => new RegExp(`^${k}\\b`).test(rest))
  if (kw) {
    out.push({ text: rest.slice(0, kw.length), cls: 'text-primary font-medium' })
    i += kw.length
  }

  // Scan the remainder for strings, arrows, :roles, (authors).
  let buf = ''
  const flush = () => {
    if (buf) out.push({ text: buf })
    buf = ''
  }
  const tail = head.slice(i)
  for (let j = 0; j < tail.length; ) {
    const ch = tail[j]!
    // Double-quoted string.
    if (ch === '"') {
      flush()
      let k = j + 1
      while (k < tail.length && !(tail[k] === '"' && tail[k - 1] !== '\\')) k++
      out.push({ text: tail.slice(j, Math.min(k + 1, tail.length)), cls: 'text-success' })
      j = k + 1
      continue
    }
    // Arrows / connectors (flow + sequence): -->, ==>, ---, <-->, ->>, -->>.
    const arrow = /^(<-->|-->>|->>|-->|==>|---|--)/.exec(tail.slice(j))
    if (arrow) {
      flush()
      out.push({ text: arrow[0], cls: 'text-warning' })
      j += arrow[0].length
      continue
    }
    // :role tag (flow/block/git labels): a colon then an identifier.
    const role = /^:[A-Za-z][\w-]*/.exec(tail.slice(j))
    if (role) {
      flush()
      out.push({ text: role[0], cls: 'text-info' })
      j += role[0].length
      continue
    }
    // (author) group.
    if (ch === '(') {
      const close = tail.indexOf(')', j)
      if (close !== -1) {
        flush()
        out.push({ text: tail.slice(j, close + 1), cls: 'text-muted-foreground' })
        j = close + 1
        continue
      }
    }
    buf += ch
    j++
  }
  flush()

  if (comment) out.push({ text: comment, cls: 'text-muted-foreground/60' })
  return out
}

/** Index of the first `#` outside a double-quoted span, or -1. */
function commentIndex(s: string): number {
  let inQuote = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '"' && (i === 0 || s[i - 1] !== '\\')) inQuote = !inQuote
    else if (c === '#' && !inQuote) return i
  }
  return -1
}

export interface CodeEditorProps {
  id?: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  mode: EditorMode
  className?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

export function CodeEditor({
  id,
  value,
  onChange,
  mode,
  className,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedby,
}: CodeEditorProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  const lines = useMemo(() => value.split('\n'), [value])
  const highlighted = useMemo(
    () => lines.map((line) => tokenizeLine(line, mode)),
    [lines, mode]
  )

  // Keep the highlight layer + gutter scroll-locked to the textarea.
  const syncScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (preRef.current) {
      preRef.current.scrollTop = el.scrollTop
      preRef.current.scrollLeft = el.scrollLeft
    }
    if (gutterRef.current) gutterRef.current.scrollTop = el.scrollTop
    setScrollTop(el.scrollTop)
  }, [])

  // Shared metrics — the textarea, <pre>, and gutter MUST match exactly or the
  // caret drifts from the painted glyphs.
  const metrics = 'font-mono text-sm leading-relaxed'

  return (
    <div
      data-slot="code-editor"
      className={cn('bg-card relative flex min-h-[55vh] flex-1 overflow-hidden lg:min-h-0', className)}
    >
      {/* Line-number gutter. */}
      <div
        ref={gutterRef}
        aria-hidden="true"
        className={cn(
          'text-muted-foreground/40 pointer-events-none w-10 shrink-0 overflow-hidden py-4 pr-2 text-right tabular-nums select-none',
          metrics
        )}
      >
        {lines.map((_l, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>

      <div className="relative flex-1">
        {/* Highlight layer (painted behind the transparent textarea). */}
        <pre
          ref={preRef}
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 overflow-hidden px-4 py-4 whitespace-pre-wrap break-words',
            metrics
          )}
        >
          {highlighted.map((toks, li) => (
            <div key={li}>
              {toks.length === 0 ? '\n' : toks.map((t, ti) => (
                <span key={ti} className={t.cls}>
                  {t.text}
                </span>
              ))}
            </div>
          ))}
        </pre>

        {/* The real editor — transparent text, visible caret, on top. */}
        <textarea
          id={id}
          value={value}
          onChange={onChange}
          onScroll={syncScroll}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          className={cn(
            'absolute inset-0 resize-none border-0 bg-transparent px-4 py-4 whitespace-pre-wrap text-transparent caret-foreground shadow-none outline-none focus-visible:ring-0',
            metrics
          )}
          style={{ WebkitTextFillColor: 'transparent' }}
          data-scroll-top={scrollTop}
        />
      </div>
    </div>
  )
}
