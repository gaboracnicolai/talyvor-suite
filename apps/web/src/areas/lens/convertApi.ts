// The LENS → LXC conversion, client side.
//
// Two endpoints, both added in apps/bff/convert.go and both session-scoped there — the workspace
// is never named by this code because it cannot be:
//
//   GET  /api/lens/convert-quote → { lens_per_lxc, usd_per_lxc, min_lxc_ulxc, reversible, … }
//   POST /api/lens/convert       → ConvertResult (both new balances)
//
// ⚠ THE QUOTE IS FETCHED, NOT COMPUTED. The rate lives in Lens's conversion_rate_history and
// changes; a number baked into this bundle would be a stale claim on a money screen the first time
// it moved. Same reason the top-up amounts are read rather than hardcoded.
//
// ⚠ AND THE CONVERSION IS ONE-WAY. Lens has no LXC→LENS path at all — not a flag that is off, the
// function does not exist. The screen must say that BEFORE the button, which is why `reversible`
// and its note travel with the quote rather than being written into a component.

export interface ConvertQuote {
  lens_per_lxc: number
  usd_per_lxc: number
  min_lxc_ulxc: number
  reversible: boolean
  reversible_note: string
}

export interface ConvertResult {
  lxc_minted_ulxc: number
  lens_spent_ulens: number
  rate: number
  new_lxc_balance_ulxc: number
  new_lens_balance_ulens: number
}

export class ConvertError extends Error {
  constructor(
    readonly kind: 'insufficient' | 'too_small' | 'unavailable' | 'upstream',
    message: string,
  ) {
    super(message)
    this.name = 'ConvertError'
  }
}

function classify(status: number, body: { error?: string; min_lxc_ulxc?: number }): ConvertError {
  if (status === 402) {
    return new ConvertError(
      'insufficient',
      'Not enough LENS for that amount — nothing was converted. Try a smaller amount.',
    )
  }
  if (status === 400) {
    return new ConvertError('too_small', body.error ?? 'That amount is below the minimum conversion.')
  }
  if (status === 404 || status === 503) {
    return new ConvertError(
      'unavailable',
      'Conversion isn’t available on this deployment — nothing was converted.',
    )
  }
  return new ConvertError('upstream', 'Couldn’t convert — nothing was converted. Please try again.')
}

export const convertApi = {
  quote: async (): Promise<ConvertQuote> => {
    const res = await fetch('/api/lens/convert-quote', { headers: { Accept: 'application/json' } })
    const body = (await res.json().catch(() => ({}))) as ConvertQuote & { error?: string }
    if (!res.ok) throw classify(res.status, body)
    return body
  },

  /**
   * LIVE WRITE — spends LENS and mints LXC in one upstream transaction.
   *
   * ⚠ THE CALLER NAMES THE LXC IT WANTS, not the LENS to spend. That is Lens's shape and it is the
   * safe direction: the LXC minted is exact and the LENS cost CEILS, so the holder is never
   * under-charged and a conversion can never create value. Quoting a cost here would be a second
   * source of truth for a number the server computes.
   *
   * Relative path ⇒ same-origin ⇒ the browser supplies the Origin the BFF requires.
   */
  convert: async (lxcMicros: number): Promise<ConvertResult> => {
    const res = await fetch('/api/lens/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ lxc_amount_ulxc: lxcMicros }),
    })
    const body = (await res.json().catch(() => ({}))) as ConvertResult & {
      error?: string
      min_lxc_ulxc?: number
    }
    if (!res.ok) throw classify(res.status, body)
    return body
  },
}

/** µLXC → LXC for a label. The unit on the wire is micros; people read whole tokens. */
export function microsToUnits(micros: number): number {
  return micros / 1e6
}

/**
 * What this conversion will COST in LENS, for display only — mirroring Lens's MulCeil so the
 * quoted figure matches the debit rather than being a rounder-down guess. The server's number is
 * still authoritative; this exists so the button can say what is about to happen.
 */
export function lensCostForLXC(lxcMicros: number, lensPerLXC: number): number {
  return Math.ceil(lxcMicros * lensPerLXC)
}
