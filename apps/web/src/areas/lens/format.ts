import type { PillStatus } from '@talyvor/ui'

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
 * Map a Lens ledger `type` onto the Pill's lifecycle vocabulary, or null when the row
 * is an account movement (see MOVEMENTS) that has no lifecycle status.
 *
 * The mapping is by SUFFIX, not an enum, so it survives new mint kinds:
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
export function ledgerStatus(type: string): PillStatus | null {
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
