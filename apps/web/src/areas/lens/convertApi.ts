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

import { ApiError } from '../../lib/api'

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

/** What went wrong, in terms the panel can turn into a sentence — the shape TopUp's
 *  `CheckoutFailureKind` already uses, for the same reason: a screen about to move money owes
 *  different words and a different next step to each cause. */
export type ConvertFailureKind =
  | 'insufficient' //  402 — not enough spendable LENS
  | 'too_small' //     400 — below the minimum conversion
  | 'unavailable' //   404/503 — no conversion on this deployment
  | 'signed_out' //    401 — the workspace token died; retrying cannot help
  | 'upstream' //      5xx/other — a genuine fault, where retrying IS true advice

/**
 * ⚠ IT EXTENDS ApiError, AND THAT IS THE FIX RATHER THAN A TIDY-UP.
 *
 * Every session-expiry mechanism in this app keys on `instanceof ApiError`: `isSessionExpired`,
 * `useSessionExpired`'s scan of the query cache, App.tsx's "a 401 is a verdict, not a flake"
 * retry rule, and the QueryCache.onError gate re-probe. A hand-rolled Error subclass turns all
 * four off without one line of any of them changing — IssueList.tsx:260 recorded that hazard in
 * this repo at its third site (#136 a read, #140 a create). The convert QUOTE was the fourth,
 * and the only one that is a `useQuery`: it lands in the very cache the bar subscribes to, so it
 * was the one that could have raised the bar and did not. MEASURED at `3ba7a63`: the app issued
 * a SECOND refused quote request on a 401, because the retry predicate could not see it.
 *
 * `kind` stays, because the panel's five sentences are not derivable from a status alone, and
 * `instanceof ConvertError` at the two render sites is unaffected by gaining a base class.
 */
export class ConvertError extends ApiError {
  constructor(
    readonly kind: ConvertFailureKind,
    message: string,
    status: number,
    path: string,
  ) {
    super(status, path)
    this.message = message
    this.name = 'ConvertError'
  }
}

function classify(
  status: number,
  body: { error?: string; min_lxc_ulxc?: number },
  path: string,
): ConvertError {
  if (status === 402) {
    return new ConvertError(
      'insufficient',
      'Not enough LENS for that amount — nothing was converted. Try a smaller amount.',
      status,
      path,
    )
  }
  if (status === 400) {
    return new ConvertError(
      'too_small',
      body.error ?? 'That amount is below the minimum conversion.',
      status,
      path,
    )
  }
  if (status === 404 || status === 503) {
    return new ConvertError(
      'unavailable',
      'Conversion isn’t available on this deployment — nothing was converted.',
      status,
      path,
    )
  }
  // ⚠ 401 IS A VERDICT AND USED TO FALL THROUGH TO "Please try again." The workspace token is
  // minted for 8 hours and the BFF session for 12, so hours 8→12 of every session are this
  // state, and a Lens restart puts every live session in it at once. The same request will be
  // refused until the person signs in again — so the old sentence was not merely unhelpful on
  // the one screen that spends money, it was false. Worded as the top-up path already words it.
  if (status === 401) {
    return new ConvertError(
      'signed_out',
      'Your session has expired. Sign in again, then convert — nothing was converted.',
      status,
      path,
    )
  }
  return new ConvertError(
    'upstream',
    'Couldn’t convert — nothing was converted. Please try again.',
    status,
    path,
  )
}

export const convertApi = {
  quote: async (): Promise<ConvertQuote> => {
    const res = await fetch('/api/lens/convert-quote', { headers: { Accept: 'application/json' } })
    const body = (await res.json().catch(() => ({}))) as ConvertQuote & { error?: string }
    if (!res.ok) throw classify(res.status, body, '/api/lens/convert-quote')
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
    if (!res.ok) throw classify(res.status, body, '/api/lens/convert')
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
