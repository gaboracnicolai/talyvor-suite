// B34.4 — every wallet, agent and marketplace route has a tester. With B34.1's stale reason gone, the routes it excused
// read "not covered" unless a scenario reaches them, so each one here is reached by a scenario between two test
// companies (B25.4's pairs): this user, a person whose browser calls the BFF as the app does, and the other company,
// whose software calls Lens with its own token. Every oracle is what Lens stored, read back from both sides; money is
// read on both agents' accounts: one posting on each side, both balances moved by exactly the amount, nothing else
// moved. A route for a feature Talyvor has switched off is checked to refuse and move nothing, naming the feature.
//
// Lens's routes that no BFF route leads to by the same path (the BFF's /api/wallets/… answer through /money-requests,
// /loans, /escrows, …) are reached once through the app and once straight on Lens, so both rows of the map are.

import { createECDH, randomBytes, randomUUID } from 'node:crypto'
import type { AgentLine, AgentTransfer, Answered, Escrow, Loan, MoneyRequest, SyntheticUser } from './lens.ts'
import { refusalOf } from './lens.ts'
import { fail, lxcText } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { otherCompany, until } from './trade.ts'
import type { Scenario, ScenarioCtx, Verdict } from './scenarios.ts'

const DAY_MS = 24 * 3600e3
/** How long a licence's sale may take to reach its seller's pending earnings: past 90 s once on production (6 Oct). */
const SALE_METERED_MS = 180_000
/** How long the pot is locked for: long enough to be refused, short enough to wait out. */
const POT_LOCK_MS = 45_000

/** B34.4 — a BFF route as the app calls it, from the person's signed-in page: the coverage map records it under the scenario. */
export async function bff<T>(ctx: ScenarioCtx, method: string, path: string, body?: unknown): Promise<Answered<T>> {
  const r = await ctx.app.page.evaluate(async ({ m, p, b }) => {
    const res = await fetch(p, {
      method: m,
      credentials: 'same-origin',
      headers: b === null ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: b === null ? undefined : JSON.stringify(b),
    })
    return { status: res.status, text: await res.text() }
  }, { m: method, p: path, b: body === undefined ? null : body })
  if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status, value: (r.text === '' ? null : JSON.parse(r.text)) as T }
  return { ok: false, status: r.status, error: refusalOf(r.text) }
}

/** What a step answered, for the evidence. */
const said = (a: Answered<unknown>): string => a.ok ? `${a.status} ${JSON.stringify(a.value).slice(0, 300)}` : `refused ${a.status}: ${a.error}`

// ─── both sides' accounts ────────────────────────────────────────────────────

/** One side of a trade: a company and one of its agents. */
interface Side { user: SyntheticUser; agent: string; who: string }
type Books = { lines: AgentLine[]; balance: number | undefined }[]

async function books(ctx: ScenarioCtx, sides: readonly Side[]): Promise<Books> {
  return Promise.all(sides.map(async (s) => ({
    lines: await ctx.env.lens.agentLines(s.user, s.agent),
    balance: (await ctx.env.lens.agentBook(s.user)).agents.find((a) => a.id === s.agent)?.balance_ulxc,
  })))
}

/**
 * Each side's account moved by exactly `want[i]` µLXC since `before`: one new posting of that amount, its balance
 * after it the balance before plus it, and the agent's balance with it — or, for 0, no posting and the balance unmoved.
 * Undefined when it did, else what moved instead.
 */
async function movedBy(ctx: ScenarioCtx, sides: readonly Side[], before: Books, want: readonly number[], step: string): Promise<string | undefined> {
  const after = await books(ctx, sides)
  const wrong: string[] = []
  const seen: string[] = []
  sides.forEach((s, i) => {
    const fresh = after[i].lines.filter((l) => !before[i].lines.some((o) => o.entry_id === l.entry_id && o.kind === l.kind && o.amount_ulxc === l.amount_ulxc))
    const text = fresh.map((l) => `${l.kind} ${l.amount_ulxc} → ${l.balance_after_ulxc}`).join(', ') || 'no posting'
    seen.push(`${s.who}: ${text}, balance ${before[i].balance} → ${after[i].balance}`)
    const b0 = before[i].balance ?? 0
    if (want[i] === 0) {
      if (fresh.length !== 0 || after[i].balance !== before[i].balance) wrong.push(`${s.who} should not have moved; it has ${text} and holds ${after[i].balance} µLXC (was ${b0})`)
      return
    }
    if (fresh.length !== 1 || fresh[0].amount_ulxc !== want[i] || fresh[0].balance_after_ulxc !== b0 + want[i] || after[i].balance !== b0 + want[i]) {
      wrong.push(`${s.who} should have one posting of ${want[i]} µLXC leaving ${b0 + want[i]}; it has ${text} and holds ${after[i].balance} µLXC`)
    }
  })
  ctx.evidence.push({ note: `${step} — ${seen.join('; ')}` })
  return wrong.length === 0 ? undefined : `${step}: ${wrong.join('; ')}`
}

/** An agent of the person's own workspace, created and funded through the app (Agent Wallets' own BFF routes). */
async function appAgent(ctx: ScenarioCtx, name: string, fund: number): Promise<Side | string> {
  const made = await bff<{ id: string; name: string }>(ctx, 'POST', '/api/agents', { name })
  if (!made.ok) return `creating ${name} in the app was refused: ${made.status} ${made.error}`
  if (fund > 0) {
    const f = await bff(ctx, 'POST', `/api/agents/${made.value.id}/fund`, { amount_ulxc: fund })
    if (!f.ok) return `funding ${name} with ${lxcText(fund)} LXC was refused: ${f.status} ${f.error}`
  }
  return { user: ctx.app.user, agent: made.value.id, who: name }
}

/** The other company and its agent, as a side; funded with `fund` µLXC. */
async function otherSide(ctx: ScenarioCtx, partner: number, name: string, fund: number): Promise<Side> {
  const o = await otherCompany(ctx, partner, name, fund)
  return { user: o.co, agent: o.agent.id, who: `the other company's ${name}` }
}

const memoOf = (what: string, seed: number): string => `${what} ${seed}-${RUN_SALT}`

// ─── money requests: asked, accepted, declined, given back ───────────────────

/**
 * The person's agent asks the other company's for credits through the app, and the other company accepts on Lens: one
 * transfer both see, one posting each side. The person gives it back through the app. Then each side declines one the
 * other asked for — the person in the app, the other company on Lens — and nothing moves.
 */
