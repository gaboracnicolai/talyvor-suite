// Live data layer for the subscriber's plan on /billing (B1.6).
//
//   GET /api/billing/allowance → Capability<PlanSummary>  (apps/bff/lens.go, wsProxyGated)
//
// The BFF wraps Lens's GET /v1/workspaces/{ws}/billing/allowance in the gated envelope: Lens
// registers that route only where subscriptions are sold, so `enabled:false` means "no plans on
// this deployment" and `allowance: null` means "this workspace is not subscribed". Neither is a
// fault, and neither draws anything.

import { ApiError, getCapability, type Capability } from '../../lib/api'

/** The period Lens granted, in µLXC; the fee is what Stripe charges for the period, in cents. */
export interface PlanAllowance {
  period_start: string
  period_end: string
  granted_ulxc: number
  consumed_ulxc: number
  remaining_ulxc: number
  fee_usd_cents: number
}

export interface PlanSummary {
  allowance: PlanAllowance | null
  /** What the workspace's pooled and distilled answers minted this period, revoked excluded. */
  earned_ulens: number
  /** The part of earned_ulens still inside its holdback — and so still revocable. */
  earned_held_ulens: number
  earned_usd_cents: number
  /** earned_usd_cents CAPPED AT THE FEE by Lens: earnings never exceed what the plan costs. */
  earned_back_usd_cents: number
}

export const planApi = {
  allowance: (): Promise<Capability<PlanSummary>> => getCapability<PlanSummary>('/api/billing/allowance'),
}

/* ── B13.3 — the three plans, and starting one ─────────────────────────────── */

export type PlanId = 'plus' | 'pro' | 'max'

export interface PlanOffer {
  id: PlanId
  name: string
  /** The Stripe TEST price Lens sells it at (talyvor-lens #548). */
  usd_cents: number
  /** How much usage it includes, relative to Plus — Lens computes each from the price. */
  usage: string
}

/**
 * The plans differ in included usage, never in features: every model from every provider on each.
 * Lens computes each plan's included usage from its price (B13.1), so Pro's is just over 5× Plus's
 * and Max's just over 10×.
 */
export const PLANS: readonly PlanOffer[] = [
  { id: 'plus', name: 'Plus', usd_cents: 2000, usage: 'Included usage for everyday chat' },
  { id: 'pro', name: 'Pro', usd_cents: 10000, usage: '5× the included usage of Plus' },
  { id: 'max', name: 'Max', usd_cents: 20000, usage: '10× the included usage of Plus' },
]

/** The plan a period's fee is the price of, or null when the fee matches none of them. */
export function planForFee(feeUSDCents: number): PlanOffer | null {
  return PLANS.find((p) => p.usd_cents === feeUSDCents) ?? null
}

/** Whole percent of the period's included usage used, 0–100. */
export function usedPercent(a: PlanAllowance): number {
  if (a.granted_ulxc <= 0) return 100
  return Math.min(100, Math.max(0, Math.round((a.consumed_ulxc * 100) / a.granted_ulxc)))
}

export type SubscribeFailureKind = 'not_for_sale' | 'already_subscribed' | 'signed_out' | 'upstream'

export class SubscribeError extends ApiError {
  constructor(
    readonly kind: SubscribeFailureKind,
    status: number,
  ) {
    super(status, SUBSCRIBE_PATH)
    this.name = 'SubscribeError'
  }
}

const SUBSCRIBE_PATH = '/api/billing/subscribe'

/** sessionStorage key naming the plan a checkout was started for, read on /billing/success. */
export const PENDING_PLAN_KEY = 'talyvor.plan.pending'
const PENDING_PLAN_MAX_AGE_MS = 2 * 60 * 60 * 1000

export function recordPendingPlan(plan: PlanId): void {
  try {
    window.sessionStorage.setItem(PENDING_PLAN_KEY, JSON.stringify({ plan, at: Date.now() }))
  } catch {
    // Storage unavailable: the return page falls back to the top-up wording, which still holds.
  }
}

export function clearPendingPlan(): void {
  try {
    window.sessionStorage.removeItem(PENDING_PLAN_KEY)
  } catch {
    /* nothing to clear */
  }
}

/** The plan a checkout was started for and when, or null when absent, unreadable or stale. */
export function readPendingPlan(now: number = Date.now()): { plan: PlanOffer; at: number } | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_PLAN_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { plan?: string; at?: number }
    if (typeof p.at !== 'number' || now - p.at > PENDING_PLAN_MAX_AGE_MS) return null
    const plan = PLANS.find((o) => o.id === p.plan)
    return plan ? { plan, at: p.at } : null
  } catch {
    return null
  }
}

/** POST /api/billing/subscribe — the Stripe Checkout URL for a plan. Nothing is charged here. */
export async function subscribe(plan: PlanId): Promise<{ url: string }> {
  const res = await fetch(SUBSCRIBE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ plan }),
  })
  if (res.ok) return (await res.json()) as { url: string }
  if (res.status === 503) throw new SubscribeError('not_for_sale', res.status)
  if (res.status === 409) throw new SubscribeError('already_subscribed', res.status)
  if (res.status === 401) throw new SubscribeError('signed_out', res.status)
  throw new SubscribeError('upstream', res.status)
}
