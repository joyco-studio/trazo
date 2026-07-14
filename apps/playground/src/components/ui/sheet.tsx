'use client'
import { XIcon } from 'lucide-react'
import { Dialog as SheetPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close
const SheetTitle = SheetPrimitive.Title
const SheetDescription = SheetPrimitive.Description

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & {
    side?: 'left' | 'right'
    /**
     * When true the backdrop stays fully transparent and non-blurring, so the
     * content behind the sheet (e.g. the live render preview) stays crisp and
     * visible while the sheet is open. The overlay still captures outside clicks
     * to dismiss. Default false = the standard dimmed + blurred scrim.
     */
    seeThrough?: boolean
  }
>(({ className, children, side = 'right', seeThrough = false, ...props }, ref) => (
  <SheetPrimitive.Portal>
    <SheetPrimitive.Overlay
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50',
        seeThrough ? 'bg-transparent' : 'bg-black/50 backdrop-blur-sm'
      )}
    />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(
        'bg-card text-card-foreground border-border fixed inset-y-0 z-50 flex w-full max-w-xl flex-col gap-px shadow-lg transition-transform data-[state=closed]:duration-200 data-[state=open]:duration-300 ease-in-out',
        side === 'right'
          ? 'right-0 border-l data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right'
          : 'left-0 border-r data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
        className
      )}
      {...props}
    >
      {children}
      <SheetPrimitive.Close
        aria-label="Close"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-3.5 right-4 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <XIcon className="size-4" aria-hidden="true" />
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPrimitive.Portal>
))
SheetContent.displayName = SheetPrimitive.Content.displayName

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
}
