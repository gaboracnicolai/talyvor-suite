// B32.15 — the approved prices, end to end (Nicolai's decisions of 5 Oct 2026). Synthetic workspaces on Free,
// Team and Business (Team and Business bought with Stripe's test card on a checkout Lens opens) each make the
// same model call on their credits, and the oracle is Lens's ledger: the call's spend row and, beside it, one
// platform_fee row of the plan's rate — 5.5%, 3%, 1% — rounded up to the µLXC, never a status code. On
// Business the workspace then calls on its own provider key, and the ledger gains neither row. A Free
// workspace's fourth agent is refused naming its plan; a seller's first $1.00 sale clears at 850,000 µUSD to
// the seller and 150,000 to Talyvor; /pricing shows Team $49 and Business $299 as Lens serves them.
//
// The figures below are the decided ones, typed here on purpose: they are what each night is checked against,
// so the run fails the night Lens charges, gates or serves any other.

import { ACTION_TIMEOUT_MS, fail } from './bank.ts'
import { worstInputTokens } from './budget.ts'
import type { LedgerRow, MarketEarnings, PlanRefusal, Proxied } from './lens.ts'
import { listPriceUSD } from './oracles.ts'
import { TEAM_AGENTS } from './plans.ts'
import { CannotTest, type Scenario, type ScenarioCtx, type Verdict } from './scenarios.ts'
import { payCheckout } from './screens.ts'
import { buyFrom, clearedBothSides, payBill } from './trade.ts'

export type Plan = 'free' | 'team' | 'business'

/** The platform fee on AI spend charged to credits, by plan, in basis points (B32.11). */
export const PLATFORM_FEE_BPS: Readonly<Record<Plan, number>> = { free: 550, team: 300, business: 100 }
/** The agents a Free workspace may have (LENS_PLAN_GATES, B32.12). */
export const FREE_AGENTS = 3
/** Talyvor's take of a marketplace sale, in basis points; the seller keeps the rest (B32.8, B32.9). */
export const MARKET_TAKE_BPS = 1500
/** Team's and Business's prices, in cents a month (B32.77). */
export const PLAN_USD_CENTS: Readonly<Record<'team' | 'business', number>> = { team: 4900, business: 29900 }

const NAME: Readonly<Record<Plan, string>> = { free: 'Free', team: 'Team', business: 'Business' }
const BPS = 10_000
/** The one call every plan's workspace makes: the same model, question and length on each. */
export const PRICED_QUESTION = 'What is 417 + 268? Reply with the number only.'
const MAX_TOKENS = 16
/** How long Stripe's webhook may take to reach Lens after the test card is taken. */
const WEBHOOK_WAIT_MS = 60_000
/** How long a call's charge may take to reach the ledger; a call on an own key is waited on this long for a charge it must not make. */
const CHARGE_WAIT_MS = 15_000
/** A seller's first sale: one dollar, in µUSD. */
const DOLLAR_USD_MICROS = 1_000_000

/** The fee on a spend at bps, rounded up to the µLXC — written from the rule, not read from Lens. */
export function feeOn(spendULXC: number, bps: number): number {
  return Math.ceil((spendULXC * bps) / BPS)
}

const label = (bps: number): string => `Platform fee ${bps / 100}%`

