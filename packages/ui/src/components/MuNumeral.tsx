import { cn } from '../lib/cn'
import { CaseSafe } from './CaseSafe'

export interface MuNumeralProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Integer micro-units (1e-6). e.g. 12_340567 → 12.340567; 64 → 64 µ. */
  micros: number
  unit: 'lens' | 'lxc'
}

const MICRO = 1_000_000
const tick: Record<'lens' | 'lxc', string> = { lens: 'bg-lens', lxc: 'bg-lxc' }

// The unit label carries the only colour: a 2px token tick (lens = copper, lxc = steel).
// `micro` prepends a µ that must NOT be uppercased — CSS text-transform maps µ (U+00B5)
// to Greek capital Mu, so it goes through CaseSafe while the letters uppercase.
//
// ⚠ THIS USED TO HAND-ROLL `<span className="normal-case">µ</span>` and was the ONLY site in the
// product that protected anything, while twenty other `uppercase` class lists took their text from
// props — Landing's unit label among them, which shipped `MLXC`. One shape now, in CaseSafe, so the
// protection is not a thing each author has to have read this comment to know about.
function UnitLabel({ unit, micro = false }: { unit: 'lens' | 'lxc'; micro?: boolean }) {
  return (
    <span className="ml-0.5 inline-flex items-center gap-1 self-center font-figure text-eyebrow uppercase text-muted">
      <span className={cn('inline-block h-3 w-0.5 rounded-pill', tick[unit])} aria-hidden="true" />
      {micro ? <CaseSafe>µ</CaseSafe> : null}
      {unit}
    </span>
  )
}

/**
 * The µ-split. Two renderings, one component:
 *
 *  - **≥ 1 unit** (`whole ≥ 1`): whole units read at head size/ink; the six-digit micro
 *    tail is dimmed and underscored so precision is present but recessive
 *    (`12.340567 LENS` → `12` · `.340567`).
 *  - **< 1 unit** (`whole === 0`): render the µ-integer the ledger actually stores, at
 *    head size, and switch the unit to µLENS/µLXC (`64` · `µLXC`, not `0.000064 LXC`).
 *
 * Why the crossover is exactly `whole === 0`: below one whole unit the decimal form has
 * *nothing* in its emphasised slot — every significant digit falls into the recessive
 * tail, so the component's premise ("meaning lives in the whole part") is false by
 * construction. `whole === 0` is precisely that set, and the µ-integer restores the
 * premise (the whole number IS the value) with the same "big part carries meaning" rule
 * at both scales, rather than two visual treatments of the decimal form. See README §MuNumeral.
 */
export function MuNumeral({ micros, unit, className, ...props }: MuNumeralProps) {
  const negative = micros < 0
  const abs = Math.abs(Math.trunc(micros))
  const whole = Math.floor(abs / MICRO)
  const micro = abs % MICRO
  const sign = negative ? '-' : ''

  // THE FIGURE FACE. Mono with tabular figures — the same shape the public site puts
  // on every quoted number.
  //
  // ⚠ This reverses the earlier "numerals are SANS; mono is for identifiers" rule, and
  // the reversal is the point rather than a tidy-up. That rule rested on mono being a
  // FOREIGN face in this interface, appearing only on SHAs and key prefixes, so seeing
  // it meant "machine string you might copy". Since the type language was ported, mono
  // is the face of every eyebrow label on every screen — it no longer says "identifier",
  // it says "measured", and a money figure is the most measured thing here. What still
  // separates an identifier from a figure is the tracking and the size step, not the
  // family. See preset.ts §THE FIGURE FACE.
  const wrap = 'inline-flex items-baseline gap-1 font-figure'

  if (whole === 0) {
    return (
      <span className={cn(wrap, className)} {...props}>
        <span className="text-head text-ink">{sign}{micro.toLocaleString('en-US')}</span>
        <UnitLabel unit={unit} micro />
      </span>
    )
  }

  const wholeStr = sign + whole.toLocaleString('en-US')
  const microStr = String(micro).padStart(6, '0')
  return (
    <span className={cn(wrap, className)} {...props}>
      <span className="text-head text-ink">{wholeStr}</span>
      <span className="text-micro text-faint underline">.{microStr}</span>
      <UnitLabel unit={unit} />
    </span>
  )
}
