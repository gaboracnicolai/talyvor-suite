import { cn } from '../lib/cn'

export type Tier = 1 | 2 | 3 | 4

export interface TierDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  tier: Tier
  label?: string
}

// The routing ramp. Four hues — the densest colour in the system. The dot is the
// affordance; any label is muted ink.
const hue: Record<Tier, string> = {
  1: 'bg-tier1',
  2: 'bg-tier2',
  3: 'bg-tier3',
  4: 'bg-tier4',
}

export function TierDot({ tier, label, className, ...props }: TierDotProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      role="img"
      aria-label={label ?? `Tier ${tier}`}
      {...props}
    >
      <span className={cn('h-2 w-2 shrink-0 rounded-pill', hue[tier])} />
      {label ? <span className="text-caption text-muted">{label}</span> : null}
    </span>
  )
}