/** The rows one call charged to credits wrote: its spend, and one platform_fee row of `bps` beside it. */
export function feeVerdict(fresh: readonly LedgerRow[], bps: number): Verdict {
  const spends = fresh.filter((r) => r.type === 'spend')
  const fees = fresh.filter((r) => r.type === 'platform_fee')
  if (spends.length !== 1) return fail(`one call charged to credits wrote ${spends.length} spend rows`)
  const spend = -spends[0].amount_ulxc
  if (!(spend > 0)) return fail(`the call's spend row debits ${spend} µLXC`)
  const want = feeOn(spend, bps)
  if (fees.length === 0) return fail(`Lens charged ${spend} µLXC for the call and wrote no platform_fee row; at ${bps} basis points the fee is ${want} µLXC`)
  if (fees.length > 1) return fail(`one call wrote ${fees.length} platform_fee rows: ${fees.map((f) => f.amount_ulxc).join(', ')} µLXC`)
  const f = fees[0]
  const wrong = [
    -f.amount_ulxc === want ? '' : `it debits ${-f.amount_ulxc} µLXC, not ${want} (${bps} basis points of ${spend}, rounded up)`,
    f.metadata?.platform_fee_bps === bps ? '' : `it names ${String(f.metadata?.platform_fee_bps)} basis points, not ${bps}`,
    f.metadata?.spend_ulxc === spend ? '' : `it is on a spend of ${String(f.metadata?.spend_ulxc)} µLXC, not the call's ${spend}`,
    f.balance_after_ulxc === spends[0].balance_after_ulxc - want ? '' : `its balance after is ${f.balance_after_ulxc}, not the spend row's ${spends[0].balance_after_ulxc} less ${want}`,
    f.description === label(bps) ? '' : `it reads "${f.description}", not "${label(bps)}"`,
  ].filter((w) => w !== '')
  if (wrong.length > 0) return fail(`the platform_fee row on a ${spend} µLXC spend: ${wrong.join('; ')}`)
  return { pass: true, detail: `one ${spend} µLXC spend row and beside it one −${want} µLXC "${label(bps)}" row: ${bps} basis points of the spend, rounded up` }
}

/** A call on the workspace's own provider key: Lens sent it on that key, and charged it nothing. */
export function ownKeyVerdict(asked: Proxied, fresh: readonly LedgerRow[]): Verdict {
  const charged = fresh.filter((r) => r.type === 'spend' || r.type === 'platform_fee')
  if (!asked.ownKey) return fail(`Lens did not send the call on the workspace's own key (no X-Talyvor-BYOK: own-key); it answered ${asked.status}${asked.error === undefined ? '' : ` "${asked.error}"`}`)
  if (charged.length > 0) return fail(`a call on the workspace's own key wrote ${charged.map((r) => `${r.type} ${r.amount_ulxc} µLXC`).join(' and ')}`)
  return {
    pass: true,
    detail: asked.reply !== undefined
      ? "answered on the workspace's own key, and the ledger gained no spend row and no platform_fee row"
      : `sent on the workspace's own key, which the provider refused (${asked.status}: the harness holds no real provider key, only a placeholder), and the ledger gained no spend row and no platform_fee row`,
  }
}

type Made = { status: number; agent?: { id: string }; refusal?: PlanRefusal }

/** Lens's answer to a Free workspace's fourth agent: the plan's refusal, naming the free and the team plans. */
export function fourthAgentVerdict(r: Made): Verdict {
  return pastAgentsVerdict(r, 'free', FREE_AGENTS, 'team', 'fourth')
}

/** Lens's answer to one agent past the `limit` of `plan`: the plan's refusal (402), naming LENS_PLAN_GATES, the plan and `allows`. */
export function pastAgentsVerdict(r: Made, plan: Plan, limit: number, allows: Plan, ordinal: string): Verdict {
  if (r.agent !== undefined) return fail(`a ${NAME[plan]} workspace with ${limit} agents made a ${ordinal}, ${r.agent.id}`)
  const said = r.refusal?.error ?? ''
  if (r.status !== 402) return fail(`the ${ordinal} agent was refused ${r.status} "${said}", not by the plan (402)`)
  const missing = ['LENS_PLAN_GATES', `the ${plan} plan allows ${limit} agents`, `the ${allows} plan`].filter((w) => !said.includes(w))
  if (missing.length > 0) return fail(`the refusal "${said}" does not name ${missing.join(', ')}`)
  const got: Partial<PlanRefusal> = r.refusal ?? {}
  if (got.plan !== plan || got.gate !== 'agents' || got.limit !== limit || got.allows !== allows) {
    return fail(`the refusal reads plan ${got.plan}, gate ${got.gate}, limit ${got.limit}, allowing ${got.allows}; not ${plan}, agents, ${limit}, ${allows}`)
  }
  return { pass: true, detail: `the ${ordinal} agent was refused in Lens's words: "${said}"` }
}

