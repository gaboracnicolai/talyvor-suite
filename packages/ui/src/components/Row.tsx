import { cn } from '../lib/cn'

export interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Left-hand label. */
  label: React.ReactNode
  /** Optional secondary description under the label. */
  hint?: React.ReactNode
  /** Right-hand control. */
  children?: React.ReactNode
}

// The settings row: label left, control right, 38px tall, hairline divider. The
// label is ink, the hint is muted — never a hue.
export function Row({ label, hint, children, className, ...props }: RowProps) {
  return (
    <div
      className={cn(
        'flex min-h-row items-center justify-between gap-gutter px-gutter py-2',
        'border-b border-rule last:border-b-0',
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <div className="truncate text-body text-ink">{label}</div>
        {hint ? <div className="truncate text-caption font-normal text-muted">{hint}</div> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  )
}
