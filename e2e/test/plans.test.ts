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
    expect(c.own.map((o) => `${o.scenario}:${o.plan}`).sort()).toEqual(['agent-rules-unbypassable:team', 'byok-addon:free', 'credits-top-up:free', 'evals:free', 'file-bomb-bounded:free', 'gateway-auth:free', 'gateway-keys:free',
      'gateway-mcp:free', 'gateway-providers:free', 'gateway-sessions:free', 'injection-exfil:free', 'ledger-call-once:team', 'ledger-moves-at-once:team', 'lens-tokens:free', 'market-abuse:free', 'nodes:free', 'outputs-attribution:free',
      'plan-agents-business:business', 'plan-agents-team:team', 'plan-change:free', 'pool-isolation:free', 'povi:free', 'rooms-private:team', 'seats-free:free', 'seats-team:free',
      'settings-config-budgets:free', 'settings-guardrails:free', 'settings-operator-only:free', 'settings-prompts:free', 'settings-stored-answers:free',
      'settings-switches:free', 'settings-tare-distill:free', 'ssrf-refused:free', 'webhook-replayed:free', 'webhook-unsigned:free'])
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