/** A seller's first sale of a dollar, cleared: the seller's share and Talyvor's take of the price before tax. */
export function splitVerdict(e: NonNullable<MarketEarnings['earnings']>[number] | undefined): Verdict {
  if (e === undefined) return fail('the bill was paid, but the seller has no earning from the sale')
  const keep = BPS - MARKET_TAKE_BPS
  const share = Math.floor((DOLLAR_USD_MICROS * keep) / BPS)
  const take = DOLLAR_USD_MICROS - share
  if (e.gross_usd_micros !== DOLLAR_USD_MICROS || e.share_usd_micros !== share || e.fee_usd_micros !== take) {
    return fail(`a $1.00 sale cleared at gross ${e.gross_usd_micros}, the seller's share ${e.share_usd_micros} and Talyvor's ${e.fee_usd_micros} µUSD; want ${DOLLAR_USD_MICROS}, ${share} and ${take}`)
  }
  return { pass: true, detail: `the $1.00 sale cleared at ${share} µUSD to the seller and ${take} µUSD to Talyvor, ${keep / 100}% and ${MARKET_TAKE_BPS / 100}% of the price before tax` }
}

/** "$49" for 4900 cents: whole dollars, as /pricing writes a plan's price. */
const dollars = (cents: number): string => `$${(cents / 100).toLocaleString('en-US')}`

/** Lens's company plan prices, and what /pricing shows for each: both the decided price. */
export function pricesVerdict(served: readonly { id: string; usd_cents: number }[], shown: Readonly<Record<string, string>>): Verdict {
  const wrong: string[] = []
  for (const [id, cents] of Object.entries(PLAN_USD_CENTS)) {
    const lens = served.filter((p) => p.id === id)
    if (lens.length !== 1) wrong.push(`Lens serves ${lens.length} prices for ${id}`)
    else if (lens[0].usd_cents !== cents) wrong.push(`Lens serves ${id} at ${lens[0].usd_cents} cents, not ${cents}`)
    if (shown[id] !== dollars(cents)) wrong.push(`/pricing shows ${id} at "${shown[id] ?? '(nothing)'}", not ${dollars(cents)}`)
  }
  if (wrong.length > 0) return fail(wrong.join('; '))
  return { pass: true, detail: `Lens serves Team at ${PLAN_USD_CENTS.team} and Business at ${PLAN_USD_CENTS.business} cents a month, and /pricing shows ${dollars(PLAN_USD_CENTS.team)} and ${dollars(PLAN_USD_CENTS.business)}` }
}

// ─── reaching each figure ────────────────────────────────────────────────────

export async function within<T>(read: () => Promise<T>, done: (v: T) => boolean, ms: number): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await read()
    if (done(v) || Date.now() > end) return v
    await new Promise((r) => setTimeout(r, 2000))
  }
}

/**
 * Puts the workspace on `plan` with Stripe's test card, on a checkout Lens opens, unless it is on it already:
 * undefined once Lens holds it to the plan, or why not.
 */
async function onPlan(ctx: ScenarioCtx, plan: 'team' | 'business', seed: number): Promise<string | undefined> {
  const { env, app } = ctx
  if ((await env.lens.workspacePlan(app.user)).plan === plan) return undefined
  const start = await env.lens.startSubscription(app.user, plan)
  if (!start.ok || start.value.url === undefined) {
    throw new CannotTest(`Lens opens this test workspace no ${NAME[plan]} checkout: ${start.status} ${start.ok ? 'without a url' : start.error}`)
  }
  const paid = await payCheckout(app, start.value.url, `tester-${seed}@example.com`)
  ctx.evidence.push({ note: `${NAME[plan]}, paid with the test card on ${paid.checkout}${paid.refused === undefined ? '' : `: ${paid.refused}`}` })
  if (paid.refused !== undefined) return `paying for ${NAME[plan]} with the test card: ${paid.refused}`
  const on = await within(() => env.lens.workspacePlan(app.user), (p) => p.plan === plan, WEBHOOK_WAIT_MS)
  return on.plan === plan ? undefined : `paid for ${NAME[plan]} with the test card, and ${WEBHOOK_WAIT_MS / 1000} s on Lens holds the workspace to ${on.plan}`
}

/**
 * One call through Lens's proxy on the workspace's account, its worst case held against the cap first, and the
 * ledger rows it wrote — read until `done` holds of them or `ms` pass. Its spend is booked for the read-back.
 */
