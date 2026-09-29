import { forwardRef } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/** An unprefixed width class (w-28, w-56) — a responsive one (wide:w-56) still sits on top of w-full. */
const WIDTH = /(?:^|\s)w-/

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'h-8 rounded-control border border-rule bg-surface px-2.5',
        // cn() is plain clsx, so a width passed in would sit beside w-full, and w-full comes later in
        // Tailwind's sheet and wins. Full width is only the default: a width the caller gives replaces it.
        !WIDTH.test(className ?? '') && 'w-full',
        'text-body text-ink placeholder:text-faint',
        'transition-colors duration-200 hover:border-rule-strong',
        'disabled:cursor-not-allowed disabled:opacity-50',
        focusRing,
        className,
      )}
      {...props}
    />
  )
})
