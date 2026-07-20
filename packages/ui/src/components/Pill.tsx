import { cn } from '../lib/cn'

// 'idle' was removed: nothing could produce it. No ledger row is ever "idle" (it would be
// a UI-only resting state), and no screen used it — a variant nothing can produce is dead
// surface. Re-add it only alongside a real state that needs it.
export type PillStatus = 'settled' | 'held' | 'slashed' | 'lens' | 'lxc'

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: PillStatus
  children: React.ReactNode
}

// The dot carries the hue; the LABEL is muted ink. A Pill takes a `status`, never a
// colour prop that could land on text (README §The invariant).
const dot: Record<PillStatus, string> = {
  settled: 'bg-settled',
  held: 'bg-held',
  slashed: 'bg-slashed',
  lens: 'bg-lens',
  lxc: 'bg-lxc',
}

export function Pill({ status, children, className, ...props }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-pill border border-rule bg-surface px-2',
        'text-caption uppercase tracking-wide text-muted',
        className,
      )}
      {...props}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-pill', dot[status])} aria-hidden="true" />
      {children}
    </span>
  )
}
