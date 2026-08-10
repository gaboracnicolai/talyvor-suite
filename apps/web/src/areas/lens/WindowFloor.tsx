import { Link } from 'react-router-dom'
import { MuNumeral } from '@talyvor/ui'

// A THIRD DRESSING FOR A NUMBER, because this product already had exactly two and neither
// is true here.
//
//   · EXACT   — a µ count straight off ledger rows: MuNumeral, never rounded, never a float.
//   · DERIVED — a rate or a month-USD float: a ≈-marked muted caption.
//   · FLOOR   — a sum over ONE ledger page when the window holds more rows than the page.
//
// A floor rendered as an exact numeral is the most confident presentation the design system
// has, attached to the one kind of number it cannot certify. MEASURED in real Chrome against
// the real BFF binary with 260 in-window rows upstream: /spend printed `200,000 µLXC` and
// `200 charges` while the true window total was `260,000` — and two rows above, on the same
// card, the ≈-marked month figure read `≈ $0.26`, which IS 260,000 µLXC. The estimate was
// right and the exact numeral was 23% low.
//
// The mark is a word, not a new token or a new colour: the numeral keeps its face, and the
// sentence below the card says what is missing and where the whole ledger is.

/** An exact µ figure, prefixed with `at least` when it is a floor rather than a total. */
export function WindowFigure({
  micros,
  unit,
  floor,
  testId,
}: {
  micros: number
  unit: 'lens' | 'lxc'
  floor: boolean
  testId?: string
}) {
  return (
    <span data-testid={testId} className="inline-flex items-baseline gap-1.5">
      {floor ? <span className="text-caption text-muted">at least</span> : null}
      <MuNumeral micros={micros} unit={unit} />
    </span>
  )
}

/**
 * The sentence that says why a figure on this card is a floor.
 *
 * It names the cause (the window holds more rows than one page) and the place the whole
 * ledger is, rather than asking the reader to widen a window that would not help — the
 * ceiling is on the PAGE, not on the window, so a wider window makes the shortfall larger.
 */
export function WindowIncomplete({ days, pageSize, testId }: { days: number; pageSize: number; testId?: string }) {
  return (
    <div data-testid={testId} className="px-gutter py-3 text-caption text-muted">
      The last {days} days hold more than {pageSize} ledger rows, and {pageSize} is the most one
      read can return — so the figures above count the most recent {pageSize} and are floors, not
      totals. The{' '}
      <Link className="underline" to="/ledger">
        ledger
      </Link>{' '}
      pages through all of them.
    </div>
  )
}
