import { forwardRef } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'h-8 w-full rounded-control border border-rule bg-surface px-2.5',
        'text-body text-ink placeholder:text-faint',
        'transition-colors hover:border-rule-strong',
        'disabled:cursor-not-allowed disabled:opacity-50',
        focusRing,
        className,
      )}
      {...props}
    />
  )
})
