import type { PillStatus } from '@talyvor/ui'
import type { Token } from '../../lib/api'

// Account MOVEMENTS — grants, purchases, spends, cross-token conversions. These are not
// points in a mint's lifecycle, so they carry NO settled/held/slashed status and get no
// Pill: the row shows its type as a plain ink label. (Confirmed against the live ledger:
// LXC rows are admin_grant / purchase / spend; LENS conversions are convert_to_lxc.)
const MOVEMENTS = new Set([
  'spend',
  'purchase',
  'admin_grant',
  'convert_to_lxc',
  'convert_from_lens',
])

/**
 * Map a ledger row onto the Pill's lifecycle vocabulary, or null when the row has no
 * lifecycle and must show its own name instead.
 *
 * ⚠ THE VOCABULARY BELONGS TO ONE OF THE TWO LEDGERS, WHICH IS WHY THE TOKEN IS AN
 * ARGUMENT. settled / held / slashed describe a MINT's lifecycle — a mined LENS token's
 * state. The LXC ledger holds no mints: every row there moves a purchased balance. One
 * component renders both (Ledger.tsx takes a `token` discriminator) and it used to hand
 * this function the type WITHOUT the token, so the mint vocabulary reached LXC rows.
 *
 * MEASURED IN REAL CHROME on the real binary, one served request's actual footprint:
 * `reservation_hold` and `reservation_release` both painted **SETTLED** — the label whose
 * own definition below reads "a counted mint in circulation" — on a pre-serve BOUND that
 * Lens's writer documents as "NOT a bill" and on the credit that nets it to zero. They are
 * the most numerous rows in the ledger: a reserved request writes three and two are these.
 *
 * TWO WAYS IT GOT THERE, and neither was an enum being out of date by accident:
 *  - the movement allow-list below is a set of MINT-side spellings; `reservation_hold` and
 *    `reservation_release` were never in it;
 *  - the `*_held` suffix rule misses `reservation_hold` BY ONE LETTER, so the row did not
 *    even land on the closest wrong answer.
 * Enumerating the two would fix today and rot at the seventh LXC type. Asking WHICH LEDGER
 * cannot rot: there is no lifecycle on that side of the product to be out of date about.
 *
 * For the mint ledger nothing changes. The mapping is by SUFFIX, not an enum, so it
 * survives new mint kinds:
 *   *_held     → 'held'     (real: pattern_mine_held)  — held, but see below
 *   *_revoked  → 'slashed'  (source-defined; unexercised in the trial data)
 *   movement   → null       (plain label, no pill)
 *   otherwise  → 'settled'  (a counted mint in circulation: pattern_mine, pool_royalty…)
 *
 * Two honest gaps this encodes:
 *  - There is no 'idle' — that Pill variant was cut, because no ledger row (and no other
 *    screen) could ever produce it. See Pill.tsx.
 *  - 'held' marks the row, but the ledger exposes no hold WINDOW, so a held row can wear
 *    the Pill yet cannot drive a HoldBar. The two are decoupled on purpose.
 */
export function ledgerStatus(type: string, token: Token): PillStatus | null {
  // Not "LXC has no mint types I know of" — LXC has no mint lifecycle at all, so the
  // answer is the same for a type that does not exist yet.
  if (token === 'lxc') return null
  if (type.endsWith('_held')) return 'held'
  if (type.endsWith('_revoked')) return 'slashed'
  if (MOVEMENTS.has(type)) return null
  return 'settled'
}

/** A short, readable form of a raw ledger type, e.g. "pattern_mine_held" → "pattern mine held". */
export function humanizeType(type: string): string {
  return type.replace(/_/g, ' ')
}

/** Compact absolute timestamp for a ledger row, e.g. "Jul 19, 14:52". */
export function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** µUSD (1e-6 USD) → a plain "$1.50" string. Not a MuNumeral: USD has no token tick. */
export function formatUSD(uusd: number): string {
  return (uusd / 1_000_000).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