async function call(ctx: ScenarioCtx, question: string, done: (rows: LedgerRow[]) => boolean): Promise<{ asked: Proxied; fresh: LedgerRow[] }> {
  const { env, app } = ctx
  const model = env.catalog.find((m) => m.id === env.judgeModel)
  if (model === undefined) throw new Error(`the catalog has no model ${env.judgeModel}`)
  const before = new Set((await env.lens.ledger(app.user)).map((r) => r.id))
  const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(question.length), MAX_TOKENS))
  let asked: Proxied
  try {
    asked = await env.lens.ask(app.user, env.judgeProvider, env.judgeModel, question, MAX_TOKENS)
  } catch (e) {
    env.cap.settle(hold, undefined)
    throw e
  }
  const fresh = await within(async () => (await env.lens.ledger(app.user)).filter((r) => !before.has(r.id)), done, CHARGE_WAIT_MS)
  const spends = fresh.filter((r) => r.type === 'spend')
  env.cap.settle(hold, (spends.reduce((s, r) => s - r.amount_ulxc, 0) / 1e6) * env.usdPerLXC)
  for (const r of spends) env.book.add(app.user.workspaceID, -r.amount_ulxc)
  ctx.evidence.push({
    note: `asked ${env.judgeModel}${asked.ownKey ? ' on the own key' : ''}: ${asked.status}${asked.reply?.replayed ? ', replayed' : ''}${asked.reply?.pooledULXC !== undefined ? ', from the pool' : ''}`,
    question,
    answer: asked.reply?.text,
    error: asked.error,
    ledger: fresh.map((r) => ({ type: r.type, amount_ulxc: r.amount_ulxc, created_at: r.created_at })),
  })
  return { asked, fresh }
}

const charged = (rows: LedgerRow[]): boolean => rows.some((r) => r.type === 'spend') && rows.some((r) => r.type === 'platform_fee')

// ─── the scenarios ───────────────────────────────────────────────────────────

export function pricingFee(plan: Plan, seed: number): Scenario {
  const bps = PLATFORM_FEE_BPS[plan]
  return {
    id: `pricing-fee-${plan}`,
    owner: 'talyvor-lens',
    // B35.7 — on a workspace of its own, created on Free: Team and Business are bought on it with the test card.
    own: true,
    title: `on ${NAME[plan]}${plan === 'free' ? '' : ' (a test-mode subscription)'}, a model call charged to credits writes its spend row and one platform_fee row of ${bps / 100}% of it, rounded up to the µLXC`,
    feature: 'Pricing',
    run: async (ctx) => {
      if (plan !== 'free') {
        const why = await onPlan(ctx, plan, seed)
        if (why !== undefined) return fail(why)
      }
      const on = await ctx.env.lens.workspacePlan(ctx.app.user)
      ctx.evidence.push({ note: `Lens holds the workspace to ${on.plan}` })
      if (on.plan !== plan) return fail(`a new test workspace is on ${on.plan}, not ${plan}`)
      const { asked, fresh } = await call(ctx, PRICED_QUESTION, charged)
      if (asked.reply === undefined) return fail(`the call was refused: ${asked.status} ${asked.error}`)
      if (asked.reply.replayed) throw new Error("Lens replayed the workspace's own earlier answer, which costs nothing: there is no fee to judge")
      return feeVerdict(fresh, bps)
    },
  }
}

/**
 * On Business, which includes own provider keys, the workspace saves one and asks a question nobody has asked,
 * so neither its cache nor the pool can answer it and Lens must send it on that key. The harness holds no real
 * provider key, so the provider refuses the placeholder: the oracles are Lens's own-key header and a ledger
 * that gains no spend row and no platform_fee row. The key is deleted after.
 */
