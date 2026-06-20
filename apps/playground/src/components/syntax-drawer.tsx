'use client'

import * as React from 'react'

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

/**
 * Header trigger + side drawer for the diagram syntax reference.
 *
 * This is the only CLIENT part: the open/close state and the sheet chrome. The
 * markdown itself is rendered on the SERVER (see `<SyntaxContent>`) and passed in
 * as `children`, so react-markdown is never bundled into the client. The drawer
 * just portals the already-rendered tree into view.
 */
export function SyntaxDrawer({ children }: { children: React.ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger className="text-muted-foreground hover:text-foreground focus-visible:ring-ring text-xs tracking-wide uppercase transition-colors focus-visible:ring-2 focus-visible:outline-none">
        Syntax
      </SheetTrigger>
      <SheetContent side="right" className="gap-0">
        <header className="border-border bg-card flex h-14 shrink-0 items-center gap-2 border-b px-6">
          <SheetTitle className="text-sm font-semibold tracking-wide uppercase">
            Diagram syntax
          </SheetTitle>
          <SheetDescription className="text-muted-foreground sr-only">
            Reference for the flow and git diagram pseudo-code languages.
          </SheetDescription>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
        <footer className="border-border bg-card text-muted-foreground flex h-9 shrink-0 items-center justify-between border-t px-6 text-xs">
          <span>
            Served raw at{' '}
            <a
              href="/syntax.md"
              className="text-foreground hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              /syntax.md
            </a>
          </span>
          <SheetClose className="hover:text-foreground tracking-wide uppercase transition-colors">
            Close
          </SheetClose>
        </footer>
      </SheetContent>
    </Sheet>
  )
}
