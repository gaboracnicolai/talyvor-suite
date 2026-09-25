// Live data layer for the subscriber's plan on /billing (B1.6).
//
//   GET /api/billing/allowance → Capability<PlanSummary>  (apps/bff/lens.go, wsProxyGated)
//
// The BFF wraps Lens's GET /v1/workspaces/{ws}/billing/allowance in the gated envelope: Lens
// registers that route only where subscriptions are sold, so `enabled:false` means "no plans on
// this deployment" and `allowance: null` means "this workspace is not subscribed". Neither is a
// fault, and neither draws anything.

import { getCapability, type Capability } from '../../lib/api'

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
