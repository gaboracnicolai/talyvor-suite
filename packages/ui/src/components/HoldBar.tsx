import { cn } from '../lib/cn'

export interface HoldBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Elapsed and total in the same unit; the fill is elapsed/total. */
  elapsed: number
  total: number
  /** Label for the remaining time, e.g. "4h left". Defaults to the raw remainder. */
  remainingLabel?: string
}

// The hold hairline: a 2px track that fills by elapsed fraction in the held hue, with
// a muted remaining-time label. Colour lives in the 2px bar only.
export function HoldBar({ elapsed, total, remainingLabel, className, ...props }: HoldBarProps) {
  const safeTotal = total > 0 ? total : 1
  const fraction = Math.min(1, Math.max(0, elapsed / safeTotal))
  const pct = Math.round(fraction * 1000) / 10
  const remaining = Math.max(0, total - elapsed)
  const label = remainingLabel ?? `${remaining.toLocaleString('en-US')} left`
  return (
    <div className={cn('flex items-center gap-2', className)} {...props}>
      <div
        className="relative h-0.5 flex-1 overflow-hidden rounded-pill bg-rule-strong"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Hold elapsed ${Math.round(pct)}%`}
      >
        {/* width is a runtime value → inline style, not a Tailwind arbitrary class. */}
        <div className="absolute inset-y-0 left-0 rounded-pill bg-held" style={{ width: `${pct}%` }} />
      </div>
      <span className="shrink-0 text-caption tabular-nums text-muted">{label}</span>
    </div>
  )
}
