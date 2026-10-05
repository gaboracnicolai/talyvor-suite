import type { LedgerRow } from '../../lib/api'

// B28.268 — rows written in ONE transaction share a timestamp (Postgres `now()` is the
// transaction's start), and Lens orders the ledger by created_at alone. A settle writes its
// release and its delivered charge together, so the two come back in either order — and in
// the wrong one, neither row's balance follows from the row below it. Within each run of
// equal timestamps this puts back the order the balances chain in, newest first.

/** Longest run that is reordered; a longer one is left as it came (6! orders is the ceiling). */
const MAX_RUN = 6

/** The balance a row started from — what the row below it should end on. */
const startOf = (r: LedgerRow) => r.balanceAfter - r.amount

/** How many neighbouring pairs in `seq` add up: each row's start is the next row's balance. */
function links(seq: (LedgerRow | undefined)[]): number {
  let n = 0
  for (let k = 0; k + 1 < seq.length; k++) {
    const a = seq[k]
    const b = seq[k + 1]
    if (a && b && startOf(a) === b.balanceAfter) n++
  }
  return n
}

function* orders<T>(xs: T[]): Generator<T[]> {
  if (xs.length <= 1) {
    yield xs
    return
  }
  for (let i = 0; i < xs.length; i++) {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)]
    for (const tail of orders(rest)) yield [xs[i], ...tail]
  }
}

/** The order of `run` that adds up with the most neighbours; the order it came in when none does better. */
function bestOrder(run: LedgerRow[], newer?: LedgerRow, older?: LedgerRow): LedgerRow[] {
  let best = run
  let bestLinks = links([newer, ...run, older])
  for (const o of orders(run)) {
    const n = links([newer, ...o, older])
    if (n > bestLinks) {
      best = o
      bestLinks = n
    }
  }
  return best
}

/** `rows` (newest first) with every run of equal timestamps in the order its balances chain in. */
export function chainOrder(rows: LedgerRow[]): LedgerRow[] {
  const out = [...rows]
  for (let i = 0; i < out.length; ) {
    let j = i + 1
    while (j < out.length && out[j].created_at === out[i].created_at) j++
    if (j - i > 1 && j - i <= MAX_RUN) out.splice(i, j - i, ...bestOrder(out.slice(i, j), out[i - 1], out[j]))
    i = j
  }
  return out
}