export function pricingOwnKey(seed: number): Scenario {
  return {
    id: 'pricing-own-key',
    owner: 'talyvor-lens',
    own: true,
    title: "on Business, a model call on the workspace's own provider key goes on that key, and the ledger gains no spend row and no platform_fee row",
    feature: 'Pricing',
    run: async (ctx) => {
      const { env, app } = ctx
      const why = await onPlan(ctx, 'business', seed)
      if (why !== undefined) return fail(why)
      const provider = env.judgeProvider
      const saved = await env.lens.putProviderKey(app.user, provider, `sk-talyvor-e2e-placeholder-${seed}-${Date.now().toString(36)}`)
      ctx.evidence.push({ note: `save an own ${provider} key: ${saved.status}${saved.ok ? '' : ` ${saved.error}`}` })
      if (!saved.ok && saved.status === 404) throw new CannotTest('Lens holds no provider keys on this deployment (LENS_PROVIDER_SECRET_KEK unset), so no call can be made on one')
      if (!saved.ok) return fail(`on Business, saving an own provider key was refused: ${saved.status} ${saved.error}`)
      try {
        const nonce = Date.now().toString(36)
        const { asked, fresh } = await call(ctx, `What is 512 + 291? Reply with the number only. (${nonce})`, () => false)
        return ownKeyVerdict(asked, fresh)
      } finally {
        await env.lens.deleteProviderKey(app.user, provider)
      }
    },
  }
}

export function pricingFreeAgents(seed: number): Scenario {
  return {
    id: 'pricing-free-agents',
    owner: 'talyvor-lens',
    // B35.7 — Free's own gate, on a workspace of its own: nothing else run by its user fills it first.
    plan: 'free',
    own: true,
    title: `a Free workspace makes up to ${FREE_AGENTS} agents; the fourth is refused in Lens's words, naming LENS_PLAN_GATES, the free plan and the team plan, and the workspace still has ${FREE_AGENTS}`,
    feature: 'Agent Wallets',
    run: async (ctx) => {
      const { env, app } = ctx
      const on = await env.lens.workspacePlan(app.user)
      ctx.evidence.push({ note: `Lens holds the workspace to ${on.plan}, with ${on.agents_used} agent(s)` })
      if (on.plan !== 'free') return fail(`a new test workspace is on ${on.plan}, not free`)
      if (on.agents_used > FREE_AGENTS) return fail(`a Free workspace already has ${on.agents_used} agents, more than its ${FREE_AGENTS}`)
      for (let n = on.agents_used + 1; n <= FREE_AGENTS; n++) {
        const made = await env.lens.tryCreateAgent(app.user, `Allowed ${seed}-${n}`)
        if (made.agent === undefined) return fail(`on Free, agent ${n} of ${FREE_AGENTS} was refused: ${made.status} "${made.refusal?.error}"`)
      }
      const fourth = await env.lens.tryCreateAgent(app.user, `Fourth ${seed}`)
      ctx.evidence.push({ note: `create a fourth agent: ${fourth.status}`, answer: JSON.stringify(fourth.refusal ?? fourth.agent) })
      const v = fourthAgentVerdict(fourth)
      if (!v.pass) return v
      const after = await env.lens.workspacePlan(app.user)
      if (after.agents_used !== FREE_AGENTS) return fail(`refused, yet Lens counts ${after.agents_used} agents on the workspace, not ${FREE_AGENTS}`)
      return v
    },
  }
}

/**
 * B35.7 — each paid plan's own gate, on a workspace of its own created on it (talyvor-lens B35.1): Team makes agents up
 * to its 25th and is refused the 26th, naming LENS_PLAN_GATES, the team plan and the business plan; Business makes the
 * 26th. Each offers Slack and Teams approvals, which Free does not, as Lens's read of the workspace's plan says.
 */
