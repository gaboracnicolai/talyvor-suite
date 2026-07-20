import { cn } from '../lib/cn'

export interface MuNumeralProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Integer micro-units (1e-6). e.g. 12_340567 → 12.340567. */
  micros: number
  unit: 'lens' | 'lxc'
}

const MICRO = 1_000_000
const tick: Record<'lens' | 'lxc', string> = { lens: 'bg-lens', lxc: 'bg-lxc' }

// The µ-split. Whole units read at head size/weight; the micro tail is dimmed and
// underscored so precision is present but recessive. The unit label carries the 2px
// token tick (lens = copper, lxc = steel) — the only colour here. Numerals are ink,
// the tail is faint; never a hue on the digits.
export function MuNumeral({ micros, unit, className, ...props }: MuNumeralProps) {
  const negative = micros < 0
  const abs = Math.abs(Math.trunc(micros))
  const whole = Math.floor(abs / MICRO)
  const micro = abs % MICRO
  const wholeStr = (negative ? '-' : '') + whole.toLocaleString('en-US')
  const microStr = String(micro).padStart(6, '0')
  return (
    <span className={cn('inline-flex items-baseline gap-1 font-mono tabular-nums', className)} {...props}>
      <span className="text-head text-ink">{wholeStr}</span>
      <span className="text-micro text-faint underline">.{microStr}</span>
      <span className="ml-0.5 inline-flex items-center gap-1 self-center text-caption uppercase tracking-wide text-muted">
        <span className={cn('inline-block h-3 w-0.5 rounded-pill', tick[unit])} aria-hidden="true" />
        {unit}
      </span>
    </span>
  )
}
