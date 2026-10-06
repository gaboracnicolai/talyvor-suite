import { useEffect, useState } from 'react'
import { ApiError } from '../../lib/api'

// B5.2 — the price list, READ FROM THE SERVER. apps/bff/pricing.go serves it on the public
// GET /api/pricing: the peg Lens confirms on its own public conversion-rate route, and the top-up
// range the checkout write path enforces. Nothing on the pricing page is a price written here, so a
// buyer who opens /api/pricing reads the same numbers the page printed.
//
// A bare fetch in an effect, not react-query, for the reason lib/signupOpen.ts gives: the public
// pages render with no providers, and Pricing.test.tsx renders the page bare to keep it that way.

export const PRICING_PATH = '/api/pricing'

/** B28.5 — one plan as Lens's public plans read states it: its price, and the usage it includes this month. */
export interface PricedPlan {
  id: string
  usd_cents: number
  /** µLXC — what a new subscriber to the plan is granted this month (talyvor-lens B28.439). */
  included_ulxc: number
}

/** B32.14 — a company plan's monthly Stripe price as Lens states it (talyvor-lens B32.10, B32.77). */
export interface CompanyPlanPrice {
  id: string
  usd_cents: number
}

/** What one company plan unlocks (talyvor-lens B32.12). -1 is unlimited. */
export interface PlanGate {
  agents: number
  seats: number
  own_provider_keys: 'none' | 'add_on' | 'included'
  /** false keeps every money capability on test money; true takes each live as it is cleared. */
  live_money: boolean
  slack_teams_approvals: boolean
  sso: boolean
  audit_export: boolean
  edge: boolean
}

export interface PlanGates {
  /** The company plans from the smallest up. */
  order: string[]
  plans: Record<string, PlanGate>
}

/** Every fee Talyvor charges, as Lens's GET /v1/public/fees states it (talyvor-lens B32.8). */
export interface Fees {
  market_take_bps: number
  services_take_bps: number
  compute_take_bps: number
  lending_fee_bps: number
  /** On AI spend charged to credits, by plan. */
  platform_fee_bps: Record<string, number>
  /** Over the reference rate on a conversion, by plan. */
  fx_margin_bps: Record<string, number>
  /** Minor units of the currency a payment is sent in, plus the partner's cost. */
  intl_payment_fee_minor: Record<string, number>
  merchant_fee_bps: number
  merchant_a2a_fee_bps: number
}

export interface Pricing {
  /** USD per LXC. ABSENT when Lens would not confirm it — the page then prints no rate at all. */
  usd_per_lxc?: number
  min_usd_cents: number
  max_usd_cents: number
  preset_usd_cents: number[]
  /** ABSENT when Lens would not state them — a deployment that sells no plans. */
  plans?: PricedPlan[]
  /** B32.14 — Team's and Business's prices; each of these four is ABSENT when Lens does not state it. */
  company_plans?: CompanyPlanPrice[]
  /** BYOK's price as Team's add-on. */
  byok_add_on_usd_cents?: number
  /** The figure an Enterprise contract starts from. */
  enterprise_from_usd_cents?: number
  plan_gates?: PlanGates
  fees?: Fees
}

/** The plans' names. Words, not figures: every figure about a plan is read from Lens. */
export const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  plus: 'Plus',
  pro: 'Pro',
  max: 'Max',
  byok: 'BYOK',
}

export function planName(id: string): string {
  return PLAN_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
}

/** Basis points as a percent, every significant digit kept: 550 → "5.5%", 25 → "0.25%". */
export function formatBPS(bps: number): string {
  return `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

/** Minor units in their currency, whole amounts without decimals: 500 GBP → "£5". */
export function formatMinor(minor: number, currency: string): string {
  return (minor / 100).toLocaleString('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

/** A count a plan allows, or "Unlimited" for -1. */
export function formatLimit(n: number): string {
  return n < 0 ? 'Unlimited' : n.toLocaleString('en-US')
}

export type PricingState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ok'; pricing: Pricing }

export function usePricing(): PricingState {
  const [state, setState] = useState<PricingState>({ status: 'loading' })
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch(PRICING_PATH, { headers: { Accept: 'application/json' } })
        if (!res.ok) throw new ApiError(res.status, PRICING_PATH)
        const pricing = (await res.json()) as Pricing
        if (live) setState({ status: 'ok', pricing })
      } catch {
        if (live) setState({ status: 'failed' })
      }
    })()
    return () => {
      live = false
    }
  }, [])
  return state
}

/** The peg as money, every significant digit kept: 0.1 → "$0.10". Never rounded to the cent — a
 *  sub-cent peg rounded for display would be a different price. */
export function formatPeg(usdPerLXC: number): string {
  return usdPerLXC.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })
}