export function planAgents(plan: 'team' | 'business', seed: number): Scenario {
  const past = TEAM_AGENTS + 1
  return {
    id: `plan-agents-${plan}`,
    owner: 'talyvor-lens',
    plan,
    own: true,
    title: plan === 'team'
      ? `a Team workspace makes up to ${TEAM_AGENTS} agents and is refused the ${past}th in Lens's words, naming LENS_PLAN_GATES, the team plan and the business plan; Team offers Slack and Teams approvals`
      : `a Business workspace makes its ${past}th agent, past Team's ${TEAM_AGENTS}; Business offers Slack and Teams approvals`,
    feature: 'Agent Wallets',
    run: async (ctx) => {
      const { env, app } = ctx
      const on = await env.lens.workspacePlan(app.user)
      ctx.evidence.push({ note: `Lens holds the workspace to ${on.plan}, with ${on.agents_used} agent(s); its gates ${JSON.stringify(on.gates)}` })
      if (on.plan !== plan) return fail(`a test workspace created on ${plan} is on ${on.plan}`)
      if (on.gates.slack_teams_approvals !== true) return fail(`Lens's read of a ${NAME[plan]} workspace's plan does not offer Slack and Teams approvals: slack_teams_approvals is ${String(on.gates.slack_teams_approvals)}`)
      for (let n = on.agents_used + 1; n <= TEAM_AGENTS; n++) {
        const made = await env.lens.tryCreateAgent(app.user, `Gate ${seed}-${n}`)
        if (made.agent === undefined) return fail(`on ${NAME[plan]}, agent ${n} of ${TEAM_AGENTS} was refused: ${made.status} "${made.refusal?.error}"`)
      }
      const last = await env.lens.tryCreateAgent(app.user, `Gate ${seed}-${past}`)
      ctx.evidence.push({ note: `create agent ${past}: ${last.status}`, answer: JSON.stringify(last.refusal ?? last.agent) })
      const after = await env.lens.workspacePlan(app.user)
      if (plan === 'business') {
        if (last.agent === undefined) return fail(`on Business, agent ${past} was refused: ${last.status} "${last.refusal?.error}"`)
        if (after.agents_used !== past) return fail(`agent ${past} was made, yet Lens counts ${after.agents_used} agents on the workspace`)
        return { pass: true, detail: `on Business the workspace made its ${past}th agent, past Team's ${TEAM_AGENTS}, and Lens offers it Slack and Teams approvals` }
      }
      const v = pastAgentsVerdict(last, 'team', TEAM_AGENTS, 'business', `${past}th`)
      if (!v.pass) return v
      if (after.agents_used !== TEAM_AGENTS) return fail(`refused, yet Lens counts ${after.agents_used} agents on the workspace, not ${TEAM_AGENTS}`)
      return { pass: true, detail: `${v.detail}; the workspace still has ${TEAM_AGENTS}, and Lens offers it Slack and Teams approvals` }
    },
  }
}

/** The seller (`seller`) has sold nothing before; the buyer buys nothing else, so paying its whole bill clears this sale alone. */
export function pricingSellerSplit(seed: number, seller: number): Scenario {
  return {
    id: 'pricing-seller-split',
    owner: 'talyvor-lens',
    title: "a seller's first $1.00 sale, its buyer's bill paid, clears at 850,000 µUSD to the seller and 150,000 µUSD to Talyvor",
    feature: 'Marketplace',
    run: async (ctx) => {
      const { env } = ctx
      const before = await env.lens.marketEarnings(env.userAt(seller))
      if (before.lifetime_gross_usd_micros !== 0) throw new Error(`the seller has sold ${before.lifetime_gross_usd_micros} µUSD before, so this would not be its first sale`)
      const bought = await buyFrom(ctx, seller, seed, Math.round(DOLLAR_USD_MICROS / env.usdPerLXC))
      if (typeof bought === 'string') return fail(bought)
      const paid = await payBill(ctx)
      if (typeof paid === 'string') return fail(paid)
      const cleared = await clearedBothSides(ctx, bought)
      if (typeof cleared === 'string') return fail(cleared)
      return splitVerdict((cleared.earned.earnings ?? []).find((x) => x.use_id === bought.line.use_id))
    },
  }
}

export function pricingApproved(): Scenario {
  return {
    id: 'pricing-approved',
    owner: 'talyvor-suite',
    title: "/pricing shows Team at $49 and Business at $299 a month, the prices Lens's public plans read serves",
    run: async (ctx) => {
      const served = await ctx.env.lens.companyPlans()
      const page = await ctx.app.tab('/pricing')
      const shown: Record<string, string> = {}
      try {
        for (const id of Object.keys(PLAN_USD_CENTS)) {
          const price = page.getByTestId(`price-${id}`)
          shown[id] = await price.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS }).then(async () => (await price.innerText()).trim(), () => '(not shown)')
        }
      } finally {
        await page.close()
      }
      ctx.evidence.push({ note: `Lens serves ${JSON.stringify(served)}; /pricing shows ${JSON.stringify(shown)}` })
      return pricesVerdict(served, shown)
    },
  }
}
