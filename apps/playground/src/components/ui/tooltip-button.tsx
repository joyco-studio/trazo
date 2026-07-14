'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A {@link Button} that shows a tooltip on hover/focus. Use for icon-only
 * buttons: pass the visible action name as `tooltip` and keep `aria-label` for
 * screen readers (the tooltip is a visual affordance, not a replacement for the
 * accessible name). The tooltip text defaults to `aria-label` when omitted.
 */
export interface TooltipButtonProps extends React.ComponentProps<typeof Button> {
  /** Tooltip label. Falls back to `aria-label` when not given. */
  tooltip?: React.ReactNode
  /** Which side to show the tooltip on. Default "bottom". */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

function TooltipButton({ tooltip, tooltipSide = 'bottom', ...props }: TooltipButtonProps) {
  const label = tooltip ?? props['aria-label']
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...props} />
      </TooltipTrigger>
      {label ? (
        <TooltipContent side={tooltipSide} sideOffset={6}>
          {label}
        </TooltipContent>
      ) : null}
    </Tooltip>
  )
}

export { TooltipButton }
