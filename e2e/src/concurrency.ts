// B28.279 — THE LEDGER HOLDS UNDER CONCURRENCY. Money that moves at once, money sent again under one Idempotency-Key and
// an answer the agent hangs up on while it is being served must each land exactly once. Two scenarios, each on a
// workspace of its own so nothing else moves its money while it counts:
//   ledger-moves-at-once — an agent funded and withdrawn from many times at once, one funding and one withdrawal each sent
//     several times at once under one key and once more after: the moves that landed add up to what Lens stores, its
//     postings and its statement, each replayed key wrote one posting, every entry sums to zero, and the workspace's own
//     balance never moved.
//   ledger-call-once — an agent's request sent twice at once and once after under one Idempotency-Key, and a streamed
//     answer the agent hangs up on once it starts to arrive: each is one charge on the agent's statement and one spend row
//     on the workspace's ledger debiting the same, and the agent ends holding what it was funded less exactly those.

import { randomUUID } from 'node:crypto'
import { fail, lxcText } from './bank.ts'
import { worstInputTokens } from './budget.ts'
import { chargeOf, complete } from './code.ts'
import type { AgentBook, AgentLine, Answered, JudgeReply } from './lens.ts'
import { RUN_SALT, listPriceUSD, statesNumber } from './oracles.ts'
import { within } from './pricing.ts'
import type { Scenario, ScenarioCtx } from './scenarios.ts'

/** What the agent starts with: more than every withdrawal together, so no order the moves land in can refuse one. */
const SEED_ULXC = 500_000
/** Fundings sent at once, and as many withdrawals beside them. */
const MOVES = 20
/** How many copies of the one keyed funding, and of the one keyed withdrawal, are sent at once. */
const REPLAYS = 4
/** The keyed funding's and withdrawal's amounts: no other move is either, so a second posting of one cannot hide. */
const REPLAYED_FUND = 3_001
const REPLAYED_WITHDRAW = 3_002

/** The call scenario's agent: funded once, then charged only by the two requests it judges. */
const CALL_FUND_ULXC = 1_000_000
const REPLY_MAX_TOKENS = 16
/** Enough for "1 2 … 60", so the answer is still arriving when the agent hangs up. */
const STREAM_MAX_TOKENS = 200
/** B35.8 — a charge not on the statement within 90 s is the FAIL. */
const CHARGED_WITHIN_MS = 90_000
/** After the first charge is complete, how long a second one for the same request is given to land. */
const SETTLE_GRACE_MS = 5_000

interface StatementRead {
  accounts: { account: string; closing_ulxc: number }[] | null
  lines: { entry_id: string; account: string; kind: string; amount_ulxc: number }[] | null
}

type Kind = 'fund' | 'withdraw'
interface Move { kind: Kind; amount: number; key: string }

/** One move between the workspace and the agent, under its key, as the owner's software sends it. */
function send(ctx: ScenarioCtx, agentID: string, m: Move): Promise<Answered<{ balance_ulxc: number }>> {
  return ctx.env.lens.act(ctx.app.user, 'POST', `/v1/workspaces/{ws}/agents/${agentID}/${m.kind}`, { amount_ulxc: m.amount }, { 'Idempotency-Key': m.key })
}

const signed = (m: Move): number => (m.kind === 'fund' ? m.amount : -m.amount)

