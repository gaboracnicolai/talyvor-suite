import { forwardRef } from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>

/** An affordance: the track carries the colour (accent when on), the thumb is
 *  surface. No text. Radix supplies role="switch" + aria-checked. */
export const Switch = forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  function Switch({ className, ...props }, ref) {
    return (
      <SwitchPrimitive.Root
        ref={ref}
        className={cn(
          'peer inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-pill border border-transparent',
          'bg-faint transition-colors data-[state=checked]:bg-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
          focusRing,
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'pointer-events-none block h-3 w-3 translate-x-0.5 rounded-pill bg-surface shadow-sm',
            'transition-transform data-[state=checked]:translate-x-3.5',
          )}
        />
      </SwitchPrimitive.Root>
    )
  },
)