export function walletRequestsAnswered(seed: number, partner: number): Scenario {
  const amount = 600_000
  return {
    id: 'wallet-requests-answered',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "money requests both ways: asked in the app and accepted on Lens, one posting each side; given back in the app; declined by each side, nothing moved",
    run: async (ctx) => {
      const { env } = ctx
      const a = await appAgent(ctx, `Asker ${seed}`, 1e6)
      if (typeof a === 'string') return fail(a)
      const b = await otherSide(ctx, partner, `Payer ${seed}`, 3e6)
      const sides = [a, b]
      const reqOf = async (u: SyntheticUser, id: string): Promise<MoneyRequest | undefined> => (await env.lens.moneyRequests(u)).find((r) => r.id === id)

      // 1. Asked in the app, accepted on Lens.
      let before = await books(ctx, sides)
      const asked = await bff<MoneyRequest>(ctx, 'POST', `/api/agents/${a.agent}/requests`, { from: b.agent, amount_ulxc: amount, memo: memoOf('invoice', seed) })
      ctx.evidence.push({ note: `asked in the app: ${said(asked)}` })
      if (!asked.ok) return fail(`asking through the app was refused: ${asked.status} ${asked.error}`)
      const accepted = await env.lens.act<MoneyRequest>(b.user, 'POST', `/v1/workspaces/{ws}/money-requests/${asked.value.id}/accept`)
      ctx.evidence.push({ note: `the other company accepts on Lens: ${said(accepted)}` })
      if (!accepted.ok) return fail(`accepting on Lens was refused: ${accepted.status} ${accepted.error}`)
      const [mine, theirs] = [await reqOf(a.user, asked.value.id), await reqOf(b.user, asked.value.id)]
      if (mine?.status !== 'accepted' || theirs?.status !== 'accepted' || mine.transfer_id === undefined || mine.transfer_id !== theirs.transfer_id) {
        return fail(`accepted on Lens, the request reads ${mine?.status ?? 'missing'} to the asker and ${theirs?.status ?? 'missing'} to the payer: ${JSON.stringify([mine, theirs])}`)
      }
      let wrong = await movedBy(ctx, sides, before, [amount, -amount], 'accepted on Lens')
      if (wrong !== undefined) return fail(wrong)

      // 2. Given back in the app.
      before = await books(ctx, sides)
      const back = await bff<AgentTransfer>(ctx, 'POST', `/api/wallets/transfers/${mine.transfer_id}/refund`)
      ctx.evidence.push({ note: `given back in the app: ${said(back)}` })
      if (!back.ok) return fail(`giving it back through the app was refused: ${back.status} ${back.error}`)
      const refunds = (await env.lens.transfers(b.user, b.agent)).filter((t) => t.refund_of === mine.transfer_id)
      if (refunds.length !== 1 || refunds[0].id !== back.value.id) return fail(`given back, the payer sees ${refunds.length} refund(s) of ${mine.transfer_id}: ${JSON.stringify(refunds)}`)
      wrong = await movedBy(ctx, sides, before, [-amount, amount], 'given back in the app')
      if (wrong !== undefined) return fail(wrong)

      // 3. The other company asks; the person declines in the app.
      before = await books(ctx, sides)
      const theyAsk = await env.lens.requestMoney(b.user, b.agent, a.agent, amount, memoOf('second invoice', seed))
      if (!theyAsk.ok) return fail(`the other company could not ask: ${theyAsk.status} ${theyAsk.error}`)
      const declined = await bff<MoneyRequest>(ctx, 'POST', `/api/wallets/requests/${theyAsk.value.id}/decline`)
      ctx.evidence.push({ note: `declined in the app: ${said(declined)}` })
      if (!declined.ok) return fail(`declining through the app was refused: ${declined.status} ${declined.error}`)
      // 4. The person asks again; the other company declines on Lens.
      const again = await bff<MoneyRequest>(ctx, 'POST', `/api/agents/${a.agent}/requests`, { from: b.agent, amount_ulxc: amount, memo: memoOf('third invoice', seed) })
      if (!again.ok) return fail(`asking again through the app was refused: ${again.status} ${again.error}`)
      const theyDecline = await env.lens.act<MoneyRequest>(b.user, 'POST', `/v1/workspaces/{ws}/money-requests/${again.value.id}/decline`)
      ctx.evidence.push({ note: `the other company declines on Lens: ${said(theyDecline)}` })
      if (!theyDecline.ok) return fail(`declining on Lens was refused: ${theyDecline.status} ${theyDecline.error}`)
      for (const id of [theyAsk.value.id, again.value.id]) {
        const [x, y] = [await reqOf(a.user, id), await reqOf(b.user, id)]
        if (x?.status !== 'declined' || y?.status !== 'declined' || x.transfer_id !== undefined || y.transfer_id !== undefined) {
          return fail(`declined, request ${id} reads ${x?.status ?? 'missing'} and ${y?.status ?? 'missing'} to the two companies: ${JSON.stringify([x, y])}`)
        }
      }
      wrong = await movedBy(ctx, sides, before, [0, 0], 'two requests declined')
      if (wrong !== undefined) return fail(wrong)
      return { pass: true, detail: `asked in the app and accepted on Lens: one transfer of ${lxcText(amount)} LXC both see, one posting each side; given back in the app: both where they began; declined in the app and on Lens: both requests declined, nothing moved` }
    },
  }
}

// ─── loans: offered, read, declined, withdrawn, accepted ─────────────────────

/**
 * Loans both ways, each read by both sides on Lens: the person offers in the app and the other company declines on
 * Lens, then the person offers again and withdraws it in the app; the other company offers on Lens and the person
 * declines in the app, then it offers again and withdraws on Lens; nothing moves for any of the four. Last, it offers
 * once more and the person accepts in the app: the principal is one posting on each side.
 */
export function walletLoansAnswered(seed: number, partner: number): Scenario {
  const principal = 700_000
  const terms = { principal_ulxc: principal, interest_bps: 0, instalments: 1, every: 'week', late_fee_ulxc: 0 }
  return {
    id: 'wallet-loans-answered',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "loans both ways, read on Lens by both sides: declined and withdrawn in the app and on Lens move nothing; accepted in the app, the principal is one posting each side",
    run: async (ctx) => {
      const { env } = ctx
      const a = await appAgent(ctx, `Lends and borrows ${seed}`, 2e6)
      if (typeof a === 'string') return fail(a)
      const b = await otherSide(ctx, partner, `Borrows and lends ${seed}`, 2e6)
      const sides = [a, b]
      const read = async (id: string): Promise<[Answered<Loan>, Answered<Loan>]> =>
        [await env.lens.act<Loan>(a.user, 'GET', `/v1/workspaces/{ws}/loans/${id}`), await env.lens.act<Loan>(b.user, 'GET', `/v1/workspaces/{ws}/loans/${id}`)]
      /** Both sides read loan `id` on Lens as `status`; undefined when they do. */
      const bothRead = async (id: string, status: string): Promise<string | undefined> => {
        const [x, y] = await read(id)
        ctx.evidence.push({ note: `loan ${id} on Lens: the person's side ${said(x)}; the other company's ${said(y)}` })
        if (!x.ok || !y.ok || x.value.status !== status || y.value.status !== status) return `loan ${id} should read ${status} to both companies on Lens: ${said(x)} | ${said(y)}`
        return undefined
      }
      const before = await books(ctx, sides)

      // The person offers; the other company declines on Lens.
      const o1 = await bff<Loan>(ctx, 'POST', `/api/agents/${a.agent}/loans`, { to: b.agent, ...terms, memo: memoOf('loan one', seed) })
      ctx.evidence.push({ note: `offered in the app: ${said(o1)}` })
      if (!o1.ok) return fail(`offering a loan through the app was refused: ${o1.status} ${o1.error}`)
      let why = await bothRead(o1.value.id, 'offered')
      if (why !== undefined) return fail(why)
      const d1 = await env.lens.act<Loan>(b.user, 'POST', `/v1/workspaces/{ws}/loans/${o1.value.id}/decline`)
      if (!d1.ok) return fail(`declining on Lens was refused: ${d1.status} ${d1.error}`)
      if ((why = await bothRead(o1.value.id, 'declined')) !== undefined) return fail(why)

      // The person offers again and withdraws it in the app.
      const o2 = await bff<Loan>(ctx, 'POST', `/api/agents/${a.agent}/loans`, { to: b.agent, ...terms, memo: memoOf('loan two', seed) })
      if (!o2.ok) return fail(`offering a second loan through the app was refused: ${o2.status} ${o2.error}`)
      const w2 = await bff(ctx, 'POST', `/api/wallets/loans/${o2.value.id}/withdraw`)
      ctx.evidence.push({ note: `withdrawn in the app: ${said(w2)}` })
      if (!w2.ok) return fail(`withdrawing through the app was refused: ${w2.status} ${w2.error}`)
      if ((why = await bothRead(o2.value.id, 'withdrawn')) !== undefined) return fail(why)

      // The other company offers on Lens; the person declines in the app.
      const lend = (n: string) => env.lens.act<Loan>(b.user, 'POST', `/v1/workspaces/{ws}/agents/${b.agent}/loans`, { to: a.agent, ...terms, memo: memoOf(n, seed) })
      const o3 = await lend('loan three')
      ctx.evidence.push({ note: `the other company offers on Lens: ${said(o3)}` })
      if (!o3.ok) return fail(`offering a loan on Lens was refused: ${o3.status} ${o3.error}`)
      const d3 = await bff(ctx, 'POST', `/api/wallets/loans/${o3.value.id}/decline`)
      if (!d3.ok) return fail(`declining through the app was refused: ${d3.status} ${d3.error}`)
      if ((why = await bothRead(o3.value.id, 'declined')) !== undefined) return fail(why)

      // It offers again and withdraws on Lens.
      const o4 = await lend('loan four')
      if (!o4.ok) return fail(`offering a second loan on Lens was refused: ${o4.status} ${o4.error}`)
      const w4 = await env.lens.act(b.user, 'POST', `/v1/workspaces/{ws}/loans/${o4.value.id}/withdraw`)
      ctx.evidence.push({ note: `the other company withdraws on Lens: ${said(w4)}` })
      if (!w4.ok) return fail(`withdrawing on Lens was refused: ${w4.status} ${w4.error}`)
      if ((why = await bothRead(o4.value.id, 'withdrawn')) !== undefined) return fail(why)
      let wrong = await movedBy(ctx, sides, before, [0, 0], 'four loans declined or withdrawn')
      if (wrong !== undefined) return fail(wrong)

      // It offers once more; the person accepts in the app.
      const o5 = await lend('loan five')
      if (!o5.ok) return fail(`offering a third loan on Lens was refused: ${o5.status} ${o5.error}`)
      const mid = await books(ctx, sides)
      const acc = await bff<Loan>(ctx, 'POST', `/api/wallets/loans/${o5.value.id}/accept`)
      ctx.evidence.push({ note: `accepted in the app: ${said(acc)}` })
      if (!acc.ok) return fail(`accepting through the app was refused: ${acc.status} ${acc.error}`)
      if ((why = await bothRead(o5.value.id, 'active')) !== undefined) return fail(why)
      wrong = await movedBy(ctx, sides, mid, [principal, -principal], 'accepted in the app')
      if (wrong !== undefined) return fail(wrong)
      return { pass: true, detail: `four loans declined or withdrawn — two in the app, two on Lens — each read so by both sides, nothing moved; the fifth accepted in the app: ${lxcText(principal)} LXC, one posting each side` }
    },
  }
}