export function ledgerMovesAtOnce(): Scenario {
  return {
    id: 'ledger-moves-at-once',
    owner: 'talyvor-lens',
    own: true,
    plan: 'team',
    agents: 1,
    feature: 'Agent Wallets',
    title: `an agent funded ${MOVES} times and withdrawn from ${MOVES} times at once, with one funding and one withdrawal each sent ${REPLAYS} times at once ` +
      'under one Idempotency-Key and once more after, holds exactly what the moves add up to: its stored balance, its postings and its statement agree, ' +
      "each replayed key wrote one posting, every entry sums to zero, and the workspace's own balance never moved",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const before = await lens.agentBook(user)
      const agent = await lens.createAgent(user, `Ledger ${RUN_SALT}`)
      const seeded = await send(ctx, agent.id, { kind: 'fund', amount: SEED_ULXC, key: randomUUID() })
      if (!seeded.ok) return fail(`funding ${agent.name} ${lxcText(SEED_ULXC)} LXC was refused: ${seeded.status} ${seeded.error}`)

      const once: Move[] = Array.from({ length: MOVES }, (_, k) => [
        { kind: 'fund' as const, amount: 1_000 + k, key: randomUUID() },
        { kind: 'withdraw' as const, amount: 2_000 + k, key: randomUUID() },
      ]).flat()
      const keyed: Move[] = [{ kind: 'fund', amount: REPLAYED_FUND, key: randomUUID() }, { kind: 'withdraw', amount: REPLAYED_WITHDRAW, key: randomUUID() }]
      const all = [...once, ...keyed.flatMap((m) => Array.from({ length: REPLAYS }, () => m))]
      const answers = await Promise.all(all.map((m) => send(ctx, agent.id, m)))
      // Sent again once everything has landed, as an app does when the first answer was lost.
      const late = await Promise.all(keyed.map((m) => send(ctx, agent.id, m)))
      const refused = [...all, ...keyed].flatMap((m, i) => {
        const a = i < all.length ? answers[i] : late[i - all.length]
        return a.ok ? [] : [`${m.kind} ${m.amount} µLXC: ${a.status} ${a.error}`]
      })
      ctx.evidence.push({ note: `${all.length + late.length} moves sent, ${all.length} of them at once; ${refused.length} refused` })
      if (refused.length > 0) return fail(`Lens refused ${refused.length} of the moves sent at once: ${refused.slice(0, 3).join('; ')}`)

      const want = SEED_ULXC + [...once, ...keyed].reduce((s, m) => s + signed(m), 0)
      const after = await lens.agentBook(user)
      const st = await lens.act<StatementRead>(user, 'GET', '/v1/workspaces/{ws}/agents/statement?format=json')
      if (!st.ok) throw new Error(`reading the workspace's statement: ${st.status} ${st.error}`)
      const account = `agent:${agent.id}`
      const lines = st.value.lines ?? []
      const posted = lines.filter((l) => l.account === account)
      const summed = posted.reduce((s, l) => s + l.amount_ulxc, 0)
      const closing = (st.value.accounts ?? []).find((a) => a.account === account)?.closing_ulxc
      const held = after.agents.find((a) => a.id === agent.id)?.balance_ulxc
      ctx.evidence.push({ note: `the moves add up to ${want} µLXC; Lens stores ${held}; ${posted.length} postings sum to ${summed}; the statement closes at ${closing}` })
      ctx.evidence.push({ note: `book before: workspace ${before.workspace_balance_ulxc} = ${before.allocated_ulxc} + ${before.unallocated_ulxc}; ` +
        `after: ${after.workspace_balance_ulxc} = ${after.allocated_ulxc} + ${after.unallocated_ulxc}` })

      const wrong: string[] = []
      for (const m of keyed) {
        const n = posted.filter((l) => l.kind === m.kind && l.amount_ulxc === signed(m)).length
        if (n !== 1) wrong.push(`the ${m.kind} of ${m.amount} µLXC sent ${REPLAYS + 1} times under one Idempotency-Key wrote ${n} postings, not one`)
      }
      if (posted.length !== 1 + once.length + keyed.length) wrong.push(`${1 + once.length + keyed.length} moves landed and ${agent.name} has ${posted.length} postings`)
      if (held !== want) wrong.push(`the moves add up to ${want} µLXC and Lens stores ${agent.name} holding ${held}`)
      if (summed !== held || closing !== held) wrong.push(`Lens stores ${held} µLXC; ${agent.name}'s postings sum to ${summed} and its statement closes at ${closing}`)
      const entries = [...new Set(posted.map((l) => l.entry_id))]
      const lopsided = entries.filter((id) => lines.filter((l) => l.entry_id === id).reduce((s, l) => s + l.amount_ulxc, 0) !== 0)
      if (lopsided.length > 0) wrong.push(`${lopsided.length} of the moves' entries do not sum to zero: ${lopsided.slice(0, 3).join(', ')}`)
      wrong.push(...unmoved(before, after, want))
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: `${all.length} moves at once and ${late.length} after: ${agent.name} holds ${want} µLXC — stored, posted and on the statement; ` +
        `each key sent ${REPLAYS + 1} times wrote one posting; every entry sums to zero; the workspace's balance did not move` }
    },
  }
}

