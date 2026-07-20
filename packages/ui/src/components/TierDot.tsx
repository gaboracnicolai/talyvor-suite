import { cn } from '../lib/cn'

export type Tier = 'cheap' | 'capable'

export interface TierDotProps extends React.HTMLAttributes<HTMLSpanElement> {
  tier: Tier
  /** Optional text label; defaults to the tier name for the accessible label. */
  label?: string
}

// The routing ramp — TWO categories, not four. Hue encodes CATEGORY: cool = cheap/fast
// (tier1), warm = capable/expensive (tier3). Two well-separated hues are self-ranking
// (cool reads before warm), so a numeral is UNNECESSARY — the dot plus an optional
// word carries it. (The inverse of the four-hue case, where the numeral made the hue
// redundant.) See README §The ramp.
const hue: Record<Tier, string> = {
  cheap: 'bg-tier1',
  capable: 'bg-tier3',
}

export function TierDot({ tier, label, className, ...props }: TierDotProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      role="img"
      aria-label={label ?? tier}
      {...props}
    >
      <span className={cn('h-2 w-2 shrink-0 rounded-pill', hue[tier])} />
      {label ? <span className="text-caption text-muted">{label}</span> : null}
    </span>
  )
}