// ─── escrow, on Lens ──────────────────────────────────────────────────────────

/**
 * The other company pays into escrow for the person's agent on Lens, both read it held on Lens; it confirms delivery on
 * Lens and the payee is paid: one posting each side. A second escrow it disputes on Lens stays held, and nothing more moves.
 */
export function walletEscrowLens(seed: number, partner: number): Scenario {
  const amount = 500_000
  return {
    id: 'wallet-escrow-lens',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "another company pays into escrow on Lens: both read it held; confirmed on Lens, the payee is paid, one posting each side; disputed on Lens, it stays held and nothing more moves",
    run: async (ctx) => {
      const { env } = ctx
      const a = await appAgent(ctx, `Payee ${seed}`, 0)
      if (typeof a === 'string') return fail(a)
      const b = await otherSide(ctx, partner, `Escrow payer ${seed}`, 3e6)
      const sides = [a, b]
      const pay = (memo: string) => env.lens.act<Escrow>(b.user, 'POST', `/v1/workspaces/{ws}/agents/${b.agent}/escrows`,
        { to: a.agent, amount_ulxc: amount, release_at: new Date(Date.now() + 7 * DAY_MS).toISOString(), memo })
      const bothRead = async (id: string, status: Escrow['status']): Promise<string | undefined> => {
        const x = await env.lens.act<Escrow>(a.user, 'GET', `/v1/workspaces/{ws}/escrows/${id}`)
        const y = await env.lens.act<Escrow>(b.user, 'GET', `/v1/workspaces/{ws}/escrows/${id}`)
        ctx.evidence.push({ note: `escrow ${id} on Lens: the payee's side ${said(x)}; the payer's ${said(y)}` })
        if (!x.ok || !y.ok || x.value.status !== status || y.value.status !== status || x.value.amount_ulxc !== amount) {
          return `escrow ${id} should read ${status} for ${amount} µLXC to both companies on Lens: ${said(x)} | ${said(y)}`
        }
        return undefined
      }

      let before = await books(ctx, sides)
      const e1 = await pay(memoOf('escrow one', seed))
      ctx.evidence.push({ note: `paid into escrow on Lens: ${said(e1)}` })
      if (!e1.ok) return fail(`paying into escrow on Lens was refused: ${e1.status} ${e1.error}`)
      let why = await bothRead(e1.value.id, 'held')
      if (why !== undefined) return fail(why)
      let wrong = await movedBy(ctx, sides, before, [0, -amount], 'paid into escrow')
      if (wrong !== undefined) return fail(wrong)
      before = await books(ctx, sides)
      const c1 = await env.lens.act<Escrow>(b.user, 'POST', `/v1/workspaces/{ws}/escrows/${e1.value.id}/confirm`)
      ctx.evidence.push({ note: `confirmed on Lens: ${said(c1)}` })
      if (!c1.ok) return fail(`confirming on Lens was refused: ${c1.status} ${c1.error}`)
      if ((why = await bothRead(e1.value.id, 'released')) !== undefined) return fail(why)
      wrong = await movedBy(ctx, sides, before, [amount, 0], 'confirmed delivered')
      if (wrong !== undefined) return fail(wrong)

      const e2 = await pay(memoOf('escrow two', seed))
      if (!e2.ok) return fail(`paying a second escrow on Lens was refused: ${e2.status} ${e2.error}`)
      before = await books(ctx, sides)
      const d2 = await env.lens.act<Escrow>(b.user, 'POST', `/v1/workspaces/{ws}/escrows/${e2.value.id}/dispute`, { reason: memoOf('nothing was delivered', seed) })
      ctx.evidence.push({ note: `disputed on Lens: ${said(d2)}` })
      if (!d2.ok) return fail(`disputing on Lens was refused: ${d2.status} ${d2.error}`)
      if ((why = await bothRead(e2.value.id, 'disputed')) !== undefined) return fail(why)
      wrong = await movedBy(ctx, sides, before, [0, 0], 'disputed')
      if (wrong !== undefined) return fail(wrong)
      return { pass: true, detail: `paid into escrow on Lens: held, read so by both; confirmed: ${lxcText(amount)} LXC to the payee, one posting each side; a second disputed: still held, nothing more moved` }
    },
  }
}

// ─── a handle, the wallet it names, pause and resume, claim ──────────────────

/**
 * The person gives an agent a handle in the app; the other company looks the handle up on Lens, finds that agent, and
 * sends to the handle: one posting each side. The person pauses the agent in the app: its send is refused and nothing
 * moves; resumed, the same send is one posting each side. Claimed in the app, Lens holds the person as its owner.
 */