/** Moves inside the workspace leave its balance alone, and its agents hold exactly `toAgents` more. */
function unmoved(before: AgentBook, after: AgentBook, toAgents: number): string[] {
  const wrong: string[] = []
  if (after.workspace_balance_ulxc !== before.workspace_balance_ulxc) {
    wrong.push(`moves inside the workspace changed its balance: ${before.workspace_balance_ulxc} → ${after.workspace_balance_ulxc} µLXC`)
  }
  if (after.allocated_ulxc - before.allocated_ulxc !== toAgents) wrong.push(`its agents hold ${after.allocated_ulxc - before.allocated_ulxc} µLXC more, not ${toAgents}`)
  if (after.unallocated_ulxc !== after.workspace_balance_ulxc - after.allocated_ulxc) {
    wrong.push(`the book does not add up: ${after.workspace_balance_ulxc} ≠ ${after.allocated_ulxc} + ${after.unallocated_ulxc}`)
  }
  return wrong
}

/** The judge's model, which every request here asks: the cheapest the run uses. */
function modelOf(ctx: ScenarioCtx) {
  const model = ctx.env.catalog.find((m) => m.id === ctx.env.judgeModel)
  if (model === undefined) throw new Error(`the catalog has no model ${ctx.env.judgeModel}`)
  return model
}

/** One request on the agent's key, its worst case held against the cap until it answers. */
async function asked(ctx: ScenarioCtx, key: string, prompt: string, headers: Record<string, string>): Promise<Answered<JudgeReply>> {
  const { env } = ctx
  const model = modelOf(ctx)
  const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(prompt.length), REPLY_MAX_TOKENS))
  try {
    const r = await env.lens.askAsAgent(key, env.judgeProvider, model.id, prompt, REPLY_MAX_TOKENS, headers)
    env.cap.settle(hold, r.ok ? (r.value.replayed ? 0 : listPriceUSD(model, r.value.inputTokens, r.value.outputTokens)) : undefined)
    return r
  } catch (e) {
    env.cap.settle(hold, undefined)
    throw e
  }
}

/**
 * What one request left behind, from the agent's statement and the workspace's ledger as they were before it: one charge
 * on the statement and one spend row on the ledger debiting the same, or what is wrong.
 */
async function billedOnce(ctx: ScenarioCtx, agentID: string, lines0: AgentLine[], rows0: Set<string>, what: string): Promise<number | string> {
  const { lens } = ctx.env
  const user = ctx.app.user
  await within(() => lens.agentLines(user, agentID), (ls) => complete(lines0, ls), CHARGED_WITHIN_MS)
  await new Promise((r) => setTimeout(r, SETTLE_GRACE_MS))
  const lines = await lens.agentLines(user, agentID)
  const rows = (await lens.ledger(user)).filter((r) => !rows0.has(r.id))
  const seen = new Set(lines0.map((l) => l.entry_id))
  ctx.evidence.push({ note: `${what}: the agent's statement took ${lines.filter((l) => !seen.has(l.entry_id)).map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ') || 'nothing'}`,
    ledger: rows.map((r) => ({ type: r.type, amount_ulxc: r.amount_ulxc, created_at: r.created_at })) })
  const c = chargeOf(lines0, lines)
  if ('why' in c) return `${what}: ${c.why}`
  const spends = rows.filter((r) => r.type === 'spend').length
  if (spends !== 1) return `${what}: ${spends} spend rows on the workspace's ledger, not one`
  const debited = -rows.filter((r) => r.type === 'spend' || r.type === 'platform_fee').reduce((s, r) => s + r.amount_ulxc, 0)
  if (debited !== c.charged + c.fee) return `${what}: the agent was charged ${c.charged} µLXC and a ${c.fee} µLXC fee; the ledger's rows debit ${debited}`
  return c.charged + c.fee
}

