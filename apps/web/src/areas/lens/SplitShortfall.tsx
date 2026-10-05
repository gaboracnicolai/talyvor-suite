import { Link } from 'react-router-dom'
import { MuNumeral, inlineLink } from '@talyvor/ui'
import type { SplitShortfall as Shortfall } from './spendMath'

/**
 * The sentence that says what the per-model split above it does NOT account for.
 *
 * The split is rendered directly under the window total and reads as its decomposition. It can
 * fall short of it two ways — a charge whose row names no model, and a charge outside a top-N
 * slice — and neither used to leave a mark on the screen. See `splitShortfall` for where each
 * number comes from and for the row shapes talyvor-lens actually writes.
 *
 * ONE LINE PER CAUSE, each carrying its OWN figure. A combined number would need a sentence
 * naming two causes for one amount, and a reader could then check neither half.
 *
 * ⚠ A CLAUSE RENDERS ONLY WHEN ITS FIGURE IS POSITIVE. Zero is the ordinary case (a split that
 * does add up), and a NEGATIVE `unattributed` is the one row shape no lens writer can produce —
 * neither is a shortfall, and claiming one would be the same defect in the other direction.
 *
 * ⚠ `floor` rides through for the reason every other figure on these cards carries it: when the
 * window holds more rows than one ledger page, this figure is summed from the same page and is a
 * floor too. `WindowIncomplete` explains the page ceiling; this explains the split.
 */
export function SplitShortfall({
  unattributed,
  notShown,
  shownCount,
  floor,
  testId,
}: Shortfall & { shownCount: number; floor: boolean; testId?: string }) {
  if (unattributed <= 0 && notShown <= 0) return null
  return (
    <div data-testid={testId} className="px-gutter py-3 text-caption text-muted">
      {unattributed > 0 ? (
        <p>
          {floor ? 'At least ' : ''}
          <MuNumeral micros={unattributed} unit="lxc" className="align-baseline" /> of the total
          above is not broken down by model, because those charges did not record which model
          they were for; each one is listed in the{' '}
          <Link className={inlineLink} to="/ledger">
            Ledger
          </Link>
          .
        </p>
      ) : null}
      {notShown > 0 ? (
        <p>
          {floor ? 'At least ' : ''}
          <MuNumeral micros={notShown} unit="lxc" className="align-baseline" /> more went to
          models other than the {shownCount} shown here; every charge is listed in the{' '}
          <Link className={inlineLink} to="/ledger">
            Ledger
          </Link>
          .
        </p>
      ) : null}
    </div>
  )
}
