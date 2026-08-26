// Live data layer for /billing — the LXC top-up path. lib/api.ts is a SHARED
// file, so (like keysApi.ts, docs/api.ts and admin/api.ts) this area's reads and
// its WRITE live here. Both routes are real and tested on the BFF
// (apps/bff/billing.go):
//
//   GET  /api/lxc/topup-options → { allowed_usd_cents }  — the amounts on offer
//   POST /api/lxc/checkout      → { url }                — a Stripe session URL
//
// THE WRITE PATH AND ORIGIN — the same argument as keysApi.ts, verified against
// apps/bff/billing.go rather than assumed: requireSameOrigin refuses a POST
// unless `Origin` equals the BFF's configured public origin. Origin is a
// forbidden header, so JS cannot and must not set it; posting to the RELATIVE
// path '/api/lxc/checkout' is same-origin, so the browser attaches it itself.
// Default credentials: 'same-origin' carries the session cookie.
//
// WHY THE AMOUNTS ARE FETCHED, NEVER HARDCODED. Lens validates the amount against
// a server-side allow-list ($10/$50/$100) and 400s anything else. A price written
// into this file would be a button that always fails the moment the two disagree,
// so the screen renders exactly what the BFF serves and nothing else. (Lens itself
// exposes that list on no endpoint — see billing.go for why the BFF holds the copy.)

import { ApiError } from '../../lib/api'

/**
 * GET /api/lxc/topup-options — what the screen needs before it draws anything.
 *
 * `billing_enabled` is the BFF's PROBED answer to "can this deployment sell at
 * all?" (Lens reveals it only by not registering the route). It matters because
 * the flag is off by default: without it, a deployment that cannot take money
 * would still render a full row of buy buttons and only admit it on click.
 * Optimistic by construction — only a definitive Lens 404 makes it false, so an
 * outage never hides a feature that works.
 */
export interface TopUpOptions {
  allowed_usd_cents: number[]
  billing_enabled: boolean
}

/** POST /api/lxc/checkout — a Stripe Checkout Session to send the browser to. */
export interface CheckoutSession {
  url: string
}

/**
 * What went wrong, in terms the screen can turn into a sentence. A top-up is
 * about to ask someone for money, so "it failed" is not good enough: billing
 * being switched off, a rejected origin, an expired session and an unreachable
 * Lens all need different words and different next steps.
 */
export type CheckoutFailureKind =
  | 'billing_disabled' // 503 + billing_enabled:false — Lens runs without LENS_BILLING_ENABLED
  | 'signed_out' //       401 — the session went away between load and click
  | 'origin_refused' //   403 — the app was reached at an address the BFF doesn't recognise
  | 'amount_refused' //   400 — this app offered an amount the BFF won't accept
  | 'upstream' //         502/other — Lens errored, was unreachable, or drifted

/** The route every CheckoutError is about, so the type carries the address it failed at. */
const CHECKOUT_PATH = '/api/lxc/checkout'

/**
 * ⚠ IT EXTENDS ApiError, AND IT USED TO EXTEND BARE `Error`.
 *
 * Every shared mechanism in this app keys on `instanceof ApiError`: `isSessionExpired`,
 * `isUnconfigured`, App.tsx's "a 401 is a verdict, not a flake" retry rule and the
 * QueryCache.onError gate re-probe. A hand-rolled Error subclass turns all four off without one
 * line of any of them changing — this repo has repaired that four times at the instance (#136 a
 * read, #140 a create, IssueList.tsx:282 the third site, `ConvertError` the fourth) and this was
 * the fifth, still standing on the path that takes money.
 *
 * ⚠ LATENT, NOT LIVE, AND THE DIFFERENCE IS STATED RATHER THAN GLOSSED. The only producer is
 * `checkout` below, which TopUp.tsx calls from a useMutation — and a mutation's error never enters
 * the query cache the bar, the re-probe and the retry rule all read. So no sentence on any screen
 * was wrong. `ConvertError`'s WRITE half was latent for the same reason while its READ half was
 * the live defect; the difference between the two is one `useQuery`, which is not a property of
 * the error type. Fixed as the type it should have been rather than left for that day.
 *
 * `kind` stays: the five sentences TopUp renders are not derivable from a status alone, and the
 * `instanceof CheckoutError` at its render site is unaffected by gaining a base class. `message`
 * is kept verbatim — ApiError's constructor writes `${path} -> HTTP ${status}` and this type has
 * always read `checkout failed: ${kind}`, so it is restored after the super call rather than
 * silently changed under whatever reads it.
 */
