// B28.290 — money between two companies stays test money. Two test companies (B25.4's pair) move money three ways:
// the person's agent sends the other company's agent credits in the app, the other company lends it credits on Lens
// and the person accepts in the app, and the person cashes the borrowed credits out in the app. Every oracle is what
// Lens stored, read back from both sides, as Lens's own tests read test money: a transfer to another owner is AMBER
// or RED, never GREEN, and test-funded to the last µLXC; the cash-out is too, and paid by the test partner; each LXC
// ledger row they wrote names its transfer or cash-out and the same class; and no row either workspace's ledger
// gained meanwhile is funded "live" — real money.

import type { AgentTransfer, CashOut, LedgerRow, Loan } from './lens.ts'
import { fail, lxcText } from './bank.ts'
import { appAgent, bff, memoOf, otherSide, said } from './routes.ts'
import { until } from './trade.ts'
import type { Scenario } from './scenarios.ts'

/** What the scenario moved between the two companies and what Lens read back afterwards, the person's side first. */
export interface CrossCompanyMoney {
  /** The person's agent and the other company's. */
  agents: readonly [string, string]
  /** The transfers between the two agents, as each side reads them. */
  transfers: readonly [AgentTransfer[], AgentTransfer[]]
  sent: { id: string; amount: number }
  loan: { id: string; principal: number }
  /** The person's cash-out, as Lens reads it last, and what it asked to cash out. */
  cashOut: CashOut | undefined
  cashOutAmount: number
  /** The rows each workspace's LXC ledger gained while the scenario ran. */
  fresh: readonly [LedgerRow[], LedgerRow[]]
}

const WHO = ["the person's", "the other company's"] as const

/** The oracle: every move between the two companies is test money in its class on both ledgers, and no row is real money. */
export function testMoneyVerdict(m: CrossCompanyMoney): { pass: boolean; detail: string } {
  const wrong: string[] = []
  /** The one transfer both sides read for `what`, from side `from` to the other, of `amount`; undefined, and why, when not. */
  const pick = (what: string, match: (t: AgentTransfer) => boolean, from: 0 | 1, amount: number): AgentTransfer | undefined => {
    const [x, y] = m.transfers.map((ts) => ts.filter(match))
    if (x.length !== 1 || y.length !== 1 || x[0].id !== y[0].id) {
      wrong.push(`${what}: the person's side reads ${x.length} transfer(s) and the other company's ${y.length}, not one and the same`)
      return undefined
    }
    const t = x[0]
    if (t.from_agent_id !== m.agents[from] || t.to_agent_id !== m.agents[1 - from] || t.amount_ulxc !== amount) {
      wrong.push(`${what} should move ${amount} µLXC from ${WHO[from]} agent to ${WHO[1 - from]}: ${JSON.stringify(t)}`)
      return undefined
    }
    return t
  }
  const moves = [
    ['the send', pick('the send', (t) => t.id === m.sent.id, 0, m.sent.amount)],
    ["the loan's principal", pick("the loan's principal", (t) => t.loan_id === m.loan.id, 1, m.loan.principal)],
  ] as const
  for (const [what, t] of moves) {
    if (t === undefined) continue
    if (t.class !== 'AMBER' && t.class !== 'RED') wrong.push(`${what} is class ${t.class ?? 'none'}: money to another owner is AMBER or RED, test money until cleared`)
    if (t.test_funded_ulxc !== t.amount_ulxc) wrong.push(`${what} moved ${t.amount_ulxc} µLXC of which ${t.test_funded_ulxc ?? 'none'} is test money: the rest reads as real money`)
    const from = t.from_agent_id === m.agents[0] ? 0 : 1
    for (const [side, sign] of [[from, -1], [1 - from, 1]] as const) {
      const rows = m.fresh[side].filter((r) => r.metadata?.transfer_id === t.id)
      if (rows.length !== 1 || rows[0].amount_ulxc !== sign * t.amount_ulxc) {
        wrong.push(`${what}: ${WHO[side]} ledger has ${rows.map((r) => `${r.amount_ulxc} µLXC`).join(', ') || 'no row'} naming it, not one row of ${sign * t.amount_ulxc} µLXC`)
      } else if (rows[0].metadata?.class !== t.class) {
        wrong.push(`${what}: ${WHO[side]} ledger row names class ${String(rows[0].metadata?.class)}, not the transfer's ${t.class}`)
      }
    }
  }
  const c = m.cashOut
  if (c === undefined) wrong.push('the cash-out is not on Lens')
  else {
    if (c.amount_ulxc !== m.cashOutAmount) wrong.push(`the cash-out is of ${c.amount_ulxc} µLXC, not the ${m.cashOutAmount} asked`)
    if (c.partner !== 'test') wrong.push(`the cash-out went to the ${c.partner} partner, not the test partner: real money left`)
    if (c.status !== 'paid') wrong.push(`the cash-out is ${c.status}${c.detail ? ` (${c.detail})` : ''}, not paid by the test partner`)
    if (c.test_funded_ulxc !== c.amount_ulxc) wrong.push(`the cash-out paid ${c.amount_ulxc} µLXC out, of which ${c.test_funded_ulxc ?? 'none'} is test money: the rest reads as real money`)
    const rows = m.fresh[0].filter((r) => r.metadata?.cash_out_id === c.id)
    if (rows.length !== 1 || rows[0].amount_ulxc !== -c.amount_ulxc) {
      wrong.push(`the cash-out: the person's ledger has ${rows.map((r) => `${r.amount_ulxc} µLXC`).join(', ') || 'no row'} naming it, not one row of ${-c.amount_ulxc} µLXC`)
    } else if (rows[0].metadata?.class !== 'RED' || rows[0].metadata?.partner !== 'test') {
      wrong.push(`the cash-out's ledger row names class ${String(rows[0].metadata?.class)} and partner ${String(rows[0].metadata?.partner)}, not RED and test`)
    }
  }
  const live = m.fresh.flatMap((rows, i) => rows.filter((r) => r.metadata?.funding === 'live').map((r) => `${WHO[i]} ${r.type} ${r.amount_ulxc} µLXC "${r.description}"`))
  if (live.length > 0) wrong.push(`${live.length} ledger row(s) written meanwhile are real money (funding live): ${live.slice(0, 5).join('; ')}`)
  if (wrong.length > 0) return { pass: false, detail: wrong.join('; ') }
  const rows = m.fresh[0].length + m.fresh[1].length
  return { pass: true, detail: `a ${lxcText(m.sent.amount)} LXC send and a ${lxcText(m.loan.principal)} LXC loan between the two companies: each ${moves.map(([, t]) => t?.class).join(' and ')}, test money to the last µLXC, ` +
    `its row on both ledgers naming its class; ${lxcText(m.cashOutAmount)} LXC cashed out by the test partner, test money, its row RED; none of the ${rows} rows the two ledgers gained is real money` }
}