export function walletHandlePause(seed: number, partner: number): Scenario {
  const amount = 400_000
  return {
    id: 'wallet-handle-pause',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "a handle set in the app finds the agent on Lens and money sent to it lands, one posting each side; paused in the app, its send is refused and nothing moves; resumed, it is paid; claimed, Lens holds its owner",
    run: async (ctx) => {
      const { env } = ctx
      const a = await appAgent(ctx, `Handled ${seed}`, 2e6)
      if (typeof a === 'string') return fail(a)
      const b = await otherSide(ctx, partner, `Handle sender ${seed}`, 2e6)
      const sides = [a, b]
      const handle = `e2e-${RUN_SALT}-${seed}`.slice(0, 32)
      const set = await bff<{ wallet_id: string; handle: string }>(ctx, 'PUT', `/api/agents/${a.agent}/handle`, { handle })
      ctx.evidence.push({ note: `handle set in the app: ${said(set)}` })
      if (!set.ok) return fail(`setting the handle @${handle} was refused: ${set.status} ${set.error}`)
      const found = await env.lens.act<{ wallet_id: string; handle?: string; name: string }>(b.user, 'GET', `/v1/wallets/@${handle}`)
      ctx.evidence.push({ note: `the other company looks up @${handle} on Lens: ${said(found)}` })
      if (!found.ok || found.value.wallet_id !== a.agent || found.value.handle !== handle) return fail(`@${handle} should name ${a.who} (${a.agent}) on Lens: ${said(found)}`)
      let before = await books(ctx, sides)
      const sent = await env.lens.sendCredits(b.user, b.agent, '@' + handle, amount, memoOf('to a handle', seed))
      ctx.evidence.push({ note: `the other company sends to @${handle}: ${said(sent)}` })
      if (!sent.ok) return fail(`sending to @${handle} was refused: ${sent.status} ${sent.error}`)
      let wrong = await movedBy(ctx, sides, before, [amount, -amount], 'sent to the handle')
      if (wrong !== undefined) return fail(wrong)

      const paused = await bff(ctx, 'POST', `/api/agents/${a.agent}/pause`, { reason: memoOf('nightly check', seed) })
      ctx.evidence.push({ note: `paused in the app: ${said(paused)}` })
      if (!paused.ok) return fail(`pausing ${a.who} in the app was refused: ${paused.status} ${paused.error}`)
      const p = (await env.lens.agentBook(a.user)).agents.find((x) => x.id === a.agent)
      if (p?.paused_at === undefined) return fail(`paused in the app, Lens's book has ${a.who} unpaused: ${JSON.stringify(p)}`)
      before = await books(ctx, sides)
      const refused = await bff(ctx, 'POST', `/api/agents/${a.agent}/send`, { to: b.agent, amount_ulxc: amount, memo: memoOf('while paused', seed) })
      ctx.evidence.push({ note: `a send while paused: ${said(refused)}` })
      if (refused.ok) return fail(`${a.who} is paused, yet its send of ${amount} µLXC was made: ${said(refused)}`)
      wrong = await movedBy(ctx, sides, before, [0, 0], 'a send while paused')
      if (wrong !== undefined) return fail(wrong)
      const resumed = await bff(ctx, 'POST', `/api/agents/${a.agent}/resume`)
      ctx.evidence.push({ note: `resumed in the app: ${said(resumed)}` })
      if (!resumed.ok) return fail(`resuming ${a.who} in the app was refused: ${resumed.status} ${resumed.error}`)
      const r = (await env.lens.agentBook(a.user)).agents.find((x) => x.id === a.agent)
      if (r?.paused_at !== undefined) return fail(`resumed in the app, Lens's book still has ${a.who} paused at ${r?.paused_at}`)
      const sentBack = await bff(ctx, 'POST', `/api/agents/${a.agent}/send`, { to: b.agent, amount_ulxc: amount, memo: memoOf('resumed', seed) })
      if (!sentBack.ok) return fail(`resumed, ${a.who}'s send was refused: ${sentBack.status} ${sentBack.error}`)
      wrong = await movedBy(ctx, sides, before, [-amount, amount], 'the same send once resumed')
      if (wrong !== undefined) return fail(wrong)

      const claimed = await bff<{ agent_id: string; owner_user_id: string }>(ctx, 'POST', `/api/agents/${a.agent}/claim`)
      ctx.evidence.push({ note: `claimed in the app: ${said(claimed)}` })
      if (!claimed.ok || claimed.value.owner_user_id === '') return fail(`claiming ${a.who} in the app: ${said(claimed)}`)
      const owned = (await env.lens.agentBook(a.user)).agents.find((x) => x.id === a.agent)
      if (owned?.owner_user_id !== claimed.value.owner_user_id) return fail(`claimed by ${claimed.value.owner_user_id}, Lens's book has ${a.who} owned by ${owned?.owner_user_id ?? 'nobody'}`)
      return { pass: true, detail: `@${handle} names ${a.who} on Lens and ${lxcText(amount)} LXC sent to it landed, one posting each side; paused: its send refused, nothing moved; resumed: the same send one posting each side; claimed: Lens holds its owner` }
    },
  }
}

// ─── schedules, an automatic top-up, a locked pot ────────────────────────────

/**
 * Recurring transfers made and stopped before their first run, each read on Lens: one by the person in the app, one by
 * the other company on Lens; neither pays. An automatic top-up set in the app on an empty agent is read back, and on
 * Lens's minute tick fills the agent to exactly its level from the workspace, one posting; removed in the app, Lens has
 * none. A pot locked in the app refuses to give its credits back or be unlocked early, and nothing moves; its lock past,
 * it gives them back.
 */
export function walletScheduleTopUpPot(seed: number, partner: number): Scenario {
  const amount = 300_000
  const below = 1_000_000
  const to = 2_000_000
  return {
    id: 'wallet-schedule-topup-pot',
    owner: 'talyvor-lens',
    agents: 2,
    partners: [partner],
    title: "recurring transfers made and stopped in the app and on Lens before they run pay nothing; an automatic top-up fills an empty agent to its level on Lens's tick, one posting; a locked pot refuses to give credits back",
    run: async (ctx) => {
      const { env } = ctx
      const a = await appAgent(ctx, `Scheduler ${seed}`, 2e6)
      if (typeof a === 'string') return fail(a)
      const b = await otherSide(ctx, partner, `Scheduled ${seed}`, 2e6)
      const sides = [a, b]
      const tomorrow = new Date(Date.now() + DAY_MS).toISOString()
      let before = await books(ctx, sides)

      // A recurring transfer by the person, stopped in the app before it runs.
      const s1 = await bff<{ id: string; active: boolean }>(ctx, 'POST', `/api/agents/${a.agent}/schedules`,
        { to_agent_id: b.agent, amount_ulxc: amount, memo: memoOf('weekly', seed), every: 'week', first_run_at: tomorrow })
      ctx.evidence.push({ note: `scheduled in the app: ${said(s1)}` })
      if (!s1.ok) return fail(`scheduling in the app was refused: ${s1.status} ${s1.error}`)
      const r1 = await bff<{ runs: unknown[] | null }>(ctx, 'GET', `/api/agents/schedules/${s1.value.id}/runs`)
      if (!r1.ok || (r1.value.runs ?? []).length !== 0) return fail(`a schedule first due tomorrow has runs in the app already: ${said(r1)}`)
      const stop1 = await bff(ctx, 'POST', `/api/agents/schedules/${s1.value.id}/stop`)
      ctx.evidence.push({ note: `stopped in the app: ${said(stop1)}` })
      if (!stop1.ok) return fail(`stopping in the app was refused: ${stop1.status} ${stop1.error}`)
      // And one by the other company, stopped on Lens.
      const s2 = await env.lens.act<{ id: string }>(b.user, 'POST', `/v1/workspaces/{ws}/agents/${b.agent}/schedules`,
        { to_agent_id: a.agent, amount_ulxc: amount, memo: memoOf('weekly back', seed), every: 'week', first_run_at: tomorrow })
      ctx.evidence.push({ note: `the other company schedules on Lens: ${said(s2)}` })
      if (!s2.ok) return fail(`scheduling on Lens was refused: ${s2.status} ${s2.error}`)
      const r2 = await env.lens.act<{ runs: unknown[] | null }>(b.user, 'GET', `/v1/workspaces/{ws}/agents/schedules/${s2.value.id}/runs`)
      if (!r2.ok || (r2.value.runs ?? []).length !== 0) return fail(`a schedule first due tomorrow has runs on Lens already: ${said(r2)}`)
      const stop2 = await env.lens.act(b.user, 'DELETE', `/v1/workspaces/{ws}/agents/schedules/${s2.value.id}`)
      if (!stop2.ok) return fail(`stopping on Lens was refused: ${stop2.status} ${stop2.error}`)
      const live = [...(await env.lens.schedules(a.user)), ...(await env.lens.schedules(b.user))].filter((s) => [s1.value.id, s2.value.id].includes(s.id))
      ctx.evidence.push({ note: `both schedules as Lens lists them: ${JSON.stringify(live)}` })
      if (live.length !== 2 || live.some((s) => s.active)) return fail(`stopped, the two schedules read ${JSON.stringify(live)} on Lens`)
      let wrong = await movedBy(ctx, sides, before, [0, 0], 'two schedules stopped before their first run')
      if (wrong !== undefined) return fail(wrong)

      // An automatic top-up on an empty agent.
      const t = await appAgent(ctx, `Topped ${seed}`, 0)
      if (typeof t === 'string') return fail(t)
      const free0 = (await env.lens.agentBook(a.user)).unallocated_ulxc
      before = await books(ctx, [t])
      const setTop = await bff(ctx, 'PUT', `/api/agents/${t.agent}/topup`, { below_ulxc: below, to_ulxc: to })
      ctx.evidence.push({ note: `top-up set in the app: ${said(setTop)}` })
      if (!setTop.ok) return fail(`setting a top-up in the app was refused: ${setTop.status} ${setTop.error}`)
      const readTop = await bff<{ below_ulxc: number; to_ulxc: number }>(ctx, 'GET', `/api/agents/${t.agent}/topup`)
      if (!readTop.ok || readTop.value.below_ulxc !== below || readTop.value.to_ulxc !== to) return fail(`the top-up reads back ${said(readTop)}, not below ${below} to ${to}`)
      const filled = await until(async () => (await env.lens.agentBook(a.user)).agents.find((x) => x.id === t.agent)?.balance_ulxc ?? 0, (v) => v >= to)
      ctx.evidence.push({ note: `after Lens's tick ${t.who} holds ${filled} µLXC` })
      wrong = await movedBy(ctx, [t], before, [to], `topped up below ${lxcText(below)} to ${lxcText(to)} LXC`)
      if (wrong !== undefined) return fail(wrong)
      const free1 = (await env.lens.agentBook(a.user)).unallocated_ulxc
      if (free1 !== free0 - to) return fail(`the top-up should take ${to} µLXC from the workspace's free credits: ${free0} → ${free1}`)
      const off = await bff(ctx, 'DELETE', `/api/agents/${t.agent}/topup`)
      if (!off.ok) return fail(`removing the top-up in the app was refused: ${off.status} ${off.error}`)
      const gone = await bff(ctx, 'GET', `/api/agents/${t.agent}/topup`)
      if (gone.ok || gone.status !== 404) return fail(`removed in the app, the top-up still reads ${said(gone)}`)

      // A pot, locked and unlocked.
      const pot = await bff<{ id: string }>(ctx, 'POST', `/api/agents/${a.agent}/pots`, { name: memoOf('Reserve', seed), kind: 'reserve' })
      if (!pot.ok) return fail(`opening a pot in the app was refused: ${pot.status} ${pot.error}`)
      const into = await bff(ctx, 'POST', `/api/agents/${a.agent}/pots/${pot.value.id}/in`, { amount_ulxc: amount })
      if (!into.ok) return fail(`setting ${amount} µLXC aside was refused: ${into.status} ${into.error}`)
      // A lock in force can only be made longer, so it is a short one, waited out.
      const until0 = new Date(Date.now() + POT_LOCK_MS).toISOString()
      const locked = await bff<{ locked_until?: string }>(ctx, 'PUT', `/api/agents/${a.agent}/pots/${pot.value.id}/lock`, { locked_until: until0 })
      ctx.evidence.push({ note: `pot locked in the app: ${said(locked)}` })
      const lockedUntil = locked.ok ? locked.value.locked_until : undefined
      if (lockedUntil === undefined) return fail(`locking the pot in the app: ${said(locked)}`)
      const shorter = await bff(ctx, 'PUT', `/api/agents/${a.agent}/pots/${pot.value.id}/lock`, { locked_until: null })
      ctx.evidence.push({ note: `unlocked while the lock is in force: ${said(shorter)}` })
      if (shorter.ok) return fail(`a lock in force was lifted before its time: ${said(shorter)}`)
      const potOf = async () => (await env.lens.pots(a.user, a.agent)).find((p) => p.id === pot.value.id)
      before = await books(ctx, [a])
      const out = await bff(ctx, 'POST', `/api/agents/${a.agent}/pots/${pot.value.id}/out`, { amount_ulxc: amount })
      ctx.evidence.push({ note: `taken out while locked: ${said(out)}` })
      if (out.ok) return fail(`the pot is locked until ${until0}, yet ${amount} µLXC came out: ${said(out)}`)
      const held = await potOf()
      if (held?.balance_ulxc !== amount) return fail(`locked, the pot should still hold ${amount} µLXC: ${JSON.stringify(held)}`)
      wrong = await movedBy(ctx, [a], before, [0], 'taken out of a locked pot')
      if (wrong !== undefined) return fail(wrong)
      await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(lockedUntil) - Date.now()) + 2_000))
      const out2 = await bff(ctx, 'POST', `/api/agents/${a.agent}/pots/${pot.value.id}/out`, { amount_ulxc: amount })
      if (!out2.ok) return fail(`the lock past, taking ${amount} µLXC out was refused: ${out2.status} ${out2.error}`)
      const empty = await potOf()
      if (empty?.balance_ulxc !== 0) return fail(`the lock past and emptied, the pot holds ${JSON.stringify(empty)}`)
      return { pass: true, detail: `two recurring transfers, made and stopped in the app and on Lens, read inactive with no run, nothing moved; a top-up filled an empty agent to ${lxcText(to)} LXC on the tick, one posting, from the workspace's free credits, then removed; a locked pot refused to give back or be unlocked early and moved nothing, its lock past it did` }
    },
  }
}

