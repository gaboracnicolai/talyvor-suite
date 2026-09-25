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

export interface Pricing {
  /** USD per LXC. ABSENT when Lens would not confirm it — the page then prints no rate at all. */
  usd_per_lxc?: number
  min_usd_cents: number
  max_usd_cents: number
  preset_usd_cents: number[]
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