export function crossCompanyTestMoney(seed: number, partner: number): Scenario {
  const sent = 400_000
  const principal = 600_000
  const terms = { principal_ulxc: principal, interest_bps: 0, instalments: 1, every: 'week', late_fee_ulxc: 0 }
  return {
    id: 'cross-company-test-money',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "money between two companies stays test money: a transfer, a loan's principal and its cash-out are each test money to the last µLXC, in their class on both ledgers, and no row is real money",
    run: async (ctx) => {
      const { env } = ctx
      const a = await appAgent(ctx, `Test money ${seed}`, 2e6)
      if (typeof a === 'string') return fail(a)
      const b = await otherSide(ctx, partner, `Test money ${seed}`, 2e6)
      const before = await Promise.all([a, b].map(async (s) => new Set((await env.lens.ledger(s.user)).map((r) => r.id))))

      const send = await bff<AgentTransfer>(ctx, 'POST', `/api/agents/${a.agent}/send`, { to: b.agent, amount_ulxc: sent, memo: memoOf('test money', seed) })
      ctx.evidence.push({ note: `sent in the app: ${said(send)}` })
      if (!send.ok) return fail(`sending ${lxcText(sent)} LXC to the other company's agent was refused: ${send.status} ${send.error}`)
      const offer = await env.lens.act<Loan>(b.user, 'POST', `/v1/workspaces/{ws}/agents/${b.agent}/loans`, { to: a.agent, ...terms, memo: memoOf('test loan', seed) })
      ctx.evidence.push({ note: `the other company offers a loan on Lens: ${said(offer)}` })
      if (!offer.ok) return fail(`the other company's loan offer was refused: ${offer.status} ${offer.error}`)
      const accepted = await bff<Loan>(ctx, 'POST', `/api/wallets/loans/${offer.value.id}/accept`)
      ctx.evidence.push({ note: `accepted in the app: ${said(accepted)}` })
      if (!accepted.ok) return fail(`accepting the loan in the app was refused: ${accepted.status} ${accepted.error}`)
      const asked = await bff<CashOut>(ctx, 'POST', `/api/agents/${a.agent}/cash-outs`, { amount_ulxc: principal, destination: `Test Bank ${seed}` })
      ctx.evidence.push({ note: `cashed out in the app: ${said(asked)}` })
      if (!asked.ok) return fail(`cashing ${lxcText(principal)} LXC out in the app was refused: ${asked.status} ${asked.error}`)
      const cashOut = await until(async () => (await env.lens.cashOuts(a.user)).find((c) => c.id === asked.value.id), (c) => c?.status === 'paid' || c?.status === 'failed')

      const pair = [a.agent, b.agent].sort().join()
      const between = (ts: AgentTransfer[]) => ts.filter((t) => [t.from_agent_id, t.to_agent_id].sort().join() === pair)
      const transfers: [AgentTransfer[], AgentTransfer[]] = [between(await env.lens.transfers(a.user, a.agent)), between(await env.lens.transfers(b.user, b.agent))]
      const [mine, theirs] = await Promise.all([a, b].map((s, i) => env.lens.ledger(s.user).then((rows) => rows.filter((r) => !before[i].has(r.id)))))
      ctx.evidence.push({ note: `on Lens: the transfers between the two agents ${JSON.stringify(transfers[0])} (the other company reads ${transfers[1].map((t) => t.id).join(', ') || 'none'}); the cash-out ${JSON.stringify(cashOut)}` })
      ctx.evidence.push({ note: `the rows the two ledgers gained: ${[mine, theirs].map((rows, i) => `${WHO[i]} ${rows.map((r) => `${r.type} ${r.amount_ulxc} ${JSON.stringify(r.metadata ?? {})}`).join(', ') || 'none'}`).join('; ')}` })
      return testMoneyVerdict({ agents: [a.agent, b.agent], transfers, sent: { id: send.value.id, amount: sent }, loan: { id: offer.value.id, principal },
        cashOut, cashOutAmount: principal, fresh: [mine, theirs] })
    },
  }
}
