import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

export type ButtonVariant = 'default' | 'primary' | 'danger'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** Render as the single child element (Radix Slot) instead of a <button>. */
  asChild?: boolean
}

// primary is the ONLY sanctioned ink-on-colour (accent-ink is a contrast ink, not a
// hue). danger shows destructive intent with a slashed RING, never red text — the
// invariant (text is never a hue) forbids a slashed label. See README §Danger.
const variants: Record<ButtonVariant, string> = {
  default: 'bg-surface text-ink border-rule hover:border-rule-strong active:bg-accent-tint',
  primary: 'bg-accent text-accent-ink border-transparent hover:bg-accent-hover active:bg-accent-hover',
  danger: 'bg-surface text-ink border-slashed hover:bg-canvas active:bg-accent-tint',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', asChild = false, className, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-control border px-3',
        // 200ms is the site's colour transition, measured across eleven served pages
        // (duration-200 × 151, the next most common is 300 × 69). A bare `transition-colors`
        // is 150ms — Tailwind's default, chosen by omission rather than by anyone.
        // active:scale-98 is the press. It is the ONE place the product moves on touch, and
        // it is neutralised under prefers-reduced-motion in theme.css.
        'text-body font-medium transition-colors duration-200 active:scale-98',
        'disabled:pointer-events-none disabled:opacity-50',
        focusRing,
        variants[variant],
        className,
      )}
      {...props}
    />
  )
})