// ─── an approval denied, its challenge, push, rule templates and boosts ──────

/** 65 bytes of a P-256 public key and 16 of auth, base64url: a subscription as a browser's push service would make it. */
function pushKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }
}

/**
 * A send above the approval amount waits for a person; its passkey challenge is asked in the app, and denied there it
 * moves nothing on either side. A rule template applied on Lens is the agent's rules whole; a limit boosted in the app
 * and ended there before its time is gone from Lens. A device subscribed to approval pushes in the app, and removed.
 */
export function agentApprovalDenied(seed: number, partner: number): Scenario {
  const above = 1_000_000
  const amount = 1_500_000
  return {
    id: 'agent-approval-denied',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "a send above the approval amount waits; its challenge asked and denied in the app, nothing moves on either side; a rule template applied on Lens, a boost ended in the app, a push device added and removed",
    run: async (ctx) => {
      const { env } = ctx
      const a = await appAgent(ctx, `Approver ${seed}`, 3e6)
      if (typeof a === 'string') return fail(a)
      const b = await otherSide(ctx, partner, `Approval payee ${seed}`, 0)
      const sides = [a, b]
      const rules = await env.lens.agentRules(a.user, a.agent)
      const put = await env.lens.act(a.user, 'PUT', `/v1/workspaces/{ws}/agents/${a.agent}/rules`, { ...rules, approval_above_ulxc: above })
      if (!put.ok) return fail(`setting the approval amount to ${above} µLXC was refused: ${put.status} ${put.error}`)
      const before = await books(ctx, sides)
      const send = await bff<{ approval_id?: string }>(ctx, 'POST', `/api/agents/${a.agent}/send`, { to: b.agent, amount_ulxc: amount, memo: memoOf('needs a person', seed) })
      ctx.evidence.push({ note: `a send of ${amount} µLXC above ${above}: ${said(send)}` })
      const approval = (await env.lens.agentApprovals(a.user)).find((x) => x.agent_id === a.agent && x.amount_ulxc === amount && x.status === 'pending')
      if (approval === undefined) return fail(`a send above the approval amount filed no pending approval: ${said(send)}`)
      const ch = await bff<{ challenge: string; allow_credentials: string[] }>(ctx, 'POST', `/api/agents/approvals/${approval.id}/challenge`)
      ctx.evidence.push({ note: `its challenge in the app: ${said(ch)}` })
      if (!ch.ok || ch.value.challenge === '') return fail(`asking the approval's passkey challenge in the app: ${said(ch)}`)
      const denied = await bff<{ status: string }>(ctx, 'POST', `/api/agents/approvals/${approval.id}/deny`, {})
      ctx.evidence.push({ note: `denied in the app: ${said(denied)}` })
      if (!denied.ok) return fail(`denying in the app was refused: ${denied.status} ${denied.error}`)
      const after = (await env.lens.agentApprovals(a.user)).find((x) => x.id === approval.id)
      if (after?.status !== 'denied') return fail(`denied in the app, Lens holds the approval ${after?.status ?? 'missing'}`)
      const wrong = await movedBy(ctx, sides, before, [0, 0], 'an approval denied')
      if (wrong !== undefined) return fail(wrong)

      // A rule template, applied on Lens.
      const templates = await env.lens.act<{ templates?: { id: string; rules: Record<string, unknown> }[] }>(a.user, 'GET', '/v1/workspaces/{ws}/agents/rule-templates')
      const tpl = templates.ok ? templates.value.templates?.[0] : undefined
      if (tpl === undefined) return fail(`Lens lists no rule template: ${said(templates)}`)
      const applied = await env.lens.act(a.user, 'POST', `/v1/workspaces/{ws}/agents/${a.agent}/rules/template`, { template: tpl.id })
      ctx.evidence.push({ note: `template ${tpl.id} applied on Lens: ${said(applied)}` })
      if (!applied.ok) return fail(`applying template ${tpl.id} on Lens was refused: ${applied.status} ${applied.error}`)
      const history = await env.lens.agentRulesHistory(a.user, a.agent)
      if (!history[0]?.change.includes(tpl.id)) return fail(`applied on Lens, the rules' newest version reads "${history[0]?.change}", not template ${tpl.id}`)
      // A boost, ended in the app before its time.
      const now = await env.lens.agentRules(a.user, a.agent)
      const rule = now.daily_limit_ulxc > 0 ? 'daily_limit_ulxc' : now.monthly_limit_ulxc > 0 ? 'monthly_limit_ulxc' : now.max_per_request_ulxc > 0 ? 'max_per_request_ulxc' : ''
      if (rule === '') return fail(`template ${tpl.id} sets no limit to boost: ${JSON.stringify(now)}`)
      const value = (now as unknown as Record<string, number>)[rule] * 2
      const boost = await bff(ctx, 'POST', `/api/agents/${a.agent}/rules/boosts`, { rule, value, until: new Date(Date.now() + 3600e3).toISOString() })
      if (!boost.ok) return fail(`boosting ${rule} to ${value} in the app was refused: ${boost.status} ${boost.error}`)
      if (!(await env.lens.agentBoosts(a.user, a.agent)).some((x) => x.rule === rule && x.value === value)) return fail(`boosted in the app, Lens lists no boost of ${rule} to ${value}`)
      const end = await bff(ctx, 'DELETE', `/api/agents/${a.agent}/rules/boosts/${rule}`)
      ctx.evidence.push({ note: `boost of ${rule} ended in the app: ${said(end)}` })
      if (!end.ok) return fail(`ending the boost in the app was refused: ${end.status} ${end.error}`)
      const left = await env.lens.agentBoosts(a.user, a.agent)
      if (left.some((x) => x.rule === rule)) return fail(`ended in the app, Lens still lists ${JSON.stringify(left)}`)

      // A device for approval pushes, added and removed.
      const pub = await bff<{ public_key: string }>(ctx, 'GET', '/api/agents/push/public-key')
      ctx.evidence.push({ note: `the push public key in the app: ${said(pub)}` })
      const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${RUN_SALT}-${seed}`
      const sub = await bff<{ endpoint: string }>(ctx, 'POST', '/api/agents/push/subscriptions', { endpoint, keys: pushKeys() })
      ctx.evidence.push({ note: `a device subscribed in the app: ${said(sub)}` })
      if (pub.ok) {
        if (!sub.ok || sub.value.endpoint !== endpoint) return fail(`Lens offers pushes (its key ${pub.value.public_key.slice(0, 12)}…), yet subscribing a device was ${said(sub)}`)
      } else if (sub.ok || sub.status !== 404) {
        return fail(`Lens has no push key (${pub.status} ${pub.error}), so a subscription must be refused as not configured: ${said(sub)}`)
      }
      const unsub = await bff<{ deleted?: boolean }>(ctx, 'DELETE', '/api/agents/push/subscriptions', { endpoint })
      ctx.evidence.push({ note: `the device removed in the app: ${said(unsub)}` })
      if (pub.ok && (!unsub.ok || unsub.value.deleted !== true)) return fail(`removing the device in the app: ${said(unsub)}`)
      return { pass: true, detail: `a ${lxcText(amount)} LXC send above ${lxcText(above)} waited; its challenge asked and denied in the app, nothing moved on either side; template ${tpl.id} applied on Lens; a ${rule} boost ended in the app; ${pub.ok ? 'a push device added and removed' : 'pushes are not configured on Lens, and a device is refused so'}` }
    },
  }
}

// ─── an agent's card, frozen and unfrozen in the app ─────────────────────────

/**
 * An agent's test card frozen in the app: Lens holds it frozen, a purchase on it is declined and nothing leaves the agent.
 * Unfrozen in the app: Lens holds it unfrozen, and the next purchase is approved for exactly what Lens says it cost, one
 * posting on the agent's account. Unfreezing is asked even when freezing was refused, so both routes are reached.
 */
export function walletCardFreeze(seed: number): Scenario {
  const funded = 20e6
  const pence = 40
  return {
    id: 'wallet-card-freeze',
    owner: 'talyvor-lens',
    agents: 1,
    title: "an agent's test card frozen in the app declines a purchase and nothing leaves the agent; unfrozen, the next purchase is approved, one posting of what it cost",
    run: async (ctx) => {
      const { env } = ctx
      const a = await appAgent(ctx, `Card freezer ${seed}`, funded)
      if (typeof a === 'string') return fail(a)
      const issued = await bff(ctx, 'POST', `/api/agents/${a.agent}/card`, { first_name: 'Test', last_name: 'Shopper', line1: '1 High Street', city: 'London', postal_code: 'EC1A 1BB', country: 'GB' })
      ctx.evidence.push({ note: `a test card issued in the app: ${said(issued)}` })
      if (!issued.ok) return fail(`issuing a test card in the app was refused: ${issued.status} ${issued.error}`)
      const frozen = await bff(ctx, 'POST', `/api/agents/${a.agent}/card/freeze`)
      ctx.evidence.push({ note: `frozen in the app: ${said(frozen)}` })
      if (!frozen.ok) {
        const unfrozen = await bff(ctx, 'POST', `/api/agents/${a.agent}/card/unfreeze`)
        ctx.evidence.push({ note: `unfrozen in the app: ${said(unfrozen)}` })
        return fail(`freezing the card in the app was refused (${frozen.status} ${frozen.error}); unfreezing it answered ${unfrozen.ok ? unfrozen.status : `${unfrozen.status} ${unfrozen.error}`} — Lens freezes a card from talyvor-lens B28.97`)
      }
      if ((await env.lens.agentCard(a.user, a.agent))?.frozen !== true) return fail('frozen in the app, Lens holds the card unfrozen')
      let before = await books(ctx, [a])
      const declined = await env.lens.cardPurchase(a.user, a.agent, { amount_minor: pence, currency: 'gbp', merchant: memoOf('Frozen shop', seed) })
      ctx.evidence.push({ note: `a £0.${pence} purchase on the frozen card: ${said(declined)}` })
      if (!declined.ok || declined.value.approved) return fail(`a purchase on the frozen card should be declined: ${said(declined)}`)
      let wrong = await movedBy(ctx, [a], before, [0], 'a purchase on the frozen card')
      if (wrong !== undefined) return fail(wrong)
      const unfrozen = await bff(ctx, 'POST', `/api/agents/${a.agent}/card/unfreeze`)
      ctx.evidence.push({ note: `unfrozen in the app: ${said(unfrozen)}` })
      if (!unfrozen.ok) return fail(`unfreezing the card in the app was refused: ${unfrozen.status} ${unfrozen.error}`)
      if ((await env.lens.agentCard(a.user, a.agent))?.frozen === true) return fail('unfrozen in the app, Lens still holds the card frozen')
      before = await books(ctx, [a])
      const bought = await env.lens.cardPurchase(a.user, a.agent, { amount_minor: pence, currency: 'gbp', merchant: memoOf('Open shop', seed) })
      ctx.evidence.push({ note: `the next £0.${pence} purchase: ${said(bought)}` })
      if (!bought.ok || !bought.value.approved || !(bought.value.amount_ulxc > 0)) return fail(`unfrozen, a purchase should be approved at a cost: ${said(bought)}`)
      wrong = await movedBy(ctx, [a], before, [-bought.value.amount_ulxc], 'a purchase on the unfrozen card')
      if (wrong !== undefined) return fail(wrong)
      return { pass: true, detail: `frozen in the app: Lens holds it frozen and a £0.${pence} purchase was declined, nothing moved; unfrozen: the next approved, one posting of ${lxcText(bought.value.amount_ulxc)} LXC` }
    },
  }
}

// ─── simulated trading ────────────────────────────────────────────────────────

interface SimOrder { id: string; status: string; side: string; type: string; quantity_micros: number; cash_uusd: number; fill_price_usd?: string }
interface Portfolio { id: string; agent_id: string; simulated: boolean; starting_cash_uusd: number; cash_uusd: number; positions: { instrument: string; quantity_micros: number }[] | null; orders: SimOrder[] | null }

/**
 * Investing, simulated until a broker partner exists: a portfolio opened in the app and read on Lens; a market buy fills
 * at the quote and its cash leaves the portfolio, a limit order far under the price stays open and is cancelled in the
 * app. No credits move: the agent's account has no new posting.
 */
export function walletTradingSim(seed: number): Scenario {
  const cash = 1_000_000_000
  const qty = 10_000_000
  return {
    id: 'wallet-trading-sim',
    owner: 'talyvor-lens',
    agents: 1,
    title: "a simulated portfolio opened in the app and read on Lens: a market buy fills and its cash leaves the portfolio; a limit order is cancelled; no credits move",
    run: async (ctx) => {
      const { env } = ctx
      const a = await appAgent(ctx, `Trader ${seed}`, 1e6)
      if (typeof a === 'string') return fail(a)
      const before = await books(ctx, [a])
      const opened = await bff<Portfolio>(ctx, 'POST', `/api/agents/${a.agent}/portfolios`, { name: memoOf('Nightly', seed), cash_uusd: cash })
      ctx.evidence.push({ note: `opened in the app: ${said(opened)}` })
      if (!opened.ok) return fail(`opening a simulated portfolio in the app was refused: ${opened.status} ${opened.error}`)
      const pf = opened.value.id
      const buy = await bff<SimOrder>(ctx, 'POST', `/api/agents/${a.agent}/portfolios/${pf}/orders`, { instrument: 'EUR', side: 'buy', type: 'market', quantity_micros: qty })
      ctx.evidence.push({ note: `a market buy of ${qty / 1e6} EUR: ${said(buy)}` })
      if (!buy.ok || buy.value.status !== 'filled' || buy.value.cash_uusd >= 0) return fail(`a market buy should fill and cost cash: ${said(buy)}`)
      const limit = await bff<SimOrder>(ctx, 'POST', `/api/agents/${a.agent}/portfolios/${pf}/orders`, { instrument: 'EUR', side: 'buy', type: 'limit', quantity_micros: qty, limit_price_usd: '0.0001' })
      if (!limit.ok || limit.value.status !== 'open') return fail(`a limit buy far under the price should stay open: ${said(limit)}`)
      const cancelled = await bff<SimOrder>(ctx, 'POST', `/api/agents/${a.agent}/portfolios/${pf}/orders/${limit.value.id}/cancel`)
      ctx.evidence.push({ note: `the limit order cancelled in the app: ${said(cancelled)}` })
      if (!cancelled.ok || cancelled.value.status !== 'cancelled') return fail(`cancelling the limit order in the app: ${said(cancelled)}`)
      const read = await env.lens.act<Portfolio>(a.user, 'GET', `/v1/workspaces/{ws}/agents/${a.agent}/portfolios/${pf}`)
      ctx.evidence.push({ note: `the portfolio on Lens: ${said(read)}` })
      if (!read.ok) return fail(`reading the portfolio on Lens was refused: ${read.status} ${read.error}`)
      const p = read.value
      const eur = (p.positions ?? []).find((x) => x.instrument === 'EUR')
      const orders = p.orders ?? []
      if (!p.simulated || p.cash_uusd !== cash + buy.value.cash_uusd || eur?.quantity_micros !== qty ||
        orders.find((o) => o.id === buy.value.id)?.status !== 'filled' || orders.find((o) => o.id === limit.value.id)?.status !== 'cancelled') {
        return fail(`on Lens the portfolio should be simulated with ${cash + buy.value.cash_uusd} µUSD cash, ${qty} µEUR, the buy filled and the limit cancelled: ${JSON.stringify(p)}`)
      }
      const wrong = await movedBy(ctx, [a], before, [0], 'trading in a simulated portfolio')
      if (wrong !== undefined) return fail(wrong)
      return { pass: true, detail: `opened with ${cash / 1e6} simulated dollars; ${qty / 1e6} EUR bought at ${buy.value.fill_price_usd} for ${-buy.value.cash_uusd} µUSD, a limit order cancelled, all read on Lens; no credits moved` }
    },
  }
}

// ─── LXC: conversion, bonds, a top-up's checkout ─────────────────────────────

/**
 * What the workspace's LXC can and cannot do yet. Converting LENS to LXC needs the LENS: below the minimum it is
 * refused, and above what the workspace earned it is refused, and neither the LXC nor the LENS ledger moves. Provenance
 * bonds are a feature Talyvor has switched off (LENS_H5_BONDS_ENABLED): staking one and reading one are refused, and
 * nothing moves. A top-up's checkout in the app hands the browser to Stripe, and nothing is credited until it is paid.
 */
export function lxcConvertBonds(): Scenario {
  return {
    id: 'lxc-convert-bonds',
    owner: 'talyvor-lens',
    title: "LENS converted to LXC beyond what was earned is refused and neither ledger moves; provenance bonds (switched off) are refused and move nothing; a top-up's checkout goes to Stripe and credits nothing",
    run: async (ctx): Promise<Verdict> => {
      const { env, app } = ctx
      const lxc0 = await env.lens.ledger(app.user)
      const lens0 = await env.lens.earningsRows(app.user)
      const earned = lens0.reduce((s, r) => s + r.amount_ulens, 0)
      const small = await env.lens.act(app.user, 'POST', '/v1/workspaces/{ws}/lxc/convert', { lxc_amount_ulxc: 1 })
      const big = await env.lens.act(app.user, 'POST', '/v1/workspaces/{ws}/lxc/convert', { lxc_amount_ulxc: Math.max(earned, 0) + 1_000_000 })
      ctx.evidence.push({ note: `the workspace has earned ${earned} µLENS; converting 1 µLXC: ${said(small)}; converting ${Math.max(earned, 0) + 1_000_000} µLXC: ${said(big)}` })
      if (small.ok || small.status !== 400) return fail(`converting 1 µLXC, under the minimum, should be refused 400: ${said(small)}`)
      if (big.ok || big.status !== 402) return fail(`converting more LXC than the workspace's ${earned} µLENS pays for should be refused 402: ${said(big)}`)

      const output = `e2e-${RUN_SALT}-not-mine`
      const stake = await env.lens.act(app.user, 'POST', '/v1/bonds', { output_id: output, amount_ulens: 1_000 })
      const one = await env.lens.act(app.user, 'GET', `/v1/bonds/${output}`)
      ctx.evidence.push({ note: `a provenance bond staked: ${said(stake)}; read: ${said(one)}` })
      // Switched off, Lens never registers the routes (404); switched on, a bond on an output the workspace did not
      // produce is refused (403) and one it never staked is not found (404). Either way nothing is staked.
      if (stake.ok || (stake.status !== 404 && stake.status !== 403)) return fail(`a bond on an output this workspace did not produce must be refused: ${said(stake)}`)
      if (one.ok || one.status !== 404) return fail(`a bond nobody staked must not be found: ${said(one)}`)

      const checkout = await bff<{ url?: string }>(ctx, 'POST', '/api/lxc/checkout', { usd_cents: 1000 })
      ctx.evidence.push({ note: `a $10 top-up's checkout in the app: ${said(checkout)}` })
      if (!checkout.ok || !/^https:\/\/checkout\.stripe\.com\//.test(checkout.value.url ?? '')) return fail(`a $10 top-up's checkout should hand the browser to Stripe: ${said(checkout)}`)

      const lxc1 = await env.lens.ledger(app.user)
      const lens1 = await env.lens.earningsRows(app.user)
      const newLXC = lxc1.filter((r) => !lxc0.some((o) => o.id === r.id))
      const newLENS = lens1.filter((r) => !lens0.some((o) => o.id === r.id))
      ctx.evidence.push({ note: `new LXC rows: ${JSON.stringify(newLXC)}; new LENS rows: ${JSON.stringify(newLENS)}` })
      if (newLXC.length > 0 || newLENS.length > 0) return fail(`refused conversions, refused bonds and an unpaid checkout moved the ledgers: ${newLXC.length} LXC row(s) and ${newLENS.length} LENS row(s)`)
      return { pass: true, detail: `converting under the minimum (400) and beyond the ${earned} µLENS earned (402) refused; bonds ${stake.status === 404 ? 'switched off (404)' : 'refused on an output not produced here'}; the checkout went to Stripe; neither ledger moved` }
    },
  }
}

// ─── the marketplace: versions, offers, remix, lineage, licences ─────────────

interface Offer { id?: string; kind: string; licence: string; price_usd_micros: number; period_days?: number; included_uses?: number }
interface Licence { id: string; listing_id: string; kind: string; status: string; auto_renew: boolean; use_id: string; price_ulxc: number; ends_at: string | null }
interface Lineage { listing_id: string; ancestors: { listing_id: string; version: number; share_bps: number }[] | null; descendants: number }

/**
 * The person's company sells; the other company builds on it and subscribes. Both on Lens, as each company's software
 * would: a listing published, given a second version, sold by subscription and opened to royalty remixes; the other
 * company remixes version 2 (its grant holds the share), publishes its remix with it as a parent, and the lineage on
 * both sides names that edge at the share. It subscribes: one line on its bill, one pending sale for the seller; it
 * cancels: the licence stops renewing and runs to its end.
 */
export function marketRemixLicence(seed: number, partner: number): Scenario {
  const share = 1000
  const price = 200_000
  return {
    id: 'market-remix-licence',
    owner: 'talyvor-lens',
    partners: [partner],
    title: "a listing's second version, its subscription offer and its royalty remix terms set on Lens; another company remixes it, and the lineage names the edge at the share; it subscribes, one line on its bill and one pending sale; cancelled, it stops renewing",
    run: async (ctx) => {
      const { env, app } = ctx
      const b = ctx.env.userAt(partner)
      const model = env.catalog.find((m) => m.display_name === app.modelNameInUse)?.id
      if (model === undefined) throw new Error(`the catalog has no model named "${app.modelNameInUse}"`)
      const pub = await env.lens.publishListing(app.user, { title: `Remixable ${seed}-${RUN_SALT}`, template: 'Summarise in one line: {{text}}', priceULXC: 1000, model })
      ctx.evidence.push({ note: `published on Lens: ${said(pub)}` })
      if (!pub.ok) return fail(`publishing on Lens was refused: ${pub.status} ${pub.error}`)
      const id = pub.value.id
      const v2 = await env.lens.act<{ version: number }>(app.user, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${id}/versions`,
        { artifact: { template: 'Summarise in one short line: {{text}}', model }, changelog: 'shorter' })
      ctx.evidence.push({ note: `a second version: ${said(v2)}` })
      if (!v2.ok || v2.value.version !== 2) return fail(`publishing version 2 on Lens: ${said(v2)}`)
      const offers = await env.lens.act<{ offers: Offer[] }>(app.user, 'PUT', `/v1/workspaces/{ws}/marketplace/listings/${id}/offers`,
        { offers: [{ kind: 'per_use', licence: 'commercial', price_usd_micros: 100 }, { kind: 'subscribe', licence: 'commercial', price_usd_micros: price, period_days: 30, included_uses: 0 }] })
      ctx.evidence.push({ note: `its offers: ${said(offers)}` })
      const sub = offers.ok ? offers.value.offers.find((o) => o.kind === 'subscribe') : undefined
      if (sub?.id === undefined) return fail(`setting a subscription offer on Lens: ${said(offers)}`)
      const terms = await env.lens.act<{ remix_policy: string; remix_share_bps: number }>(app.user, 'PUT', `/v1/workspaces/{ws}/marketplace/listings/${id}/remix-terms`,
        { remix_policy: 'royalty', remix_share_bps: share })
      if (!terms.ok || terms.value.remix_policy !== 'royalty' || terms.value.remix_share_bps !== share) return fail(`setting royalty remix terms at ${share} bps: ${said(terms)}`)

      const remix = await env.lens.act<{ version: number; grant?: { share_bps: number }; artifact: unknown }>(b, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${id}/remix`, { version: 2 })
      ctx.evidence.push({ note: `the other company remixes version 2: ${said(remix)}` })
      if (!remix.ok || remix.value.grant?.share_bps !== share || remix.value.artifact === null) return fail(`remixing version 2 should open its artifact under a grant at ${share} bps: ${said(remix)}`)
      const child = await env.lens.act<{ id: string }>(b, 'POST', '/v1/workspaces/{ws}/marketplace/listings', {
        kind: 'prompt', title: `Remix of ${seed}-${RUN_SALT}`, description: '', price_per_use_ulxc: 1000, visibility: 'public',
        artifact: { template: 'Summarise in one short line, in French: {{text}}', model }, changelog: '', parents: [{ listing_id: id, version: 2 }] })
      if (!child.ok) return fail(`publishing the remix with its parent was refused: ${child.status} ${child.error}`)
      const up = await env.lens.act<Lineage>(b, 'GET', `/v1/marketplace/listings/${child.value.id}/lineage`)
      const down = await env.lens.act<Lineage>(app.user, 'GET', `/v1/marketplace/listings/${id}/lineage`)
      ctx.evidence.push({ note: `the remix's lineage: ${said(up)}; the original's: ${said(down)}` })
      const edge = up.ok ? (up.value.ancestors ?? []).find((x) => x.listing_id === id) : undefined
      if (edge?.version !== 2 || edge.share_bps !== share) return fail(`the remix's lineage should name ${id} version 2 at ${share} bps: ${said(up)}`)
      if (!down.ok || down.value.descendants < 1) return fail(`the original's lineage should count its remix: ${said(down)}`)

      const bill0 = await env.lens.marketBill(b)
      const earn0 = await env.lens.marketEarnings(app.user)
      const lic = await env.lens.act<Licence>(b, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${id}/licences`, { offer_id: sub.id, version: 0 },
        { 'Idempotency-Key': randomUUID() })
      ctx.evidence.push({ note: `the other company subscribes: ${said(lic)}` })
      if (!lic.ok || lic.value.kind !== 'subscribe' || !lic.value.auto_renew) return fail(`subscribing on Lens: ${said(lic)}`)
      const bill1 = await env.lens.marketBill(b)
      const lines = (bill1.lines ?? []).filter((l) => !(bill0.lines ?? []).some((o) => o.use_id === l.use_id))
      ctx.evidence.push({ note: `new lines on the subscriber's bill: ${JSON.stringify(lines)}` })
      if (lines.length !== 1 || lines[0].use_id !== lic.value.use_id || lines[0].price_ulxc !== lic.value.price_ulxc) {
        return fail(`a subscription is one line of ${lic.value.price_ulxc} µLXC on the subscriber's bill; it has ${JSON.stringify(lines)}`)
      }
      const earn1 = await until(() => env.lens.marketEarnings(app.user), (e) => e.pending_uses > earn0.pending_uses, SALE_METERED_MS)
      ctx.evidence.push({ note: `the seller's pending: ${earn0.pending_uses} use(s), ${earn0.pending_usd_micros} µUSD → ${earn1.pending_uses}, ${earn1.pending_usd_micros}` })
      if (earn1.pending_uses !== earn0.pending_uses + 1) return fail(`the seller should have one more pending sale: ${earn0.pending_uses} → ${earn1.pending_uses}`)
      const cancelled = await env.lens.act<Licence>(b, 'POST', `/v1/workspaces/{ws}/marketplace/licences/${lic.value.id}/cancel`)
      ctx.evidence.push({ note: `cancelled: ${said(cancelled)}` })
      if (!cancelled.ok || cancelled.value.auto_renew || cancelled.value.ends_at === null) return fail(`cancelled, the subscription should stop renewing and run to its end: ${said(cancelled)}`)
      const bill2 = await env.lens.marketBill(b)
      if ((bill2.lines ?? []).length !== (bill1.lines ?? []).length) return fail(`cancelling put ${(bill2.lines ?? []).length - (bill1.lines ?? []).length} more line(s) on the bill`)
      return { pass: true, detail: `version 2, a ${price} µUSD subscription and ${share} bps royalty remixes set on Lens; remixed under a ${share} bps grant, the remix's lineage names version 2 at ${share} bps; subscribed: one bill line, one pending sale; cancelled: runs to its end, no new line` }
    },
  }
}