export class CheckoutError extends ApiError {
  constructor(
    readonly kind: CheckoutFailureKind,
    /** The BFF's own sentence when it has one — it knows things the UI does not. */
    readonly detail: string,
    status: number,
  ) {
    super(status, CHECKOUT_PATH)
    this.message = `checkout failed: ${kind}`
    this.name = 'CheckoutError'
  }
}

function classify(status: number, body: { error?: string; billing_enabled?: boolean }): CheckoutError {
  const detail = body.error ?? ''
  if (status === 503 && body.billing_enabled === false) return new CheckoutError('billing_disabled', detail, status)
  if (status === 401) return new CheckoutError('signed_out', detail, status)
  if (status === 403) return new CheckoutError('origin_refused', detail, status)
  if (status === 400) return new CheckoutError('amount_refused', detail, status)
  return new CheckoutError('upstream', detail, status)
}

/* ── The pre-purchase balance, carried across the Stripe round trip ───────── */

/** sessionStorage key holding the balance recorded just before a checkout. */
export const PENDING_TOPUP_KEY = 'talyvor.lxc-topup.pending'

/**
 * How long a recorded pre-purchase balance stays meaningful. A checkout that
 * hasn't returned within this window is treated as absent rather than compared
 * against — a figure from hours ago says nothing about the payment in hand, and
 * a stale comparison could announce a success that never happened (or deny one
 * that did). Two hours comfortably covers a real Stripe round trip, including a
 * slow card challenge.
 */
export const PENDING_MAX_AGE_MS = 2 * 60 * 60 * 1000

export interface PendingTopUp {
  balance_ulxc: number
  usd_cents: number
  at: number
}

/**
 * Record the balance BEFORE leaving for Stripe. This is what makes the return
 * page able to answer "did MY top-up land?" at all: crediting is asynchronous,
 * so the webhook frequently commits before the browser gets back, and a baseline
 * captured on the success page would never observe a change.
 */
export function recordPendingTopUp(p: PendingTopUp): void {
  try {
    window.sessionStorage.setItem(PENDING_TOPUP_KEY, JSON.stringify(p))
  } catch {
    // Storage disabled or full: the purchase still proceeds, and the return page
    // degrades to "can't confirm from this browser" — which it says out loud.
  }
}

export function clearPendingTopUp(): void {
  try {
    window.sessionStorage.removeItem(PENDING_TOPUP_KEY)
  } catch {
    /* nothing to clean up if storage is unavailable */
  }
}

/** The recorded pre-purchase balance, or null when absent, unreadable or stale. */
export function readPendingTopUp(now: number = Date.now()): PendingTopUp | null {
  let raw: string | null = null
  try {
    raw = window.sessionStorage.getItem(PENDING_TOPUP_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<PendingTopUp>
    if (typeof p.balance_ulxc !== 'number' || typeof p.at !== 'number') return null
    if (now - p.at > PENDING_MAX_AGE_MS) return null
    return { balance_ulxc: p.balance_ulxc, usd_cents: p.usd_cents ?? 0, at: p.at }
  } catch {
    return null
  }
}

/* ── The calls ────────────────────────────────────────────────────────────── */

export const topupApi = {
  /** LIVE — the amounts this deployment accepts. */
  options: async (): Promise<TopUpOptions> => {
    const res = await fetch('/api/lxc/topup-options', { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new ApiError(res.status, '/api/lxc/topup-options')
    return (await res.json()) as TopUpOptions
  },

  /**
   * LIVE WRITE — start a Stripe Checkout Session. Nothing is charged by this
   * call and no credit is written by it: it returns the URL the browser must be
   * sent to. Relative path ⇒ same-origin ⇒ the browser supplies the Origin the
   * BFF requires (see the file header).
   */
  checkout: async (usdCents: number): Promise<CheckoutSession> => {
    const res = await fetch('/api/lxc/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ usd_cents: usdCents }),
    })
    const body = (await res.json().catch(() => ({}))) as {
      url?: string
      error?: string
      billing_enabled?: boolean
    }
    if (!res.ok) throw classify(res.status, body)
    // An OK with nothing to navigate to is still a failure. Returning it as a
    // success would leave the click doing nothing at all — indistinguishable
    // from a dead button, which is the one outcome this screen must not have.
    if (!body.url) {
      // The status is the one the BFF actually sent — a 200 whose body has nothing to navigate
      // to. Inventing a 502 here would put a status on the record that no server produced.
      throw new CheckoutError(
        'upstream',
        'Couldn’t start the payment — nothing was charged. Please try again.',
        res.status,
      )
    }
    return { url: body.url }
  },
}

/** Whole dollars from cents for a button label: 1000 → "$10", 1234 → "$12.34". */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}
