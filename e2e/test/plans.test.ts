import { describe, expect, it } from 'vitest'
import { keptOf, platformFeeBPS } from '../src/fees.ts'
import type { Fees, LensClient } from '../src/lens.ts'
import { TEAM_AGENTS, cast, seat, seatKey } from '../src/plans.ts'
import { pastAgentsVerdict } from '../src/pricing.ts'
import { type Scenario, journeyFor } from '../src/scenarios.ts'

const s = (id: string, more: Partial<Scenario> = {}): Scenario => ({ id, title: id, owner: 'talyvor-lens', run: async () => ({ pass: true, detail: '' }), ...more })

describe('every scenario on the plan it needs (B35.7)', () => {
  it('puts a user that opens agents on Team, past Team’s agents on Business, a counterparty on Business, and a gate on a workspace of its own', () => {
    const c = cast([
      [s('reads')],
      [s('wallet', { agents: 2 })],
      [s('wallets', { agents: TEAM_AGENTS }), s('one-more', { agents: 1 })],
      [s('pays-3', { agents: 1, partners: [3] }), s('seats-free', { plan: 'free', own: true }), s('gate', { plan: 'team', own: true, agents: 26 })],
    ])
    expect(c.plans).toEqual(['free', 'team', 'business', 'business'])
    expect(c.own).toEqual([{ user: 3, scenario: 'seats-free', plan: 'free' }, { user: 3, scenario: 'gate', plan: 'team' }])
  })

  it("casts a 10-user run so no shared workspace's scenarios open more agents than its plan holds", () => {
    const journeys = Array.from({ length: 10 }, (_, i) => journeyFor(i, 10, []))
    const c = cast(journeys)
    const holds = { free: 3, team: TEAM_AGENTS, business: Infinity }
    journeys.forEach((j, i) => expect(j.filter((x) => x.own !== true).reduce((n, x) => n + (x.agents ?? 0), 0)).toBeLessThanOrEqual(holds[c.plans[i]]))
    // User 9 is every catalog-v4 scenario's other company; seats-free, each paid plan's agent gate, BYOK and a plan change (B34.5,
    // each bought with the test card) run on their own.
    expect(c.plans[9]).toBe('business')
    // B34.6 — and every way into Lens's gateway, each on a workspace nothing else touches; B34.7 — and every Lens setting;
    // B34.8 — and evals, outputs and attribution, nodes, PoVI, LENS and credits bought.
    // B32.53 — and a private room, on a Team workspace of its own (Free opens no private room).
    // B28.279 — and the ledger under concurrency, each on a Team workspace nothing else moves money in.
    // B28.280 — and Stripe's webhooks, each on a workspace whose ledger nothing else writes.
    // B28.281 — and an agent's rules, on a Team workspace nothing else moves money in.
    // B28.283 — and the pool, on a workspace whose sharing and personal-data detection nothing else switches.
    // B28.284 — and a prompt injection, on a workspace whose ledger nothing else writes.
    // B28.285 — and the addresses Lens must never reach and the documents it must not unpack without end.
    // B28.286 — and the session's writes from elsewhere, and a script in an answer or a private room's message (Team).
    // B28.287 — and the keys no read may return and the credentials no upstream may receive.
    // B28.288 — and a burst Lens's rate limiter must refuse.
    // B28.295 — and the room screens nothing else reached: an invite link's screen, and a contribution decided and run (Team).
    // B32.75 — and a sale's earning released on the journal, bought by a workspace whose bill nothing else adds to.
    // B32.76 — and a listing's four offers and a price change, bought by a workspace whose bill nothing else adds to.
    // B32.78 — and a listing rented and used under its licence, with an agent of its own, on a workspace whose bill nothing else adds to.
    // B32.79 — and a listing's free trial uses and the billed one after them, on a workspace whose bill nothing else adds to.
    // B32.80 — and an agent's licences judged by its rules, with two agents of its own, on a workspace whose bill nothing else adds to.
    // B32.81 — and an agent shopping over MCP within its commitment and a max price, with an agent of its own, on a workspace whose bill nothing else adds to.
    // B32.82 — and Free's room limits and a private room joined by an invite link, on a Free workspace of its own that the scenario puts on Team.
    // B32.83 — and a room's messages, streamed, scanned, edited, deleted and limited per minute, on a Team workspace of its own with a private room.
    // B32.84 — and a room's contributions, proposed, forked with lineage and voted on, on a Free workspace of its own.
    // B32.85 — and a room's wallet, funded, its budget refused past Free's maximum, and spent by a member given may_spend.
    // B32.86 — and runs in a room, on the room's budget or the member's own, and the room's AI asked on the room's budget.
    // B32.87 — and a room's prizes, refused over the budget, awarded and cleared, and closed unawarded at the deadline.
    // B32.88 — and an agent in a room over MCP, billed within its rules and refused above them, every call logged.
    // B32.66 — and tax on three buyers' rents, their receipts, and a seller withheld from the payout run and then paid.
    // B32.89 — and the trust panel, counting only paying buyers not linked to the seller.
    // B32.92 — and a buyer's tax profile, a valid VAT number making a business and a never-issued one a consumer.
    // B32.95 — and a seller's tax details, saved and read back masked, kept when a save leaves them out.
    // B32.96 — and a seller's weekly statement, its lines summing to its net before and after the payout run pays it.
    // B32.97 — and a self-billing seller's paid week, carrying its self-billed invoice with the payout's figures.
    // B32.98 — and the annual platform-reporting export, its GB seller's figures the journal's and its US seller left out.
    // B30.117 — and verification levels, reached in order, a Test pass counting for test money only.
    // B30.126 — and saved outside payees, a no-match confirmed only by a passkey's signature, a sanctioned one refused.
    // B30.122 — and each money capability's terms, listed unaccepted on a new workspace, fx's accepted and the next version 409.
    // B30.116 — and the Verification screen, L1 then L2 reached from its forms.
    // B30.103 — and the Capability terms screen and an agent's credential, one agent on Free.
    // B30.118 — and an agent's Know Your Agent credential, revoked by a rule change and by a pause.
    // B32.65 — and a family of three remixes, the rent of the youngest split up the family and refunded.
    // B32.93 — and two buyers' per-use buys, each taxed by its treatment, the paid one's tax cleared to tax:GB.
    // B32.94 — and two buyers' paid bills, each receipted in turn as its bill, the DE business's reverse charged.
    // B32.100 — and a $20.00 rent read in pounds by a GB consumer, VAT included as its bill charges it, and by a GB business "+ VAT".
    // B28.162 — and a listing's version 2 uploaded with a changelog, a use pinned to version 1 still running version 1.
    // B28.426 — and a paid skill used in Chat, its two questions two billed uses on a bill nothing else adds to.
    expect(c.own.map((o) => `${o.scenario}:${o.plan}`).sort()).toEqual(['agent-rules-unbypassable:team', 'buyer-tax-profile:free', 'byok-addon:free', 'capability-terms:free', 'chat-listing:free', 'compliance:free', 'credits-top-up:free', 'csrf-refused:free', 'evals:free', 'file-bomb-bounded:free', 'gateway-auth:free', 'gateway-keys:free',
      'gateway-mcp:free', 'gateway-providers:free', 'gateway-sessions:free', 'injection-exfil:free', 'invoice-pay-link:free', 'invoices-screen:free', 'keys-not-forwarded:free', 'keys-unlisted:free', 'kya-credential:free', 'ledger-call-once:team', 'ledger-moves-at-once:team', 'lens-tokens:free', 'lineage:free', 'market-abuse:free', 'market-agent-commitment:free', 'market-agent-mcp:free', 'market-bill-invoices:free', 'market-bill-tax:free', 'market-buyer-currency:free', 'market-discovery:free', 'market-journal:free', 'market-offers:free', 'market-receipts:free', 'market-rent:free', 'market-trial:free', 'market-trust:free', 'market-versions:free', 'nodes:free', 'outputs-attribution:free', 'outside-payees:free',
      'plan-agents-business:business', 'plan-agents-team:team', 'plan-change:free', 'platform-report:free', 'pool-isolation:free', 'povi:free', 'rate-limits-hold:free', 'room-agent-mcp:free', 'room-contributions:free', 'room-decide-run:team', 'room-invite-limits:free', 'room-invite-screen:team', 'room-messages:team', 'room-prizes:free', 'room-runs:free', 'room-wallet:free', 'rooms-moderation:free', 'rooms-private:team', 'script-inert:team', 'seats-free:free', 'seats-team:free', 'self-billed-invoice:free', 'seller-tax-details:free', 'seller-week-statement:free',
      'settings-config-budgets:free', 'settings-guardrails:free', 'settings-operator-only:free', 'settings-prompts:free', 'settings-stored-answers:free',
      'settings-switches:free', 'settings-tare-distill:free', 'ssrf-refused:free', 'tax-and-payouts:free', 'terms-credential-screens:free', 'verification-levels:free', 'verification-screen:free', 'webhook-replayed:free', 'webhook-unsigned:free'])
  })

  it('creates each plan’s workspaces in one call, each user at its index and each gate’s own beside it', async () => {
    const calls: [number, string | undefined][] = []
    const lens = {
      createUsers: async (count: number, plan?: string) => {
        calls.push([count, plan])
        return Array.from({ length: count }, (_, n) => ({ index: n, workspaceID: `${plan}-${n}`, token: 't', expiresAt: '', plan }))
      },
    } as unknown as LensClient
    const seated = await seat(lens, { plans: ['team', 'business', 'team'], own: [{ user: 1, scenario: 'seats-free', plan: 'free' }] })
    expect(calls).toEqual([[1, 'free'], [2, 'team'], [1, 'business']])
    expect(seated.users.map((u) => `${u.index} ${u.workspaceID}`)).toEqual(['0 team-0', '1 business-0', '2 team-1'])
    expect(seated.own.get(seatKey(1, 'seats-free'))).toMatchObject({ index: 1, workspaceID: 'free-0', plan: 'free' })
  })

  it("judges Team's 26th agent by the plan's refusal, naming the team and the business plans", () => {
    const error = 'LENS_PLAN_GATES: the team plan allows 25 agents — the business plan allows unlimited agents'
    expect(pastAgentsVerdict({ status: 402, refusal: { error, plan: 'team', gate: 'agents', limit: 25, allows: 'business' } }, 'team', 25, 'business', '26th').pass).toBe(true)
    expect(pastAgentsVerdict({ status: 201, agent: { id: 'ag_26' } }, 'team', 25, 'business', '26th'))
      .toEqual({ pass: false, detail: 'a Team workspace with 25 agents made a 26th, ag_26' })
  })
})

describe('the fees Lens states (B35.7)', () => {
  const fees: Fees = { market_take_bps: 1500, services_take_bps: 500, platform_fee_bps: { free: 550, team: 300, business: 100, enterprise: 100 } }

  it('takes the platform fee of the plan Lens holds the workspace to, as Lens picks it', () => {
    expect(['free', 'team', 'business', 'plus', 'byok', 'nothing'].map((p) => platformFeeBPS(fees, p))).toEqual([550, 300, 100, 300, 300, 550])
  })

  it('leaves a payee the payment less the services fee, and a seller the sale less the take, rounded down to the µUSD', () => {
    expect(keptOf(70_000, fees.services_take_bps)).toBe(66_500)
    expect(keptOf(50_000, fees.market_take_bps)).toBe(42_500)
    expect(keptOf(33_333, fees.market_take_bps)).toBe(28_333)
  })
})
