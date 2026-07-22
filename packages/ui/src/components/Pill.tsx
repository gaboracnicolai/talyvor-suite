import { cn } from '../lib/cn'

// 'idle' was removed once ("re-add it only alongside a real state that needs it") and
// returns under exactly that clause: Track's issue lifecycle has real states that are
// neither settled, held nor slashed — todo (alive, unstarted) and backlog (parked).
// Two neutral GREYS, dimmer than every hue, so neutral reads as neutral at a glance:
//   idle   — present but unstarted (bg-muted)
//   parked — shelved, dimmest (bg-faint); not dead, that is slashed
export type PillStatus = 'settled' | 'held' | 'slashed' | 'lens' | 'lxc' | 'idle' | 'parked'

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
  idle: 'bg-muted',
  parked: 'bg-faint',
}

export function Pill({ status, children, className, ...props }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-pill border border-rule bg-surface px-2',
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