export function ledgerCallOnce(): Scenario {
  return {
    id: 'ledger-call-once',
    owner: 'talyvor-lens',
    own: true,
    plan: 'team',
    agents: 1,
    feature: 'Agent Wallets',
    title: "an agent's request sent twice at once and once after under one Idempotency-Key is billed once, and a streamed answer the agent hangs up on " +
      "once it is being served is billed once: one charge on its statement and one spend row on the ledger each, and it holds what it was funded less exactly those",
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const agent = await lens.createAgent(user, `Billed once ${RUN_SALT}`)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'ledger-call-once' })
      if (!k.ok) return fail(`issuing ${agent.name} a key was refused: ${k.status} ${k.error}`)
      await lens.fundAgent(user, agent.id, CALL_FUND_ULXC)
      const before = await lens.agentBook(user)

      // A byte-identical retry: the same key, model and prompt, under one Idempotency-Key; no stored answer stands in for it.
      const a = 1000 + Math.floor(Math.random() * 9000)
      const b = 1000 + Math.floor(Math.random() * 9000)
      const prompt = `What is ${a} + ${b}? Reply with the number only.`
      const headers = { 'Idempotency-Key': randomUUID(), 'X-Talyvor-Cache': 'bypass' }
      let lines0 = await lens.agentLines(user, agent.id)
      let rows0 = new Set((await lens.ledger(user)).map((r) => r.id))
      const copies = await Promise.all([asked(ctx, k.value.key, prompt, headers), asked(ctx, k.value.key, prompt, headers)])
      copies.push(await asked(ctx, k.value.key, prompt, headers))
      ctx.evidence.push({ note: `one request under one Idempotency-Key, twice at once and once after: ${copies.map((r) => (r.ok ? `${r.status} "${r.value.text}"` : `${r.status} ${r.error}`)).join('; ')}`, question: prompt })
      const served = copies.find((r) => r.ok)
      if (served === undefined || !served.ok) return fail(`no copy of the request was served: ${copies.map((r) => (r.ok ? '' : `${r.status} ${r.error}`)).join('; ')}`)
      if (!statesNumber(served.value.text, a + b)) return fail(`answered wrong: expected ${a + b}, got "${served.value.text}"`)
      const retried = await billedOnce(ctx, agent.id, lines0, rows0, `the request sent ${copies.length} times under one key`)
      if (typeof retried === 'string') return fail(retried)

      // Hung up on once its answer starts to arrive: what was served is billed, once.
      lines0 = await lens.agentLines(user, agent.id)
      rows0 = new Set((await lens.ledger(user)).map((r) => r.id))
      const model = modelOf(ctx)
      const count = `Count from 1 to 60, separated by spaces. (${RUN_SALT}-${Date.now().toString(36)})`
      const hold = ctx.env.cap.reserve(listPriceUSD(model, worstInputTokens(count.length), STREAM_MAX_TOKENS))
      let hung: Answered<{ said: string; whole: boolean }>
      try {
        hung = await lens.hangUpAsAgent(k.value.key, ctx.env.judgeProvider, model.id, count, STREAM_MAX_TOKENS)
      } finally {
        // What the provider went on to make after the hang-up is not known: it is counted at its worst.
        ctx.env.cap.settle(hold, undefined)
      }
      if (!hung.ok) return fail(`the streamed request was refused: ${hung.status} ${hung.error}`)
      if (hung.value.whole) throw new Error('the streamed answer ended before the agent could hang up on it')
      ctx.evidence.push({ note: `hung up on the stream after "${hung.value.said}"`, question: count })
      const streamed = await billedOnce(ctx, agent.id, lines0, rows0, 'the stream the agent hung up on')
      if (typeof streamed === 'string') return fail(streamed)

      const after = await lens.agentBook(user)
      const held = after.agents.find((x) => x.id === agent.id)?.balance_ulxc
      const want = CALL_FUND_ULXC - retried - streamed
      ctx.evidence.push({ note: `${agent.name} was funded ${CALL_FUND_ULXC} µLXC and charged ${retried} and ${streamed}; Lens stores ${held}` })
      const wrong: string[] = []
      if (held !== want) wrong.push(`${agent.name} was funded ${CALL_FUND_ULXC} µLXC and charged ${retried} + ${streamed}, and Lens stores it holding ${held}, not ${want}`)
      const latest = (await lens.agentLines(user, agent.id))[0]?.balance_after_ulxc
      if (latest !== held) wrong.push(`its statement's last balance is ${latest} µLXC and Lens stores ${held}`)
      if (after.workspace_balance_ulxc !== before.workspace_balance_ulxc - retried - streamed) {
        wrong.push(`the workspace went from ${before.workspace_balance_ulxc} to ${after.workspace_balance_ulxc} µLXC for ${retried + streamed} µLXC of charges`)
      }
      if (after.unallocated_ulxc !== before.unallocated_ulxc) wrong.push(`the agent's calls moved the workspace's own free balance: ${before.unallocated_ulxc} → ${after.unallocated_ulxc} µLXC`)
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: `the request sent ${copies.length} times under one key was billed once (${retried} µLXC) and the stream hung up on after ` +
        `"${hung.value.said}" once (${streamed} µLXC): one charge and one spend row each, and ${agent.name} holds ${held} µLXC, its funding less exactly those` }
    },
  }
}
