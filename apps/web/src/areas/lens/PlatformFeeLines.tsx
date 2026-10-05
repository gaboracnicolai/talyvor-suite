import { Row } from '@talyvor/ui'
import type { FeeLine } from './spendMath'
import { WindowFigure } from './WindowFloor'

/**
 * B32.69 — the platform fee on AI spend, each of Lens's fee lines as its own row under the window
 * total: Lens's words ("Platform fee 3%") and the µLXC it took. Never folded into the call it is on.
 * A workspace with no fee rows renders nothing.
 */
export function PlatformFeeLines({ fees, floor }: { fees: readonly FeeLine[]; floor: boolean }) {
  // Like the per-model split beside it: rows when there are fees, nothing when there are none. The read
  // failing is the total row's to say (InlineFailure), and the fees are only ever computed from its data.
  return fees.length > 0 ? (
    <div data-testid="lxc-platform-fees">
      {fees.map((f) => (
        <Row
          key={f.label}
          label={<span data-testid="platform-fee-label">{f.label}</span>}
          hint={`${floor ? 'at least ' : ''}on ${f.rows} call${f.rows === 1 ? '' : 's'}`}
        >
          <WindowFigure micros={f.ulxc} unit="lxc" floor={floor} testId="platform-fee-amount" />
        </Row>
      ))}
    </div>
  ) : null
}

/** The window total's hint: it names the platform fee only when the window holds one. */
export const totalHint = (fees: readonly FeeLine[]): string =>
  fees.length > 0
    ? 'every model and the platform fee on it — the window total that left the balance'
    : 'every model — the window total that left the balance'
