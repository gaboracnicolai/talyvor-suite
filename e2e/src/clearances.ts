// B30.115 — the money-and-markets capabilities B30.1 registered, each with its class. A test user reads
// GET /v1/wallets/capabilities; each of the nineteen must be listed with the class Nicolai gave it
// (5 Oct 2026) and take no real money, so the run fails the night one disappears or changes class.
// Read-only: it records no clearance — that is the operator's `lens clearances`, never run here.

import type { CapabilityStatus } from './lens.ts'
import type { Scenario } from './scenarios.ts'

/** Lens's economy.Capabilities, as B30.1 added them: pay_by_bank and the three credit ones and price_lock AMBER, the rest RED. */
export const B30_CAPABILITIES: Readonly<Record<string, 'AMBER' | 'RED'>> = {
  currency_accounts: 'RED',
  account_details: 'RED',
  payments_in: 'RED',
  payments_out: 'RED',
  pay_by_bank: 'AMBER',
  fx: 'RED',
  stablecoins: 'RED',
  x402: 'RED',
  merchant_acceptance: 'RED',
  b2b_credit: 'AMBER',
  seller_advances: 'AMBER',
  lending_marketplace: 'AMBER',
  trade_equities: 'RED',
  trade_crypto: 'RED',
  trade_prediction: 'RED',
  treasury_sweep: 'RED',
  price_lock: 'AMBER',
  cover: 'RED',
  payouts_to_people: 'RED',
}

/** The oracle: every B30.1 capability listed once, in its class, and taking test money only. */
export function capabilitiesVerdict(listed: readonly CapabilityStatus[]): { pass: boolean; detail: string } {
  const wrong: string[] = []
  for (const [key, want] of Object.entries(B30_CAPABILITIES)) {
    const rows = listed.filter((c) => c.capability === key)
    if (rows.length === 0) { wrong.push(`${key} is not listed`); continue }
    if (rows.length > 1) wrong.push(`${key} is listed ${rows.length} times`)
    const c = rows[0]
    if (c.class !== want) wrong.push(`${key} is ${c.class}, not ${want}`)
    if (c.real_money !== false) wrong.push(`${key} takes real money (real_money ${String(c.real_money)})`)
  }
  const n = Object.keys(B30_CAPABILITIES).length
  if (wrong.length > 0) return { pass: false, detail: `of the ${n} B30.1 capabilities: ${wrong.join('; ')}` }
  return { pass: true, detail: `all ${n} B30.1 capabilities are listed — 5 AMBER, 14 RED — and none takes real money` }
}

export function b30Capabilities(): Scenario {
  return {
    id: 'b30-capabilities',
    title: 'every money-and-markets capability is listed with its class (AMBER or RED) and takes test money only',
    feature: 'Agent Wallets',
    run: async (ctx) => {
      const listed = await ctx.env.lens.walletCapabilities(ctx.app.user)
      ctx.evidence.push({ note: `Lens lists ${listed.length} capabilities: ${listed.map((c) => `${c.capability} ${c.class}${c.real_money ? ' real money' : ''}`).join(', ')}` })
      return capabilitiesVerdict(listed)
    },
  }
}
