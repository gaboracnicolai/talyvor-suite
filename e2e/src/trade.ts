// B25.4 — catalog v4: test users trade with each other, through every wallet, bank and marketplace
// function B25.3 made work for them. A person works the screens — Agent Wallets (/agents), a listing's
// page, Your listings & earnings — and the other company answers with its own token, straight to Lens,
// as another company's software would. Every oracle is a row read back from Lens, on both sides: the
// transfers, the request, the loan, the escrow, the pot, the schedule's run, the cash-out, the card,
// the listing's review, the bill and the seller's earnings, the Stripe account. Never a status code.
//
// What one run cannot otherwise reach, because it only happens days later: a loan's instalment (the first is
// due a period after it is accepted, a day at the soonest) and so its default; a payout (earnings wait for
// the buyer's monthly bill and then a 14-day holdback); a refund of a paid bill; a purchase on the card
// (Stripe's authorization). B25.8: Lens (B25.7) brings each due now for a test workspace, with the
// synthetic key, and the last five scenarios below trade through them.

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent, BillLine, Listing, Loan, MarketEarnings, MarketJournal, MarketLicence, MarketOffer, MoneyRequest, PaidTestBill, SyntheticUser } from './lens.ts'
import { ACTION_TIMEOUT_MS, type AgentBankScreen, agentIn, bookOf, card, fail, lxcText, openAgent, publishPrompt, runListing, spendRows, withBank } from './bank.ts'
import { worstInputTokens } from './budget.ts'
import { keptOf, percent } from './fees.ts'
import { RUN_SALT, freshWord, listPriceUSD, seeded, statesNumber } from './oracles.ts'
import { otherCompanyOnTeam } from './room.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from './scenarios.ts'

/** A listing's use: Lens runs it with the most output a chat answer may produce. */
const USE_MAX_TOKENS = 4096
/** How long a tick-driven step (a schedule's run, a cash-out's payment) may take: Lens ticks every minute. */
const TICK_WAIT_MS = 240_000
/** B35.8 — the most the testers wait for Lens to meter a marketplace use, which it does within a minute. */
const METER_WAIT_MS = 90_000
/** B32.75 — the most the testers wait for Lens to release a due earning from the journal's holdback: its job runs every 5 minutes. */
const RELEASE_WAIT_MS = 360_000
/** µLXC to the µUSD (Lens market.ulxcPerUSDMicro). */
const ULXC_PER_USD_MICRO = 10
const DAY_MS = 24 * 3600e3

/** The other company: another test user, and an agent of its own, made and funded through Lens. */
export async function otherCompany(ctx: ScenarioCtx, partner: number, name: string, fund: number): Promise<{ co: SyntheticUser; agent: { id: string; name: string } }> {
  const co = ctx.env.userAt(partner)
  const team = await otherCompanyOnTeam(ctx, partner)
  if (team !== undefined) throw new Error(team)
  const agent = await ctx.env.lens.createAgent(co, name)
  if (fund > 0) await ctx.env.lens.fundAgent(co, agent.id, fund)
  return { co, agent }
}

async function balance(ctx: ScenarioCtx, user: SyntheticUser, agentID: string): Promise<number | undefined> {
  return agentIn(await ctx.env.lens.agentBook(user), agentID)?.balance_ulxc
}

/** Both agents' balances, noted: this company's `a` and the other company's `b`. */
async function balances(ctx: ScenarioCtx, a: Agent, other: { co: SyntheticUser; agent: { id: string } }): Promise<[number | undefined, number | undefined]> {
  const got: [number | undefined, number | undefined] = [await balance(ctx, ctx.app.user, a.id), await balance(ctx, other.co, other.agent.id)]
  ctx.evidence.push({ note: `balances: ${a.name} ${got[0]} µLXC; the other company's agent ${got[1]} µLXC` })
  return got
}

/** A person opens an agent on Agent Wallets and funds it: the agent, or why not. */
async function fundedAgent(ctx: ScenarioCtx, bank: AgentBankScreen, name: string, ulxc: number): Promise<Agent | string> {
  const a = await openAgent(ctx, bank, name)
  if (typeof a === 'string') return a
  const err = await bank.move(a, ulxc, 'Fund')
  return err === undefined ? a : `funding ${name} with ${lxcText(ulxc)} LXC was refused: ${err}`
}

/** Polls `read` until `done` holds of what it read or `ms` pass; the last read. */
export async function until<T>(read: () => Promise<T>, done: (v: T) => boolean, ms = TICK_WAIT_MS): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await read()
    if (done(v) || Date.now() > end) return v
    await new Promise((r) => setTimeout(r, 5000))
  }
}

const day = (at: number): string => new Date(at).toISOString().slice(0, 10)

// ─── Agent Wallets, between two companies ────────────────────────────────────

export function walletSendRefund(seed: number, partner: number): Scenario {
  const funded = 5e6
  const amount = 1_500_000
  return {
    id: 'wallet-send-refund',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "a person sends credits to another company's agent on Agent Wallets, and that company gives them back: each time one transfer on both sides and both balances move by it",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const other = await otherCompany(ctx, partner, `Payee ${seed}`, 0)
      const a = await fundedAgent(ctx, bank, `Sender ${seed}`, funded)
      if (typeof a === 'string') return fail(a)
      const said = await bank.send(a, other.agent.id, amount, `nightly check ${seed}`)
      ctx.evidence.push({ note: `Send ${lxcText(amount)} LXC to ${other.agent.id}: ${said}` })
      if (!/^Sent/.test(said)) return fail(`sending was refused: "${said}"`)
      const mine = (await env.lens.transfers(app.user, a.id)).filter((t) => t.to_agent_id === other.agent.id)
      const theirs = (await env.lens.transfers(other.co, other.agent.id)).filter((t) => t.from_agent_id === a.id)
      ctx.evidence.push({ note: `the sender's transfers ${JSON.stringify(mine)}; the receiver's ${JSON.stringify(theirs)}` })
      if (mine.length !== 1 || mine[0].amount_ulxc !== amount) return fail(`one ${amount} µLXC send left ${mine.length} transfer(s) on the sender's side`)
      if (theirs.length !== 1 || theirs[0].id !== mine[0].id) return fail(`the receiving company sees ${theirs.length} transfer(s) from the sender, not the sender's ${mine[0].id}`)
      let [x, y] = await balances(ctx, a, other)
      if (x !== funded - amount || y !== amount) return fail(`after sending ${lxcText(amount)} LXC ${a.name} holds ${x} µLXC (want ${funded - amount}) and the receiver ${y} (want ${amount})`)

      const back = await env.lens.refundTransfer(other.co, mine[0].id)
      ctx.evidence.push({ note: 'the other company gives it back', answer: JSON.stringify(back) })
      if (!back.ok) return fail(`giving it back was refused: ${back.status} ${back.error}`)
      const refunds = (await env.lens.transfers(app.user, a.id)).filter((t) => t.refund_of === mine[0].id)
      const theirRefunds = (await env.lens.transfers(other.co, other.agent.id)).filter((t) => t.refund_of === mine[0].id)
      if (refunds.length !== 1 || theirRefunds.length !== 1 || refunds[0].id !== theirRefunds[0].id || refunds[0].to_agent_id !== a.id || refunds[0].amount_ulxc !== amount) {
        return fail(`giving it back left ${refunds.length} refund(s) on the sender's side and ${theirRefunds.length} on the receiver's: ${JSON.stringify([refunds, theirRefunds])}`)
      }
      ;[x, y] = await balances(ctx, a, other)
      if (x !== funded || y !== 0) return fail(`given back, ${a.name} holds ${x} µLXC (want ${funded}) and the receiver ${y} (want 0)`)
      return { pass: true, detail: `sent ${lxcText(amount)} LXC: one transfer both companies see, the balances moved by it; given back: one refund both see, both balances where they began` }
    }),
  }
}

/**
 * B28.23 — the other way round: another company's agent sends a person's agent credits, and the person gives
 * them back from Agent Wallets. One refund both companies see, the original marked given back, and one posting
 * on each agent's account — the same amount, out of one and into the other — so both balances move by it.
 */
export function walletGiveBack(seed: number, partner: number): Scenario {
  const funded = 3e6
  const amount = 1_200_000
  const memo = `overpaid ${seed}`
  return {
    id: 'wallet-give-back',
    owner: 'talyvor-lens',
    items: ['B28.23', 'B28.299'],
    agents: 1,
    partners: [partner],
    title: "another company's agent sends a person's agent credits, and the person gives them back on Agent Wallets: one refund both sides see, one posting on each account, both balances moved by it",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const other = await otherCompany(ctx, partner, `Giver ${seed}`, funded)
      const a = await openAgent(ctx, bank, `Receiver ${seed}`)
      if (typeof a === 'string') return fail(a)
      const sent = await env.lens.sendCredits(other.co, other.agent.id, a.id, amount, memo)
      ctx.evidence.push({ note: `the other company sends ${a.name} ${lxcText(amount)} LXC`, answer: JSON.stringify(sent) })
      if (!sent.ok) return fail(`the other company could not send: ${sent.status} ${sent.error}`)
      const got = (await env.lens.transfers(app.user, a.id)).find((t) => t.id === sent.value.id)
      if (got?.refundable !== true) return fail(`Lens does not offer ${a.name} the transfer it received to give back: ${JSON.stringify(got)}`)
      let [x, y] = await balances(ctx, a, other)
      if (x !== amount || y !== funded - amount) return fail(`after the send ${a.name} holds ${x} µLXC (want ${amount}) and the sender ${y} (want ${funded - amount})`)
      const mine0 = await env.lens.agentLines(app.user, a.id)
      const theirs0 = await env.lens.agentLines(other.co, other.agent.id)

      const said = await bank.giveBack(a, other.agent.id, memo)
      ctx.evidence.push({ note: `Give back: ${said}` })
      if (!/^Gave/.test(said)) return fail(`giving it back was refused: "${said}"`)
      const refunds = (await env.lens.transfers(app.user, a.id)).filter((t) => t.refund_of === sent.value.id)
      const theirRefunds = (await env.lens.transfers(other.co, other.agent.id)).filter((t) => t.refund_of === sent.value.id)
      if (refunds.length !== 1 || theirRefunds.length !== 1 || refunds[0].id !== theirRefunds[0].id || refunds[0].from_agent_id !== a.id || refunds[0].to_agent_id !== other.agent.id || refunds[0].amount_ulxc !== amount) {
        return fail(`giving it back left ${refunds.length} refund(s) on the receiver's side and ${theirRefunds.length} on the sender's: ${JSON.stringify([refunds, theirRefunds])}`)
      }
      const original = (await env.lens.transfers(app.user, a.id)).find((t) => t.id === sent.value.id)
      if (original?.refunded_by !== refunds[0].id || original.refundable === true) return fail(`given back, the original reads ${JSON.stringify(original)}`)
      const mine = (await env.lens.agentLines(app.user, a.id)).filter((l) => !mine0.some((o) => o.entry_id === l.entry_id))
      const theirs = (await env.lens.agentLines(other.co, other.agent.id)).filter((l) => !theirs0.some((o) => o.entry_id === l.entry_id))
      const text = (ls: typeof mine) => ls.map((l) => `${l.kind} ${l.amount_ulxc} → ${l.balance_after_ulxc}`).join(', ') || 'nothing'
      ctx.evidence.push({ note: `giving back wrote ${text(mine)} on ${a.name}'s account and ${text(theirs)} on the sender's` })
      if (mine.length !== 1 || mine[0].amount_ulxc !== -amount || mine[0].balance_after_ulxc !== 0 || theirs.length !== 1 || theirs[0].amount_ulxc !== amount || theirs[0].balance_after_ulxc !== funded) {
        return fail(`giving back ${amount} µLXC should write -${amount} leaving 0 on ${a.name}'s account and +${amount} leaving ${funded} on the sender's; it wrote ${text(mine)} and ${text(theirs)}`)
      }
      ;[x, y] = await balances(ctx, a, other)
      if (x !== 0 || y !== funded) return fail(`given back, ${a.name} holds ${x} µLXC (want 0) and the sender ${y} (want ${funded})`)
      return { pass: true, detail: `received ${lxcText(amount)} LXC from another company, given back on the screen: one refund both see, the original marked, one posting of ${lxcText(amount)} LXC out of ${a.name} and one into the sender, both balances where they began` }
    }),
  }
}

export function walletRequest(seed: number, partner: number): Scenario {
  const funded = 2e6
  const amount = 800_000
  return {
    id: 'wallet-request',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "another company's agent asks a person's agent for credits; accepted on Agent Wallets, it is paid once and both companies see the same request and transfer",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const other = await otherCompany(ctx, partner, `Asker ${seed}`, 0)
      const a = await fundedAgent(ctx, bank, `Payer ${seed}`, funded)
      if (typeof a === 'string') return fail(a)
      const asked = await env.lens.requestMoney(other.co, other.agent.id, a.id, amount, `invoice ${seed}`)
      ctx.evidence.push({ note: `the other company asks ${a.name} for ${lxcText(amount)} LXC`, answer: JSON.stringify(asked) })
      if (!asked.ok) return fail(`the other company could not ask: ${asked.status} ${asked.error}`)
      const said = await bank.acceptRequest(a, other.agent.id)
      ctx.evidence.push({ note: `Accept: ${said}` })
      if (said !== 'Accepted') return fail(`accepting was refused: "${said}"`)
      const mine = (await env.lens.moneyRequests(app.user)).find((r) => r.id === asked.value.id)
      const theirs = (await env.lens.moneyRequests(other.co)).find((r) => r.id === asked.value.id)
      ctx.evidence.push({ note: `the request as each side reads it: ${JSON.stringify([mine, theirs])}` })
      if (mine?.status !== 'accepted' || theirs?.status !== 'accepted' || mine.transfer_id === undefined || mine.transfer_id !== theirs.transfer_id) {
        return fail(`after Accept the request reads ${mine?.status ?? 'missing'} to the payer and ${theirs?.status ?? 'missing'} to the asker, paid by ${mine?.transfer_id ?? 'no transfer'}`)
      }
      const paid = (await env.lens.transfers(app.user, a.id)).filter((t) => t.request_id === asked.value.id)
      const got = (await env.lens.transfers(other.co, other.agent.id)).filter((t) => t.request_id === asked.value.id)
      if (paid.length !== 1 || got.length !== 1 || paid[0].id !== mine.transfer_id || paid[0].amount_ulxc !== amount || paid[0].to_agent_id !== other.agent.id) {
        return fail(`the request was paid by ${paid.length} transfer(s) on the payer's side and ${got.length} on the asker's: ${JSON.stringify([paid, got])}`)
      }
      const [x, y] = await balances(ctx, a, other)
      if (x !== funded - amount || y !== amount) return fail(`paid, ${a.name} holds ${x} µLXC (want ${funded - amount}) and the asker ${y} (want ${amount})`)
      return { pass: true, detail: `asked by the other company, accepted on the screen: the request reads accepted on both sides, paid by one ${lxcText(amount)} LXC transfer both see` }
    }),
  }
}

export function walletLoan(seed: number, partner: number): Scenario {
  const funded = 5e6
  const principal = 2e6
  return {
    id: 'wallet-loan',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "a person offers another company's agent a loan on Agent Wallets; accepted, the borrower is paid the principal once, both see the loan active with its first instalment due a day on",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const other = await otherCompany(ctx, partner, `Borrower ${seed}`, 0)
      const a = await fundedAgent(ctx, bank, `Lender ${seed}`, funded)
      if (typeof a === 'string') return fail(a)
      const said = await bank.offerLoan(a, { to: other.agent.id, principal, pct: 10, n: 2, every: 'day', memo: `bridge ${seed}` })
      ctx.evidence.push({ note: `Offer ${lxcText(principal)} LXC at 10% over 2 daily instalments: ${said}` })
      if (!/^Offered/.test(said)) return fail(`offering the loan was refused: "${said}"`)
      const offered = (await env.lens.loans(other.co)).filter((l) => l.lender_agent_id === a.id)
      if (offered.length !== 1 || offered[0].status !== 'offered') return fail(`the borrower's company sees ${offered.length} loan(s) from ${a.name}: ${JSON.stringify(offered)}`)
      const l = offered[0]
      if (l.principal_ulxc !== principal || l.interest_bps !== 1000 || l.instalments !== 2 || l.every !== 'day' || l.borrower_agent_id !== other.agent.id) {
        return fail(`the loan offered is not the one on the screen: ${JSON.stringify(l)}`)
      }
      const accepted = await env.lens.answerLoan(other.co, l.id, true)
      ctx.evidence.push({ note: 'the other company accepts', answer: JSON.stringify(accepted) })
      if (!accepted.ok) return fail(`accepting the loan was refused: ${accepted.status} ${accepted.error}`)
      const lent = (await env.lens.loans(app.user)).find((x) => x.id === l.id)
      const borrowed = (await env.lens.loans(other.co)).find((x) => x.id === l.id)
      ctx.evidence.push({ note: `the loan as each side reads it: ${JSON.stringify([lent, borrowed])}` })
      if (lent?.status !== 'active' || borrowed?.status !== 'active') return fail(`accepted, the loan reads ${lent?.status ?? 'missing'} to the lender and ${borrowed?.status ?? 'missing'} to the borrower`)
      // The loan names the transfer that paid it out; both companies' transfers carry it, naming the loan.
      const payout = (lent.events ?? []).filter((e) => e.kind === 'payout')
      const tid = payout[0]?.transfer_id
      const paid = (await env.lens.transfers(app.user, a.id)).filter((t) => t.id === tid)
      const got = (await env.lens.transfers(other.co, other.agent.id)).filter((t) => t.id === tid)
      ctx.evidence.push({ note: `the payout transfer as each side reads it: ${JSON.stringify([paid, got])}` })
      if (payout.length !== 1 || paid.length !== 1 || got.length !== 1 || paid[0].amount_ulxc !== principal || paid[0].to_agent_id !== other.agent.id) {
        return fail(`accepted, the loan paid out ${payout.length} time(s); its transfer ${tid ?? '(none)'} is on the lender's side ${paid.length} time(s) and the borrower's ${got.length}`)
      }
      const [x, y] = await balances(ctx, a, other)
      if (x !== funded - principal || y !== principal) return fail(`lent, ${a.name} holds ${x} µLXC (want ${funded - principal}) and the borrower ${y} (want ${principal})`)
      if (paid[0].loan_id !== l.id || got[0].loan_id !== l.id) {
        return fail(`the loan's payout ${tid} is on both sides but names loan ${paid[0].loan_id ?? '(none)'} to the lender and ${got[0].loan_id ?? '(none)'} to the borrower, not ${l.id}`)
      }
      const due = Date.parse(lent.next_due_at ?? '') - Date.parse(lent.decided_at ?? '')
      if (!(Math.abs(due - DAY_MS) < 60_000)) return fail(`the first instalment is due ${lent.next_due_at}, not a day after the loan was accepted (${lent.decided_at})`)
      return { pass: true, detail: `offered on the screen, accepted by the borrower: active on both sides, ${lxcText(principal)} LXC paid out once, the first instalment due a day on (repaying and defaulting happen then — B25.7)` }
    }),
  }
}

export function walletEscrow(seed: number, partner: number): Scenario {
  const funded = 5e6
  const [kept, argued] = [1e6, 500_000]
  return {
    id: 'wallet-escrow',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "a person pays into escrow for another company's agent: held out of both balances; confirmed delivered, the payee is paid; disputed, it stays held",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const other = await otherCompany(ctx, partner, `Maker ${seed}`, 0)
      const a = await fundedAgent(ctx, bank, `Client ${seed}`, funded)
      if (typeof a === 'string') return fail(a)
      const releaseOn = day(Date.now() + 7 * DAY_MS)
      const escrowOf = async (user: SyntheticUser, memo: string) => (await env.lens.escrows(user)).filter((e) => e.memo === memo)
      const open = async (ulxc: number, memo: string): Promise<string | undefined> => {
        const said = await bank.payIntoEscrow(a, other.agent.id, ulxc, releaseOn, memo)
        ctx.evidence.push({ note: `Pay ${lxcText(ulxc)} LXC into escrow ("${memo}"): ${said}` })
        if (!/^Held/.test(said)) return `paying into escrow was refused: "${said}"`
        const [mine, theirs] = [await escrowOf(app.user, memo), await escrowOf(other.co, memo)]
        if (mine.length !== 1 || theirs.length !== 1 || mine[0].id !== theirs[0].id || mine[0].status !== 'held' || mine[0].amount_ulxc !== ulxc) {
          return `after paying in, the payer sees ${mine.length} escrow(s) and the payee ${theirs.length}: ${JSON.stringify([mine, theirs])}`
        }
        return undefined
      }
      let err = await open(kept, `logo ${seed}`)
      if (err !== undefined) return fail(err)
      let [x, y] = await balances(ctx, a, other)
      if (x !== funded - kept || y !== 0) return fail(`held in escrow, ${a.name} holds ${x} µLXC (want ${funded - kept}) and the payee ${y} (want 0)`)
      let said = await bank.settleEscrow(`logo ${seed}`, { confirm: true })
      ctx.evidence.push({ note: `Confirm delivered: ${said}` })
      if (said !== 'Released') return fail(`confirming delivery was refused: "${said}"`)
      const released = [...await escrowOf(app.user, `logo ${seed}`), ...await escrowOf(other.co, `logo ${seed}`)]
      if (released.some((e) => e.status !== 'released')) return fail(`confirmed, the escrow reads ${released.map((e) => e.status).join(' and ')}`)
      ;[x, y] = await balances(ctx, a, other)
      if (x !== funded - kept || y !== kept) return fail(`released, ${a.name} holds ${x} µLXC (want ${funded - kept}) and the payee ${y} (want ${kept})`)

      err = await open(argued, `print run ${seed}`)
      if (err !== undefined) return fail(err)
      said = await bank.settleEscrow(`print run ${seed}`, { dispute: 'nothing arrived' })
      ctx.evidence.push({ note: `Dispute: ${said}` })
      if (said !== 'Disputed') return fail(`disputing was refused: "${said}"`)
      const disputed = [...await escrowOf(app.user, `print run ${seed}`), ...await escrowOf(other.co, `print run ${seed}`)]
      if (disputed.some((e) => e.status !== 'disputed')) return fail(`disputed, the escrow reads ${disputed.map((e) => e.status).join(' and ')}`)
      ;[x, y] = await balances(ctx, a, other)
      if (x !== funded - kept - argued || y !== kept) return fail(`disputed, ${a.name} holds ${x} µLXC (want ${funded - kept - argued}) and the payee ${y} (want ${kept}): a disputed escrow stays held`)
      return { pass: true, detail: `${lxcText(kept)} LXC held out of both balances, then paid to the payee on Confirm delivered; ${lxcText(argued)} LXC disputed stays held, both companies see each escrow as it is` }
    }),
  }
}

/**
 * B28.355 / B28.92 — money waiting on a person, answered in Chat. With Chat open, another company's agent asks a
 * person's agent for credits: the card shows in Chat, Accept is pressed there, and /api/wallets/requests then reads the
 * request accepted, paid by the one transfer both companies see. Then the person pays into escrow for that agent on
 * Agent Wallets and confirms it delivered in Chat: released, the payee holds it. Every oracle is Lens's own rows.
 */
export function chatMoneyRequests(seed: number, partner: number): Scenario {
  const funded = 3e6
  const [asked, kept] = [700_000, 500_000]
  return {
    id: 'chat-money-requests',
    owner: 'talyvor-suite',
    items: ['B28.92', 'B28.355'],
    agents: 1,
    partners: [partner],
    title: "another company's agent asks a person's agent for credits and is paid on Accept in Chat; an escrow confirmed delivered in Chat is released to the payee",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const other = await otherCompany(ctx, partner, `Chat asker ${seed}`, 0)
      const a = await fundedAgent(ctx, bank, `Chat payer ${seed}`, funded)
      if (typeof a === 'string') return fail(a)
      const page = await app.tab('/chat')
      try {
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.locator('#chat-message').waitFor({ timeout: ACTION_TIMEOUT_MS })

        const memo = `chat invoice ${seed}`
        const req = await env.lens.requestMoney(other.co, other.agent.id, a.id, asked, memo)
        ctx.evidence.push({ note: `the other company asks ${a.name} for ${lxcText(asked)} LXC`, answer: JSON.stringify(req) })
        if (!req.ok) return fail(`the other company could not ask: ${req.status} ${req.error}`)
        const card = page.locator(`[data-testid="chat-money-request"][data-request="${req.value.id}"]`)
        // Chat reads the requests every 10 s: the card is on screen within two reads, without a reload.
        try {
          await card.waitFor({ timeout: 25_000 })
        } catch {
          return fail(`25s after the other company asked ${a.name} for ${lxcText(asked)} LXC, Chat showed no card for it`)
        }
        // Each amount carries the person's currency after it, "(…)"; the LXC figure is what is compared.
        const plain = (t: string) => t.replace(/ \([^()]*\)/g, '').trim()
        // B34.1 — the other company's agent is named once Chat has looked it up; until then the card shows its id.
        await card.getByTestId('chat-money-asks').filter({ hasText: other.agent.name }).waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        const asks = plain(await card.getByTestId('chat-money-asks').innerText())
        if (asks !== `${other.agent.name} asks ${a.name} for ${lxcText(asked)} LXC — ${memo}`) return fail(`Chat's card reads "${asks}"`)
        await mkdir(env.outDir, { recursive: true })
        for (const [width, height] of [[1440, 900], [390, 844]] as const) {
          await page.setViewportSize({ width, height })
          await card.scrollIntoViewIfNeeded()
          const shot = join(env.outDir, `chat-money-request-${width}px-user${app.user.index}.png`)
          await page.screenshot({ path: shot })
          ctx.evidence.push({ note: `the request in Chat at ${width}px: ${shot}` })
        }
        await card.getByRole('button', { name: 'Accept', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
        const said = plain(await card.getByRole('status').or(card.getByRole('alert')).innerText({ timeout: ACTION_TIMEOUT_MS }))
        ctx.evidence.push({ note: `Accept in Chat: ${said}` })
        if (!said.startsWith(`Accepted. ${a.name} paid ${other.agent.name} ${lxcText(asked)} LXC.`)) return fail(`Accept in Chat said "${said}"`)

        // B28.92's DONE line, as the person's own session reads it.
        const res = await page.request.get(new URL('/api/wallets/requests', page.url()).toString())
        const listed = res.ok() ? (((await res.json()) as { requests?: MoneyRequest[] | null }).requests ?? []) : []
        const mine = listed.find((r) => r.id === req.value.id)
        const theirs = (await env.lens.moneyRequests(other.co)).find((r) => r.id === req.value.id)
        ctx.evidence.push({ note: `/api/wallets/requests (${res.status()}) and the asker's own read: ${JSON.stringify([mine, theirs])}` })
        if (mine?.status !== 'accepted' || theirs?.status !== 'accepted' || mine.transfer_id === undefined || mine.transfer_id !== theirs.transfer_id) {
          return fail(`accepted in Chat, /api/wallets/requests reads it ${mine?.status ?? 'missing'} (${res.status()}) and the asker ${theirs?.status ?? 'missing'}, paid by ${mine?.transfer_id ?? 'no transfer'}`)
        }
        const paid = (await env.lens.transfers(app.user, a.id)).filter((t) => t.request_id === req.value.id)
        const got = (await env.lens.transfers(other.co, other.agent.id)).filter((t) => t.request_id === req.value.id)
        if (paid.length !== 1 || got.length !== 1 || paid[0].id !== mine.transfer_id || paid[0].amount_ulxc !== asked || paid[0].to_agent_id !== other.agent.id) {
          return fail(`the request was paid by ${paid.length} transfer(s) on the payer's side and ${got.length} on the asker's: ${JSON.stringify([paid, got])}`)
        }
        let [x, y] = await balances(ctx, a, other)
        if (x !== funded - asked || y !== asked) return fail(`paid, ${a.name} holds ${x} µLXC (want ${funded - asked}) and the asker ${y} (want ${asked})`)

        const what = `chat delivery ${seed}`
        const held = await bank.payIntoEscrow(a, other.agent.id, kept, day(Date.now() + 7 * DAY_MS), what)
        ctx.evidence.push({ note: `Pay ${lxcText(kept)} LXC into escrow ("${what}") on Agent Wallets: ${held}` })
        if (!/^Held/.test(held)) return fail(`paying into escrow was refused: "${held}"`)
        const escrow = (await env.lens.escrows(app.user)).filter((e) => e.memo === what)
        if (escrow.length !== 1 || escrow[0].status !== 'held') return fail(`after paying in, the payer sees ${JSON.stringify(escrow)}`)
        const ecard = page.locator(`[data-testid="chat-escrow"][data-escrow="${escrow[0].id}"]`)
        try {
          await ecard.waitFor({ timeout: 25_000 })
        } catch {
          return fail(`25s after ${a.name} paid ${lxcText(kept)} LXC into escrow, Chat showed no card for it`)
        }
        await ecard.getByRole('button', { name: 'Confirm delivered', exact: true }).click({ timeout: ACTION_TIMEOUT_MS })
        const confirmed = plain(await ecard.getByRole('status').or(ecard.getByRole('alert')).innerText({ timeout: ACTION_TIMEOUT_MS }))
        ctx.evidence.push({ note: `Confirm delivered in Chat: ${confirmed}` })
        if (!confirmed.startsWith(`Confirmed delivered. ${other.agent.name} is paid ${lxcText(kept)} LXC from escrow.`)) return fail(`Confirm delivered in Chat said "${confirmed}"`)
        const released = [...(await env.lens.escrows(app.user)), ...(await env.lens.escrows(other.co))].filter((e) => e.id === escrow[0].id)
        if (released.length !== 2 || released.some((e) => e.status !== 'released')) return fail(`confirmed in Chat, the escrow reads ${released.map((e) => e.status).join(' and ') || 'missing'}`)
        ;[x, y] = await balances(ctx, a, other)
        if (x !== funded - asked - kept || y !== asked + kept) {
          return fail(`released, ${a.name} holds ${x} µLXC (want ${funded - asked - kept}) and the payee ${y} (want ${asked + kept})`)
        }
        return {
          pass: true,
          detail: `accepted in Chat, /api/wallets/requests reads the request accepted, paid by one ${lxcText(asked)} LXC transfer both companies see; an escrow confirmed delivered in Chat released ${lxcText(kept)} LXC to the payee`,
        }
      } finally {
        await page.close()
      }
    }),
  }
}

export function walletPots(seed: number): Scenario {
  const funded = 3e6
  const [into, outOf] = [1_200_000, 400_000]
  return {
    id: 'wallet-pots',
    owner: 'talyvor-lens',
    agents: 1,
    title: 'a person sets credits aside in a pot on Agent Wallets and takes some back: the pot, the agent and the book each hold exactly what moved',
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const a = await fundedAgent(ctx, bank, `Saver ${seed}`, funded)
      if (typeof a === 'string') return fail(a)
      const name = `Reserve ${seed}`
      let err = await bank.createPot(a, name, 2e6)
      if (err !== undefined) return fail(`creating the pot was refused: ${err}`)
      const check = async (want: number, after: string): Promise<string | undefined> => {
        const pot = (await env.lens.pots(app.user, a.id)).find((p) => p.name === name)
        const held = agentIn(await bookOf(ctx), a.id)
        ctx.evidence.push({ note: `${after}: the pot holds ${pot?.balance_ulxc} µLXC; ${a.name} ${held?.balance_ulxc}, its pots ${held?.pots_ulxc}` })
        if (pot?.balance_ulxc !== want) return `${after}, the pot holds ${pot?.balance_ulxc ?? 'nothing'} µLXC, want ${want}`
        if (held?.balance_ulxc !== funded - want || held.pots_ulxc !== want) return `${after}, ${a.name} holds ${held?.balance_ulxc} µLXC with ${held?.pots_ulxc} in pots; want ${funded - want} and ${want}`
        return undefined
      }
      err = await bank.movePot(a, name, into, 'in')
      if (err !== undefined) return fail(`moving ${lxcText(into)} LXC in was refused: ${err}`)
      err = await check(into, `${lxcText(into)} LXC moved in`)
      if (err !== undefined) return fail(err)
      err = await bank.movePot(a, name, outOf, 'out')
      if (err !== undefined) return fail(`moving ${lxcText(outOf)} LXC out was refused: ${err}`)
      err = await check(into - outOf, `${lxcText(outOf)} LXC moved back out`)
      if (err !== undefined) return fail(err)
      return { pass: true, detail: `in ${lxcText(into)}, out ${lxcText(outOf)}: the pot holds ${lxcText(into - outOf)} LXC, the agent the rest, and the book counts both` }
    }),
  }
}

export function walletRecurring(seed: number, partner: number): Scenario {
  const funded = 3e6
  const amount = 250_000
  return {
    id: 'wallet-recurring',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "a person starts a daily transfer to another company's agent on Agent Wallets: Lens pays the first at once, one transfer both companies see, and nothing more that day",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const other = await otherCompany(ctx, partner, `Retained ${seed}`, 0)
      const a = await fundedAgent(ctx, bank, `Retainer ${seed}`, funded)
      if (typeof a === 'string') return fail(a)
      const said = await bank.startRecurring(a, other.agent.id, amount, 'day', `retainer ${seed}`)
      ctx.evidence.push({ note: `Start ${lxcText(amount)} LXC every day: ${said}` })
      if (!/every day/.test(said)) return fail(`starting the recurring transfer was refused: "${said}"`)
      const sc = (await env.lens.schedules(app.user)).filter((x) => x.from_agent_id === a.id && x.to_agent_id === other.agent.id)
      if (sc.length !== 1 || sc[0].amount_ulxc !== amount || sc[0].every !== 'day') return fail(`Lens has ${sc.length} schedule(s) from ${a.name}: ${JSON.stringify(sc)}`)
      try {
        const runs = await until(() => env.lens.scheduleRuns(app.user, sc[0].id), (r) => r.length > 0)
        ctx.evidence.push({ note: `the schedule's runs: ${JSON.stringify(runs)}` })
        if (runs.length === 0) return fail(`no run within ${TICK_WAIT_MS / 60_000} minutes of starting a transfer due at once`)
        if (runs.some((r) => r.outcome !== 'paid')) return fail(`a run was refused: ${runs.map((r) => r.detail ?? r.outcome).join('; ')}`)
        // A second tick must not pay again: the next is a day away.
        await new Promise((r) => setTimeout(r, 70_000))
        const paid = (await env.lens.transfers(app.user, a.id)).filter((t) => t.schedule_id === sc[0].id)
        const got = (await env.lens.transfers(other.co, other.agent.id)).filter((t) => t.schedule_id === sc[0].id)
        ctx.evidence.push({ note: `transfers of the schedule: the payer's ${paid.length}, the payee's ${got.length}` })
        if (paid.length !== 1 || got.length !== 1 || paid[0].id !== got[0].id || paid[0].amount_ulxc !== amount) {
          return fail(`a transfer due once a day paid ${paid.length} time(s) on the payer's side and ${got.length} on the payee's`)
        }
        const [x, y] = await balances(ctx, a, other)
        if (x !== funded - amount || y !== amount) return fail(`after one run ${a.name} holds ${x} µLXC (want ${funded - amount}) and the payee ${y} (want ${amount})`)
        const next = (await env.lens.schedules(app.user)).find((x) => x.id === sc[0].id)?.next_run_at ?? ''
        if (!(Date.parse(next) - Date.now() > DAY_MS - 10 * 60_000)) return fail(`after its run the schedule is next due ${next}, not a day on`)
        return { pass: true, detail: `started on the screen, paid once by Lens's tick (one ${lxcText(amount)} LXC transfer both sides see), next due a day on` }
      } finally {
        await env.lens.stopSchedule(app.user, sc[0].id)
      }
    }),
  }
}

export function walletCashOut(seed: number): Scenario {
  const funded = 2e6
  const amount = 500_000
  return {
    id: 'wallet-cash-out',
    owner: 'talyvor-lens',
    agents: 1,
    title: "a person cashes an agent's credits out on Agent Wallets: held from the agent at once, then paid by the test partner",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const a = await fundedAgent(ctx, bank, `Earner ${seed}`, funded)
      if (typeof a === 'string') return fail(a)
      const said = await bank.cashOut(a, amount, `Test Bank ${seed}`)
      ctx.evidence.push({ note: `Ask to cash out ${lxcText(amount)} LXC: ${said}` })
      if (!/^Asked/.test(said)) return fail(`cashing out was refused: "${said}"`)
      const mine = (await env.lens.cashOuts(app.user)).filter((c) => c.agent_id === a.id)
      if (mine.length !== 1 || mine[0].amount_ulxc !== amount || mine[0].destination !== `Test Bank ${seed}`) return fail(`Lens has ${mine.length} cash-out(s) for ${a.name}: ${JSON.stringify(mine)}`)
      const held = await balance(ctx, app.user, a.id)
      if (held !== funded - amount) return fail(`asked to cash out ${amount} µLXC, ${a.name} holds ${held} µLXC: the credits were not held from it`)
      const last = await until(async () => (await env.lens.cashOuts(app.user)).find((c) => c.id === mine[0].id), (c) => c?.status === 'paid' || c?.status === 'failed')
      ctx.evidence.push({ note: `the cash-out: ${JSON.stringify(last)}` })
      if (last?.status !== 'paid') return fail(`the cash-out is ${last?.status ?? 'gone'}${last?.detail ? ` (${last.detail})` : ''} ${TICK_WAIT_MS / 60_000} minutes on, not paid`)
      const after = await balance(ctx, app.user, a.id)
      if (after !== funded - amount) return fail(`paid out, ${a.name} holds ${after} µLXC, want ${funded - amount}`)
      return { pass: true, detail: `${lxcText(amount)} LXC held from the agent at once and paid by the ${last.partner} partner; the agent keeps the rest` }
    }),
  }
}

export function walletCard(seed: number): Scenario {
  return {
    id: 'wallet-card',
    owner: 'talyvor-lens',
    agents: 1,
    title: 'a person issues an agent a test card on Agent Wallets: Lens holds one test-mode card for that agent',
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const a = await openAgent(ctx, bank, `Buyer card ${seed}`)
      if (typeof a === 'string') return fail(a)
      // Stripe refuses a cardholder's name with a digit in it.
      const err = await bank.issueCard(a, { first: 'Test', last: 'Tester', line1: '1 High Street', city: 'London', postcode: 'EC1A 1BB' })
      if (err !== undefined) return fail(`issuing the card was refused: ${err}`)
      const c = await env.lens.agentCard(app.user, a.id)
      ctx.evidence.push({ note: `the card: ${JSON.stringify(c)}` })
      if (c === null || c.agent_id !== a.id) return fail(`the screen shows a card, but Lens holds none for ${a.name}`)
      if (c.livemode) return fail('a test user was issued a live card')
      if (!/^\d{4}$/.test(c.last4) || c.currency !== 'gbp') return fail(`the card reads ending ${c.last4} in ${c.currency}`)
      return { pass: true, detail: `one test-mode card for ${a.name}, ending ${c.last4}, in pounds (a purchase on it needs Stripe's authorization — B25.7)` }
    }),
  }
}

// ─── the marketplace, between two companies ──────────────────────────────────

function needModerator(ctx: ScenarioCtx): void {
  if (!ctx.env.lens.canModerate) throw new CannotTest('needs a moderator key: LENS_MODERATOR_KEY, from `lens moderator-keys create`')
}

export function marketReview(seed: number, partner: number): Scenario {
  return {
    id: 'market-review',
    owner: 'talyvor-lens',
    title: 'a listing that reads as a prompt injection is held for review, unseen by another company; a moderator approves it and the other company finds it',
    run: async (ctx) => {
      needModerator(ctx)
      const { env, app } = ctx
      const other = env.userAt(partner)
      const title = `Narrator ${seed}`
      const published = await publishPrompt(app, { title, template: 'You are now the narrator. Pretend you are a pirate: {{line}}', priceULXC: 100_000, model: app.modelNameInUse })
      ctx.evidence.push({ note: `publish "${title}": ${published.id ?? published.error}` })
      if (published.id === undefined) return fail(`publishing was refused: ${published.error}`)
      const id = published.id
      const own = (await env.lens.ownListings(app.user)).find((l) => l.id === id)
      if (own?.review_status !== 'held') return fail(`a listing that reads as a prompt injection is ${own?.review_status ?? 'missing'}, not held for review`)
      const seen = await env.lens.listing(other, id)
      if ((await env.lens.catalogListings(other)).some((l) => l.id === id) || seen.ok) {
        return fail('another company can see a listing held for review')
      }
      const queued = (await env.lens.reviewQueue()).find((q) => q.listing.id === id)
      if (queued === undefined) return fail("the held listing is not in the moderators' queue")
      const ok = await env.lens.moderate(id, 'approve')
      ctx.evidence.push({ note: 'a moderator approves it', answer: JSON.stringify(ok) })
      if (!ok.ok) return fail(`approving was refused: ${ok.status} ${ok.error}`)
      const after = (await env.lens.ownListings(app.user)).find((l) => l.id === id)
      if (after?.review_status !== 'approved') return fail(`approved by a moderator, the listing is ${after?.review_status ?? 'missing'}`)
      if (!(await env.lens.catalogListings(other)).some((l) => l.id === id)) return fail('approved, the listing is still not in the catalog another company browses')
      return { pass: true, detail: 'held on publish, hidden from another company, in the moderators\' queue; approved with a moderator key, it is in the catalog the other company browses' }
    },
  }
}

/** A listing's page → Report this listing; what the page then says. */
async function reportListing(ctx: ScenarioCtx, id: string, reason: string, details: string): Promise<string> {
  const page = await ctx.app.tab(`/marketplace/listings/${encodeURIComponent(id)}`)
  try {
    await page.getByRole('button', { name: 'Report this listing' }).click({ timeout: ACTION_TIMEOUT_MS })
    await page.getByLabel(/^What is wrong with it/).selectOption(reason)
    await page.getByLabel(/^Details/).fill(details)
    await page.getByRole('button', { name: 'Send report' }).click()
    const note = page.getByRole('status').filter({ hasText: /^Reported/ }).or(page.locator('form').getByRole('alert')).first()
    await note.waitFor({ timeout: ACTION_TIMEOUT_MS })
    return (await note.innerText()).trim()
  } finally {
    await page.close()
  }
}

export function marketTakedown(seed: number, seller: number): Scenario {
  const r = seeded(seed * 43 + 19)
  const a = 100 + Math.floor(r() * 900)
  const b = 100 + Math.floor(r() * 900)
  const price = 300_000
  const template = `What is {{a}} + {{b}}? Reply with the number only.`
  return {
    id: 'market-takedown',
    owner: 'talyvor-lens',
    title: "a buyer uses another company's listing and reports it; a moderator takes it down, and the buyer's use is refunded on their bill and out of the seller's earnings",
    run: async (ctx) => {
      needModerator(ctx)
      const { env, app } = ctx
      const sellerApp = await env.signInUser(seller)
      let published
      try {
        published = await publishPrompt(sellerApp, { title: `Sums ${seed}-${a}`, template, priceULXC: price, model: app.modelNameInUse })
      } finally {
        await sellerApp.close()
      }
      ctx.evidence.push({ note: `the seller publishes "Sums ${seed}-${a}" at ${lxcText(price)} LXC a use: ${published.id ?? published.error}` })
      if (published.id === undefined) return fail(`publishing was refused: ${published.error}`)
      const id = published.id
      const earned0 = await env.lens.marketEarnings(sellerApp.user)
      const rows0 = new Set((await spendRows(ctx)).map((x) => x.id))
      const model = env.catalog.find((m) => m.display_name === app.modelNameInUse)
      if (model === undefined) throw new Error(`the catalog has no model named "${app.modelNameInUse}"`)
      const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(template.length + 8), USE_MAX_TOKENS))
      let used
      try {
        used = await runListing(app, id, { a: String(a), b: String(b) })
      } catch (e) {
        env.cap.settle(hold, undefined)
        throw e
      }
      const charged = (await spendRows(ctx)).filter((x) => !rows0.has(x.id))
      env.cap.settle(hold, used.error === undefined ? (charged.reduce((s, x) => s - x.amount_ulxc, 0) / 1e6) * env.usdPerLXC : undefined)
      for (const x of charged) env.book.add(app.user.workspaceID, -x.amount_ulxc)
      ctx.evidence.push({ note: 'the buyer uses it', answer: used.shown, error: used.error })
      if (used.error !== undefined) return fail(`the use was refused: ${used.error}`)
      if (!statesNumber(used.shown ?? '', a + b)) return fail(`the listing answered wrong: expected ${a + b}, got "${used.shown}"`)
      const line = ((await env.lens.marketBill(app.user)).lines ?? []).filter((l) => l.listing_id === id)
      if (line.length !== 1 || line[0].price_ulxc !== price || line[0].refunded_at !== undefined) return fail(`one use put ${line.length} line(s) on the buyer's bill: ${JSON.stringify(line)}`)
      const earned1 = await env.lens.marketEarnings(sellerApp.user)
      if (earned1.pending_uses !== earned0.pending_uses + 1) return fail(`the seller's pending uses went ${earned0.pending_uses} → ${earned1.pending_uses} for one use`)

      const said = await reportListing(ctx, id, 'misleading', `nightly check ${seed}: it only adds`)
      ctx.evidence.push({ note: `Report this listing: ${said}` })
      if (!/^Reported/.test(said)) return fail(`reporting was refused: "${said}"`)
      const queued = (await env.lens.reviewQueue()).find((q) => q.listing.id === id)
      ctx.evidence.push({ note: `in the moderators' queue: ${JSON.stringify(queued)}` })
      if (queued === undefined || queued.open_reports < 1 || !(queued.report_reasons ?? []).includes('misleading')) {
        return fail("the report did not reach the moderators' queue")
      }
      const down = await env.lens.moderate(id, 'takedown', `nightly check ${seed}`)
      ctx.evidence.push({ note: 'a moderator takes it down', answer: JSON.stringify(down) })
      if (!down.ok) return fail(`taking it down was refused: ${down.status} ${down.error}`)
      const bill = await env.lens.marketBill(app.user)
      const refunded = (bill.lines ?? []).filter((l) => l.listing_id === id)
      ctx.evidence.push({ note: `the buyer's bill: total ${bill.total_ulxc}, refunded ${bill.refunded_ulxc}; the line ${JSON.stringify(refunded)}` })
      if (refunded.length !== 1 || refunded[0].refunded_at === undefined) return fail("taken down, the buyer's use of it was not refunded on their bill")
      if ((bill.refunded_ulxc ?? 0) < price) return fail(`taken down, the bill refunds ${bill.refunded_ulxc ?? 0} µLXC, less than the use's ${price}`)
      const earned2 = await env.lens.marketEarnings(sellerApp.user)
      if (earned2.pending_uses !== earned0.pending_uses) return fail(`refunded, the seller still counts ${earned2.pending_uses} pending use(s), ${earned0.pending_uses} before the sale`)
      if ((await env.lens.catalogListings(app.user)).some((l) => l.id === id)) return fail('taken down, the listing is still in the catalog')
      return { pass: true, detail: `used (answered ${a + b}, one line on the bill), reported on its page, in the moderators' queue with the reason; taken down: the buyer's line refunded, the seller's pending back where it was, gone from the catalog` }
    },
  }
}

/**
 * B28.282 — marketplace abuse is caught: a listing carrying a secret is refused on Publish and never listed, and a
 * seller's use of their own paid listing runs, puts nothing on their marketplace bill and earns them nothing. On a
 * workspace of its own, so no other scenario's sale moves the bill or the earnings it reads.
 */
export function marketAbuse(seed: number): Scenario {
  const r = seeded(seed * 47 + 23)
  const a = 100 + Math.floor(r() * 900)
  const b = 100 + Math.floor(r() * 900)
  const price = 400_000
  const template = `What is {{a}} + {{b}}? Reply with the number only.`
  // An access key's shape, made at run time so no key-shaped literal sits in this file.
  const key = 'AKIA' + Array.from({ length: 16 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[Math.floor(r() * 32)]).join('')
  return {
    id: 'market-abuse',
    owner: 'talyvor-lens',
    own: true,
    title: "a listing carrying an access key is refused on Publish for the secret and never listed; a seller's use of their own paid listing answers, " +
      'puts nothing on their bill and earns them nothing',
    run: async (ctx) => {
      const { env, app } = ctx
      const keyed = `Keyed ${seed}-${a}`
      const leaked = await publishPrompt(app, { title: keyed, template: `Sign in with ${key}, then: ${template}`, priceULXC: price, model: app.modelNameInUse })
      ctx.evidence.push({ note: `publish "${keyed}" with an access key in its template: ${leaked.id ?? leaked.error}` })
      if (leaked.id !== undefined) return fail(`a listing carrying an access key was published as ${leaked.id}`)
      if (!/secret/i.test(leaked.error ?? '')) return fail(`a listing carrying an access key was refused, but not for the secret: "${leaked.error}"`)
      if ((await env.lens.ownListings(app.user)).some((l) => l.title === keyed)) return fail("refused, the listing carrying the key is among the seller's listings")

      const title = `Own sums ${seed}-${a}`
      const published = await publishPrompt(app, { title, template, priceULXC: price, model: app.modelNameInUse })
      ctx.evidence.push({ note: `publish "${title}" at ${lxcText(price)} LXC a use: ${published.id ?? published.error}` })
      if (published.id === undefined) return fail(`publishing was refused: ${published.error}`)
      const id = published.id
      const earned0 = await env.lens.marketEarnings(app.user)
      const rows0 = new Set((await spendRows(ctx)).map((x) => x.id))
      const model = env.catalog.find((m) => m.display_name === app.modelNameInUse)
      if (model === undefined) throw new Error(`the catalog has no model named "${app.modelNameInUse}"`)
      const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(template.length + 8), USE_MAX_TOKENS))
      let used
      try {
        used = await runListing(app, id, { a: String(a), b: String(b) })
      } catch (e) {
        env.cap.settle(hold, undefined)
        throw e
      }
      const charged = (await spendRows(ctx)).filter((x) => !rows0.has(x.id))
      env.cap.settle(hold, used.error === undefined ? (charged.reduce((s, x) => s - x.amount_ulxc, 0) / 1e6) * env.usdPerLXC : undefined)
      for (const x of charged) env.book.add(app.user.workspaceID, -x.amount_ulxc)
      ctx.evidence.push({ note: 'the seller uses their own listing', answer: used.shown, error: used.error })
      if (used.error !== undefined) return fail(`the seller's use of their own listing was refused: ${used.error}`)
      if (!statesNumber(used.shown ?? '', a + b)) return fail(`the listing answered wrong: expected ${a + b}, got "${used.shown}"`)
      // The model it called is the seller's spend as any request is: one row on their ledger, and nothing for the listing.
      if (charged.length !== 1) return fail(`the model the listing called made ${charged.length} spend row(s) on the seller's ledger`)
      const lines = ((await env.lens.marketBill(app.user)).lines ?? []).filter((l) => l.listing_id === id)
      if (lines.length > 0) return fail(`a seller's use of their own listing put ${lines.length} line(s) on their bill: ${JSON.stringify(lines)}`)
      const earned = await env.lens.marketEarnings(app.user)
      ctx.evidence.push({ note: `the seller's earnings before ${JSON.stringify(earned0)}, after ${JSON.stringify(earned)}` })
      if (earned.pending_uses !== earned0.pending_uses || earned.pending_usd_micros !== earned0.pending_usd_micros || earned.lifetime_gross_usd_micros !== earned0.lifetime_gross_usd_micros) {
        return fail(`a seller's use of their own listing earned them: pending ${earned0.pending_uses} → ${earned.pending_uses} uses, ${earned0.pending_usd_micros} → ${earned.pending_usd_micros} µUSD`)
      }
      return { pass: true, detail: `the access key refused for the secret ("${leaked.error}") and not listed; the seller's own use answered ${a + b}, ` +
        'one spend row for the model and nothing on their bill, their earnings unmoved' }
    },
  }
}

export function marketPayoutConnect(): Scenario {
  return {
    id: 'market-payout-connect',
    owner: 'talyvor-lens',
    items: ['B28.276'],
    title: 'a seller connects Stripe on Your listings & earnings to be paid out: the browser goes to Stripe and Lens holds their test-mode Connect account',
    run: async (ctx) => {
      const { env, app } = ctx
      const before = await env.lens.payouts(app.user)
      if (before.account !== null) return fail(`a new test user already has a Stripe account: ${JSON.stringify(before.account)}`)
      const page = await app.tab('/marketplace/selling')
      let went: string
      try {
        const start = page.url()
        await page.getByRole('button', { name: 'Connect with Stripe' }).click({ timeout: ACTION_TIMEOUT_MS })
        await page.waitForURL((u) => u.origin !== new URL(start).origin, { timeout: ACTION_TIMEOUT_MS, waitUntil: 'commit' }).catch(() => undefined)
        went = page.url()
        const refused = page.getByRole('alert')
        if (went.startsWith(new URL(start).origin) && (await refused.count()) > 0) return fail(`Connect with Stripe was refused: ${(await refused.first().innerText()).trim()}`)
      } finally {
        await page.close()
      }
      ctx.evidence.push({ note: `Connect with Stripe went to ${went.split('?')[0]}` })
      const after = await env.lens.payouts(app.user)
      ctx.evidence.push({ note: `the payouts page: ${JSON.stringify(after.account)}` })
      if (after.account === null || !/^acct_/.test(after.account.stripe_account_id)) return fail('the browser went to Stripe, but Lens holds no Stripe account for the seller')
      if (after.account.payouts_enabled) return fail('an account Stripe has not been given details for can already be paid')
      return { pass: true, detail: `sent to Stripe's onboarding; Lens holds ${after.account.stripe_account_id} (${after.account.country}), not yet payable (a payout itself waits for a paid bill and the 14-day holdback — B25.7)` }
    },
  }
}


// ─── B25.8: the slow money, brought due inside the run (Lens B25.7) ──────────

/** A person offers the other company's agent a loan on Agent Wallets and that company accepts: the loan, or why not. */
async function lend(ctx: ScenarioCtx, bank: AgentBankScreen, a: Agent, other: { co: SyntheticUser; agent: { id: string } },
  terms: { principal: number; pct: number; n: number; every: 'day' | 'week' | 'month'; memo: string }): Promise<Loan | string> {
  const said = await bank.offerLoan(a, { to: other.agent.id, ...terms })
  ctx.evidence.push({ note: `Offer ${lxcText(terms.principal)} LXC at ${terms.pct}% over ${terms.n} instalment(s) every ${terms.every}: ${said}` })
  if (!/^Offered/.test(said)) return `offering the loan was refused: "${said}"`
  const l = (await ctx.env.lens.loans(other.co)).find((x) => x.lender_agent_id === a.id && x.status === 'offered')
  if (l === undefined) return `the borrower's company sees no loan offered by ${a.name}`
  const accepted = await ctx.env.lens.answerLoan(other.co, l.id, true)
  ctx.evidence.push({ note: 'the other company accepts', answer: JSON.stringify(accepted) })
  return accepted.ok ? l : `accepting the loan was refused: ${accepted.status} ${accepted.error}`
}

/** The loan as the lender and the borrower each read it. */
async function loanBothSides(ctx: ScenarioCtx, other: { co: SyntheticUser }, id: string): Promise<[Loan | undefined, Loan | undefined]> {
  const got: [Loan | undefined, Loan | undefined] = [(await ctx.env.lens.loans(ctx.app.user)).find((x) => x.id === id), (await ctx.env.lens.loans(other.co)).find((x) => x.id === id)]
  ctx.evidence.push({ note: `the loan as each side reads it: ${JSON.stringify(got)}` })
  return got
}

const kinds = (l: Loan | undefined): string => (l?.events ?? []).map((e) => e.kind).join(',')

export function walletLoanRepay(seed: number, partner: number): Scenario {
  const funded = 5e6
  const principal = 2e6
  const interest = 200_000
  return {
    id: 'wallet-loan-repay',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "a person lends another company's agent on Agent Wallets; its one instalment falls due and Lens's minute tick takes it: principal and interest back in one transfer both companies see, the loan repaid",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      // The borrower already holds the interest, so the instalment can be paid in full.
      const other = await otherCompany(ctx, partner, `Repayer ${seed}`, interest)
      const a = await fundedAgent(ctx, bank, `Creditor ${seed}`, funded)
      if (typeof a === 'string') return fail(a)
      const l = await lend(ctx, bank, a, other, { principal, pct: 10, n: 1, every: 'week', memo: `stock ${seed}` })
      if (typeof l === 'string') return fail(l)
      const due = await env.lens.bringLoanDue(app.user, l.id)
      ctx.evidence.push({ note: 'its instalment, due a week on, brought due now (B25.7)', answer: JSON.stringify(due) })
      if (!due.ok) return fail(`bringing the instalment due was refused: ${due.status} ${due.error}`)
      await until(async () => (await env.lens.loans(app.user)).find((x) => x.id === l.id), (x) => x?.status !== 'active')
      const [lent, borrowed] = await loanBothSides(ctx, other, l.id)
      if (lent?.status !== 'repaid' || borrowed?.status !== 'repaid') {
        return fail(`${TICK_WAIT_MS / 60_000} minutes after its only instalment fell due, the loan reads ${lent?.status ?? 'missing'} to the lender and ${borrowed?.status ?? 'missing'} to the borrower, not repaid`)
      }
      if (kinds(lent) !== 'payout,instalment' || kinds(borrowed) !== 'payout,instalment') return fail(`repaid, the loan's events read ${kinds(lent)} to the lender and ${kinds(borrowed)} to the borrower`)
      const tid = (lent.events ?? [])[1].transfer_id
      const back = (await env.lens.transfers(app.user, a.id)).filter((t) => t.id === tid)
      const went = (await env.lens.transfers(other.co, other.agent.id)).filter((t) => t.id === tid)
      ctx.evidence.push({ note: `the instalment's transfer as each side reads it: ${JSON.stringify([back, went])}` })
      if (back.length !== 1 || went.length !== 1 || back[0].amount_ulxc !== principal + interest || back[0].from_agent_id !== other.agent.id || back[0].to_agent_id !== a.id) {
        return fail(`the instalment's transfer ${tid ?? '(none)'} is on the lender's side ${back.length} time(s) and the borrower's ${went.length}, for ${back[0]?.amount_ulxc} µLXC (want ${principal + interest})`)
      }
      const [x, y] = await balances(ctx, a, other)
      if (x !== funded + interest || y !== 0) return fail(`repaid, ${a.name} holds ${x} µLXC (want ${funded + interest}) and the borrower ${y} (want 0)`)
      return { pass: true, detail: `lent ${lxcText(principal)} LXC at 10%; brought due, the tick took ${lxcText(principal + interest)} LXC in one transfer both companies see, and the loan reads repaid on both sides` }
    }),
  }
}

export function walletLoanDefault(seed: number, partner: number): Scenario {
  const funded = 5e6
  const principal = 2e6
  return {
    id: 'wallet-loan-default',
    owner: 'talyvor-lens',
    agents: 1,
    partners: [partner],
    title: "a loan whose borrower cannot pay: its instalment falls due and is missed, the loan is late; due again and missed again, it is in default on both sides, and nothing more moved",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const other = await otherCompany(ctx, partner, `Defaulter ${seed}`, 0)
      const a = await fundedAgent(ctx, bank, `Backer ${seed}`, funded)
      if (typeof a === 'string') return fail(a)
      const l = await lend(ctx, bank, a, other, { principal, pct: 10, n: 2, every: 'day', memo: `runway ${seed}` })
      if (typeof l === 'string') return fail(l)
      // The borrower's company takes the principal back out of its agent: nothing is left to repay with.
      await env.lens.withdrawAgent(other.co, other.agent.id, principal)
      for (const [n, want] of [[1, 'late'], [2, 'defaulted']] as const) {
        const due = await env.lens.bringLoanDue(app.user, l.id)
        ctx.evidence.push({ note: `the next instalment brought due now, time ${n} (B25.7)`, answer: JSON.stringify(due) })
        if (!due.ok) return fail(`bringing the instalment due (time ${n}) was refused: ${due.status} ${due.error}`)
        const now = await until(async () => (await env.lens.loans(app.user)).find((x) => x.id === l.id),
          (x) => (x?.events ?? []).filter((e) => e.kind === 'missed').length >= n)
        if (now?.status !== want) return fail(`an instalment the borrower cannot pay fell due (time ${n}); ${TICK_WAIT_MS / 60_000} minutes on the loan reads ${now?.status ?? 'missing'} (${kinds(now)}), not ${want}`)
      }
      const [lent, borrowed] = await loanBothSides(ctx, other, l.id)
      const want = 'payout,missed,late,missed,defaulted'
      if (lent?.status !== 'defaulted' || borrowed?.status !== 'defaulted' || kinds(lent) !== want || kinds(borrowed) !== want) {
        return fail(`missed twice, the loan reads ${lent?.status} (${kinds(lent)}) to the lender and ${borrowed?.status} (${kinds(borrowed)}) to the borrower; want defaulted (${want})`)
      }
      const between = (ts: { from_agent_id: string; to_agent_id: string }[], x: string) => ts.filter((t) => t.from_agent_id === x || t.to_agent_id === x)
      const mine = between(await env.lens.transfers(app.user, a.id), other.agent.id)
      const theirs = between(await env.lens.transfers(other.co, other.agent.id), a.id)
      if (mine.length !== 1 || theirs.length !== 1) return fail(`in default, ${mine.length} transfer(s) passed between the two agents on the lender's side and ${theirs.length} on the borrower's; want the payout alone`)
      const [x, y] = await balances(ctx, a, other)
      if (x !== funded - principal || y !== 0) return fail(`in default, ${a.name} holds ${x} µLXC (want ${funded - principal}) and the borrower ${y} (want 0)`)
      return { pass: true, detail: `the borrower emptied its agent; brought due, the instalment was missed and the loan went late; due again, missed again: defaulted on both sides (${want}), only the payout moved` }
    }),
  }
}

export function walletCardPurchase(seed: number): Scenario {
  const funded = 20e6
  const pence = 50
  return {
    id: 'wallet-card-purchase',
    owner: 'talyvor-lens',
    agents: 1,
    title: "an agent pays a merchant with its test card: its rules approve the purchase, Agent Wallets shows it on the card, and exactly what it cost in LXC leaves the agent",
    run: (ctx) => withBank(ctx, async (bank) => {
      const { env, app } = ctx
      const a = await fundedAgent(ctx, bank, `Shopper ${seed}`, funded)
      if (typeof a === 'string') return fail(a)
      const err = await bank.issueCard(a, { first: 'Test', last: 'Shopper', line1: '1 High Street', city: 'London', postcode: 'EC1A 1BB' })
      if (err !== undefined) return fail(`issuing the card was refused: ${err}`)
      const merchant = `Paper Co ${seed}`
      const bought = await env.lens.cardPurchase(app.user, a.id, { amount_minor: pence, currency: 'gbp', merchant })
      ctx.evidence.push({ note: `the agent pays £0.${pence} at ${merchant} with its card (B25.7)`, answer: JSON.stringify(bought) })
      if (!bought.ok) return fail(`the purchase could not be made: ${bought.status} ${bought.error}`)
      if (!bought.value.approved) return fail(`a £0.${pence} purchase by an agent holding ${lxcText(funded)} LXC was declined: ${bought.value.reason}`)
      const cost = bought.value.amount_ulxc
      const held = await env.lens.cardAndPurchases(app.user, a.id)
      ctx.evidence.push({ note: `the card's purchases: ${JSON.stringify(held?.authorizations)}` })
      const rec = (held?.authorizations ?? []).filter((x) => x.authorization_id === bought.value.authorization_id)
      if (rec.length !== 1 || !rec[0].approved || rec[0].amount_minor !== pence || rec[0].currency !== 'gbp' || rec[0].merchant_name !== merchant) {
        return fail(`approved, the purchase is on the card ${rec.length} time(s): ${JSON.stringify(rec)}`)
      }
      const after = await balance(ctx, app.user, a.id)
      if (!(cost > 0) || after !== funded - cost) return fail(`approved at ${cost} µLXC, ${a.name} holds ${after} µLXC, want ${funded - cost}`)
      const shown = await bank.purchases(a)
      ctx.evidence.push({ note: `Agent Wallets → Card: ${JSON.stringify(shown)}` })
      if (!shown.some((r) => r.includes(merchant) && /\bapproved\b/i.test(r))) return fail(`Lens holds the purchase, but the card on Agent Wallets does not show it approved: ${JSON.stringify(shown)}`)
      return { pass: true, detail: `£0.${pence} at ${merchant}: approved by the agent's rules, on the card on the screen, and ${lxcText(cost)} LXC left the agent` }
    }),
  }
}

/**
 * The other company publishes a listing with its own token and the person uses it on its page: the listing,
 * the use's line on the buyer's bill, and the seller — or why not. The use is held against the cap and booked
 * for the ledger read-back, as every charged answer is. `seller` is a run user's index, or a workspace of the scenario's own.
 */
export async function buyFrom(ctx: ScenarioCtx, seller: number | SyntheticUser, seed: number, price: number): Promise<{ id: string; line: BillLine; seller: SyntheticUser } | string> {
  const { env, app } = ctx
  const r = seeded(seed * 47 + 23)
  const [a, b] = [100 + Math.floor(r() * 900), 100 + Math.floor(r() * 900)]
  const template = 'What is {{a}} + {{b}}? Reply with the number only.'
  const model = env.catalog.find((m) => m.display_name === app.modelNameInUse)
  if (model === undefined) throw new Error(`the catalog has no model named "${app.modelNameInUse}"`)
  const co = typeof seller === 'number' ? env.userAt(seller) : seller
  const published = await env.lens.publishListing(co, { title: `Totals ${seed}-${a}`, template, priceULXC: price, model: model.id })
  ctx.evidence.push({ note: `the seller publishes "Totals ${seed}-${a}" at ${lxcText(price)} LXC a use`, answer: JSON.stringify(published) })
  if (!published.ok) return `publishing was refused: ${published.status} ${published.error}`
  const id = published.value.id
  const wrong = await askTotals(ctx, id, model, template, a, b)
  if (wrong !== undefined) return wrong
  const lines = ((await env.lens.marketBill(app.user)).lines ?? []).filter((l) => l.listing_id === id)
  if (lines.length !== 1 || lines[0].price_ulxc !== price) return `one use put ${lines.length} line(s) on the buyer's bill: ${JSON.stringify(lines)}`
  return { id, line: lines[0], seller: co }
}

/**
 * The person uses the "What is {{a}} + {{b}}" listing `id` on its page, held against the cap and booked for the ledger
 * read-back, as every charged answer is: undefined when it answered a + b, else why not.
 */
async function askTotals(ctx: ScenarioCtx, id: string, model: ScenarioCtx['env']['catalog'][number], template: string, a: number, b: number): Promise<string | undefined> {
  const { env, app } = ctx
  const rows0 = new Set((await spendRows(ctx)).map((x) => x.id))
  const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(template.length + 8), USE_MAX_TOKENS))
  let used
  try {
    used = await runListing(app, id, { a: String(a), b: String(b) })
  } catch (e) {
    env.cap.settle(hold, undefined)
    throw e
  }
  const charged = (await spendRows(ctx)).filter((x) => !rows0.has(x.id))
  env.cap.settle(hold, used.error === undefined ? (charged.reduce((s, x) => s - x.amount_ulxc, 0) / 1e6) * env.usdPerLXC : undefined)
  for (const x of charged) env.book.add(app.user.workspaceID, -x.amount_ulxc)
  ctx.evidence.push({ note: 'the buyer uses it', answer: used.shown, error: used.error })
  if (used.error !== undefined) return `the use was refused: ${used.error}`
  if (!statesNumber(used.shown ?? '', a + b)) return `the listing answered wrong: expected ${a + b}, got "${used.shown}"`
  return undefined
}

/** The buyer's bill paid now (B25.7), tried until Lens has metered the use (within a minute): the bill, or why not. */
export async function payBill(ctx: ScenarioCtx): Promise<PaidTestBill | string> {
  // B35.8 — Lens meters a use within a minute; until it has, paying is refused with a 409. A use not metered by the limit is the FAIL.
  const paid = await until(() => ctx.env.lens.payTestBill(ctx.app.user), (x) => x.ok || x.status !== 409, METER_WAIT_MS)
  ctx.evidence.push({ note: "the buyer's bill paid now (B25.7)", answer: JSON.stringify(paid) })
  if (!paid.ok && paid.status === 409) return `the use was not metered ${METER_WAIT_MS / 1000} s on, so the buyer's bill could not be paid: 409 ${paid.error}`
  if (!paid.ok) return `paying the buyer's bill was refused: ${paid.status} ${paid.error}`
  if (paid.value.uses_cleared !== 1) return `paying a bill of one use cleared ${paid.value.uses_cleared}`
  return paid.value
}

/** Both sides of a paid bill: the buyer's line cleared, and the seller's share of it payable now. */
export async function clearedBothSides(ctx: ScenarioCtx, bought: { line: BillLine; seller: SyntheticUser }): Promise<{ share: number; earned: MarketEarnings } | string> {
  const line = ((await ctx.env.lens.marketBill(ctx.app.user)).lines ?? []).find((l) => l.use_id === bought.line.use_id)
  const earned = await ctx.env.lens.marketEarnings(bought.seller)
  const e = (earned.earnings ?? []).find((x) => x.use_id === bought.line.use_id)
  ctx.evidence.push({ note: `paid: the buyer's line ${JSON.stringify(line)}; the seller's earning ${JSON.stringify(e)}, available ${earned.available_usd_micros} µUSD` })
  if (line?.cleared_at === undefined) return "the bill was paid, but the use does not read paid on the buyer's bill"
  if (e === undefined || !(e.share_usd_micros > 0)) return 'the bill was paid, but the seller has no earning from the use'
  if (Date.parse(e.payable_at) > Date.now() || earned.available_usd_micros < e.share_usd_micros) {
    return `paid a holdback ago, the seller's ${e.share_usd_micros} µUSD is payable ${e.payable_at} with ${earned.available_usd_micros} µUSD available`
  }
  return { share: e.share_usd_micros, earned }
}

/** Your listings & earnings → Take … as credits, as the seller; what the Payouts card then says. */
async function takeAsCredits(ctx: ScenarioCtx, seller: number): Promise<string> {
  const sellerApp = await ctx.env.signInUser(seller)
  try {
    const page = await sellerApp.tab('/marketplace/selling')
    const c = card(page, 'Payouts')
    await c.getByRole('button', { name: /^Take .* as credits$/ }).click({ timeout: ACTION_TIMEOUT_MS })
    const note = c.getByRole('status').filter({ hasText: /credits\.$/ }).or(c.getByRole('alert')).first()
    await note.waitFor({ timeout: ACTION_TIMEOUT_MS })
    return (await note.innerText()).trim()
  } finally {
    await sellerApp.close()
  }
}

export function marketPayout(seed: number, seller: number): Scenario {
  const price = 1_000_000
  return {
    id: 'market-payout',
    owner: 'talyvor-lens',
    title: "a buyer uses another company's listing and pays the bill; past the holdback, the seller takes the earnings as credits on Your listings & earnings: one credits payout, its credits in the seller's workspace, nothing left available",
    run: async (ctx) => {
      const { env } = ctx
      const bought = await buyFrom(ctx, seller, seed, price)
      if (typeof bought === 'string') return fail(bought)
      const paid = await payBill(ctx)
      if (typeof paid === 'string') return fail(paid)
      const cleared = await clearedBothSides(ctx, bought)
      if (typeof cleared === 'string') return fail(cleared)
      const gross = cleared.earned.available_usd_micros
      const payouts0 = new Set(((await env.lens.payouts(bought.seller)).payouts ?? []).map((p) => p.id))
      const rows0 = new Set((await env.lens.ledger(bought.seller)).map((x) => x.id))
      const said = await takeAsCredits(ctx, seller)
      ctx.evidence.push({ note: `the seller: Take as credits: ${said}` })
      if (!/credits\.$/.test(said)) return fail(`taking the earnings as credits was refused: "${said}"`)
      const made = ((await env.lens.payouts(bought.seller)).payouts ?? []).filter((p) => !payouts0.has(p.id))
      // The seller's own lanes keep writing its ledger meanwhile (a question's spend, an agent's cash-out),
      // so only the new rows that name a market payout are this payout's.
      const credited = (await env.lens.ledger(bought.seller)).filter((x) => !rows0.has(x.id) && x.metadata?.market_payout_id !== undefined)
      ctx.evidence.push({ note: `the seller's new payouts ${JSON.stringify(made)}; new payout rows on its ledger ${JSON.stringify(credited)}` })
      if (made.length !== 1 || made[0].method !== 'credits' || made[0].gross_usd_micros !== gross || made[0].credits_ulxc !== gross * 10 || made[0].paid_at === undefined) {
        return fail(`taking ${gross} µUSD as credits made ${made.length} payout(s): ${JSON.stringify(made)}`)
      }
      if (credited.length !== 1 || credited[0].metadata?.market_payout_id !== made[0].id || credited[0].amount_ulxc !== made[0].credits_ulxc) {
        return fail(`a ${made[0].credits_ulxc} µLXC credits payout ${made[0].id} put ${credited.length} payout row(s) on the seller's ledger: ${JSON.stringify(credited)}`)
      }
      const after = await env.lens.marketEarnings(bought.seller)
      if (after.available_usd_micros !== 0 || after.paid_out_usd_micros !== (cleared.earned.paid_out_usd_micros ?? 0) + gross) {
        return fail(`paid out, the seller has ${after.available_usd_micros} µUSD available (want 0) and ${after.paid_out_usd_micros} paid out (want ${(cleared.earned.paid_out_usd_micros ?? 0) + gross})`)
      }
      return { pass: true, detail: `used (one ${lxcText(price)} LXC line), the bill paid: the line reads paid and the seller's ${cleared.share} µUSD share is payable; taken as credits on the screen: one credits payout of ${gross} µUSD, ${lxcText(gross * 10)} LXC on the seller's ledger, nothing left available` }
    },
  }
}

export function marketBillRefund(seed: number, seller: number): Scenario {
  const price = 1_000_000
  return {
    id: 'market-bill-refund',
    owner: 'talyvor-lens',
    title: "a buyer's paid marketplace bill is refunded (Stripe's charge.refunded): the use reads refunded on the buyer's bill, and the seller's earning from it is reversed",
    run: async (ctx) => {
      const { env, app } = ctx
      const bought = await buyFrom(ctx, seller, seed, price)
      if (typeof bought === 'string') return fail(bought)
      const paid = await payBill(ctx)
      if (typeof paid === 'string') return fail(paid)
      const cleared = await clearedBothSides(ctx, bought)
      if (typeof cleared === 'string') return fail(cleared)
      const back = await env.lens.refundTestBill(app.user, paid.invoice_id)
      ctx.evidence.push({ note: `the paid bill ${paid.invoice_id} refunded (B25.7)`, answer: JSON.stringify(back) })
      if (!back.ok) return fail(`refunding the paid bill was refused: ${back.status} ${back.error}`)
      if (back.value.uses_refunded !== 1) return fail(`refunding a bill of one use refunded ${back.value.uses_refunded}`)
      const bill = await env.lens.marketBill(app.user)
      const line = (bill.lines ?? []).find((l) => l.use_id === bought.line.use_id)
      ctx.evidence.push({ note: `the buyer's bill: refunded ${bill.refunded_ulxc}; the line ${JSON.stringify(line)}` })
      if (line?.refunded_at === undefined || (bill.refunded_ulxc ?? 0) < price) return fail(`refunded, the use reads ${line?.refunded_at === undefined ? 'not refunded' : 'refunded'} on the buyer's bill, which refunds ${bill.refunded_ulxc ?? 0} µLXC`)
      const earned = await env.lens.marketEarnings(bought.seller)
      const e = (earned.earnings ?? []).find((x) => x.use_id === bought.line.use_id)
      ctx.evidence.push({ note: `the seller's earning ${JSON.stringify(e)}; available ${earned.available_usd_micros}, refunded ${earned.refunded_usd_micros} µUSD` })
      if (e?.refunded_at === undefined || earned.refunded_usd_micros !== (cleared.earned.refunded_usd_micros ?? 0) + cleared.share
        || earned.available_usd_micros !== cleared.earned.available_usd_micros - cleared.share) {
        return fail(`refunded, the seller's ${cleared.share} µUSD earning was not reversed: available ${cleared.earned.available_usd_micros} → ${earned.available_usd_micros}, refunded ${cleared.earned.refunded_usd_micros ?? 0} → ${earned.refunded_usd_micros ?? 0}`)
      }
      return { pass: true, detail: `used and paid, then the bill refunded: the use reads refunded on the buyer's bill, and the seller's ${cleared.share} µUSD share is reversed out of what is available` }
    },
  }
}

/** What the seller's journal says, in a sentence. */
const journalText = (j: MarketJournal): string =>
  `${j.holdback_usd_micros} µUSD in holdback (${j.due_for_release_usd_micros} of it due for release), ${j.available_usd_micros} available, reconciled ${String(j.reconciled)}`

/**
 * B32.75 — a test sale's earning is released on the seller's journal (Lens B32.17) and reconciles. The seller is a
 * workspace the scenario makes, so its journal holds this sale alone; the buyer is the scenario's own workspace, so
 * paying its whole bill clears this use alone.
 */
export function marketJournal(seed: number): Scenario {
  const price = 1_000_000
  return {
    id: 'market-journal',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: "a buyer's paid bill puts the seller's share in holdback on the seller's journal, Lens's release job moves it to available, " +
      'and the journal reconciles: its available is the earning, as the seller\'s earnings state it',
    run: async (ctx) => {
      const { env } = ctx
      const [seller] = await env.lens.createUsers(1)
      const j0 = await env.lens.marketJournal(seller)
      ctx.evidence.push({ note: `a new seller's journal: ${journalText(j0)}` })
      const bought = await buyFrom(ctx, seller, seed, price)
      if (typeof bought === 'string') return fail(bought)
      const paid = await payBill(ctx)
      if (typeof paid === 'string') return fail(paid)
      const cleared = await clearedBothSides(ctx, bought)
      if (typeof cleared === 'string') return fail(cleared)
      // The earning row: the seller's share of the use, at the take Lens states (B32.8).
      const take = env.fees.market_take_bps
      const share = keptOf(price / ULXC_PER_USD_MICRO, take)
      if (cleared.share !== share) return fail(`the seller's earning from the use is ${cleared.share} µUSD; their ${percent(10_000 - take)} of a ${price / ULXC_PER_USD_MICRO} µUSD use is ${share}`)
      // Paid one holdback ago, the earning is due at once: on the journal it is due for release, or already released.
      const j1 = await env.lens.marketJournal(seller)
      ctx.evidence.push({ note: `the seller's journal right after the bill was paid: ${journalText(j1)}` })
      if (!j1.reconciled) return fail(`right after the bill was paid, the seller's journal does not reconcile with their earnings and payouts: ${journalText(j1)}`)
      const due = j1.holdback_usd_micros === share && j1.due_for_release_usd_micros === share && j1.available_usd_micros === 0
      const released = j1.holdback_usd_micros === 0 && j1.due_for_release_usd_micros === 0 && j1.available_usd_micros === share
      if (!due && !released) return fail(`right after the bill was paid, the seller's ${share} µUSD share is neither due for release nor available on the journal: ${journalText(j1)}`)
      const t0 = Date.now()
      const j2 = await until(() => env.lens.marketJournal(seller), (j) => j.holdback_usd_micros === 0, RELEASE_WAIT_MS)
      const waited = Math.round((Date.now() - t0) / 1000)
      ctx.evidence.push({ note: `the seller's journal ${waited} s on: ${journalText(j2)}` })
      if (j2.holdback_usd_micros !== 0) return fail(`${RELEASE_WAIT_MS / 60_000} minutes after the bill was paid, the seller's due ${share} µUSD is still in the journal's holdback: ${journalText(j2)}`)
      const earned = await env.lens.marketEarnings(seller)
      const e = (earned.earnings ?? []).find((x) => x.use_id === bought.line.use_id)
      ctx.evidence.push({ note: `the seller's earnings: the earning ${JSON.stringify(e)}, available ${earned.available_usd_micros} µUSD` })
      if (e?.share_usd_micros !== share) return fail(`released, the seller's earning from the use reads ${JSON.stringify(e)}; their share is ${share} µUSD`)
      if (j2.available_usd_micros !== earned.available_usd_micros) {
        return fail(`released, the seller's journal holds ${j2.available_usd_micros} µUSD available; their earnings state ${earned.available_usd_micros} µUSD available`)
      }
      if (j2.available_usd_micros !== share) return fail(`released, the seller's journal holds ${j2.available_usd_micros} µUSD available; the one earning is ${share} µUSD`)
      if (!j2.reconciled) return fail(`released, the seller's journal does not reconcile with their earnings and payouts: ${journalText(j2)}`)
      return { pass: true, detail: `the bill paid, the seller's ${share} µUSD share was ${due ? 'due for release in the journal\'s holdback' : 'already released'}; ` +
        `${waited} s on, the holdback is 0 and the journal's available is ${share} µUSD, the earning and the earnings' available, and it reconciles` }
    },
  }
}

/**
 * B32.76 — what is wrong with a listing's offers as a buyer reads them (Lens B32.18): each of `want` there on the terms it
 * was published with and saying what its licence allows, and no other.
 */
export function offerFaults(got: readonly MarketOffer[], want: readonly MarketOffer[]): string[] {
  const wrong: string[] = []
  for (const w of want) {
    const what = `the ${w.licence} ${w.kind} offer`
    const o = got.find((x) => x.kind === w.kind && x.licence === w.licence)
    if (o === undefined) {
      wrong.push(`${what} is missing`)
      continue
    }
    if (o.price_usd_micros !== w.price_usd_micros) wrong.push(`${what} is ${o.price_usd_micros} µUSD; it was published at ${w.price_usd_micros}`)
    if (w.period_days !== undefined && o.period_days !== w.period_days) wrong.push(`${what} runs ${String(o.period_days)} days; it was published for ${w.period_days}`)
    if (w.included_uses !== undefined && o.included_uses !== w.included_uses) wrong.push(`${what} includes ${String(o.included_uses)} uses; it was published with ${w.included_uses}`)
    if ((o.terms ?? '').trim() === '') wrong.push(`${what} does not say what its licence allows`)
  }
  if (got.length !== want.length) wrong.push(`the listing has ${got.length} offers; it was published with ${want.length}`)
  return wrong
}

/**
 * B32.76 — a listing sold through four offers, and a price change that bills only the next use (Lens B32.18). The seller is
 * a workspace the scenario makes; the buyer is the scenario's own workspace, so its bill holds this listing's uses alone.
 */
export function marketOffers(seed: number): Scenario {
  const before = 100_000
  const after = 150_000
  const rent: MarketOffer = { kind: 'rent', licence: 'commercial', price_usd_micros: 1_500_000, period_days: 30 }
  const offers: MarketOffer[] = [
    { kind: 'per_use', licence: 'commercial', price_usd_micros: before },
    rent,
    { kind: 'buy', licence: 'commercial', price_usd_micros: 5_000_000 },
    { kind: 'subscribe', licence: 'commercial', price_usd_micros: 2_000_000, period_days: 30, included_uses: 100 },
  ]
  return {
    id: 'market-offers',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: 'a listing published with a per-use, a 30-day rent, a buy and a 30-day subscription with 100 uses shows the buyer all four with what each licence allows; ' +
      "a second commercial rent is refused; the seller raises the per-use price between two uses, and the buyer's bill keeps the first at its old price and bills the second at the new",
    run: async (ctx) => {
      const { env, app } = ctx
      const r = seeded(seed * 53 + 29)
      const [a1, b1, a2, b2] = [0, 1, 2, 3].map(() => 100 + Math.floor(r() * 900))
      const template = 'What is {{a}} + {{b}}? Reply with the number only.'
      const model = env.catalog.find((m) => m.display_name === app.modelNameInUse)
      if (model === undefined) throw new Error(`the catalog has no model named "${app.modelNameInUse}"`)
      const [seller] = await env.lens.createUsers(1)
      const title = `Offers ${seed}-${RUN_SALT}`
      const pub = await env.lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title, description: '', visibility: 'public',
        artifact: { template, model: model.id }, changelog: '', offers })
      ctx.evidence.push({ note: `the seller publishes "${title}" with a per-use, a rent, a buy and a subscription offer`, answer: JSON.stringify(pub) })
      if (!pub.ok) return fail(`publishing with four offers was refused: ${pub.status} ${pub.error}`)
      const id = pub.value.id
      if (pub.value.review_status !== 'approved') {
        // B32.46 — a listing like another night's is held for review, hidden from the buyer; a person approves it.
        if (!env.lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
        const ok = await env.lens.moderate(id, 'approve')
        ctx.evidence.push({ note: `the listing was ${pub.value.review_status}; the operator approves it`, answer: JSON.stringify(ok) })
        if (!ok.ok) return fail(`approving the held listing ${id}: ${ok.status} ${ok.error}`)
      }

      const read = () => env.lens.act<{ offers: MarketOffer[] | null }>(app.user, 'GET', `/v1/marketplace/listings/${id}`)
      const seen = await read()
      ctx.evidence.push({ note: "the buyer reads the listing's offers", answer: JSON.stringify(seen.ok ? seen.value.offers : seen) })
      if (!seen.ok) return fail(`the buyer reading the listing: ${seen.status} ${seen.error}`)
      const unseen = offerFaults(seen.value.offers ?? [], offers)
      if (unseen.length > 0) return fail(`the buyer reads the listing's offers wrong: ${unseen.join('; ')}`)

      const put = (set: MarketOffer[]) => env.lens.act<{ offers: MarketOffer[] }>(seller, 'PUT', `/v1/workspaces/{ws}/marketplace/listings/${id}/offers`, { offers: set })
      const twice = await put([...offers, { ...rent, price_usd_micros: 1_200_000, period_days: 7 }])
      ctx.evidence.push({ note: 'the seller sets a second commercial rent beside the first', answer: JSON.stringify(twice) })
      if (twice.ok || twice.status !== 400) {
        return fail(`a second active commercial rent offer should be refused with 400; Lens answered ${twice.status}: ${twice.ok ? JSON.stringify(twice.value) : twice.error}`)
      }
      const kept = await read()
      const changed = kept.ok ? offerFaults(kept.value.offers ?? [], offers) : [`the buyer reading the listing: ${kept.status} ${kept.error}`]
      if (changed.length > 0) return fail(`refused, the second rent still changed the listing's offers: ${changed.join('; ')}`)

      const bill = async () => ((await env.lens.marketBill(app.user)).lines ?? []).filter((l) => l.listing_id === id)
      const used1 = await askTotals(ctx, id, model, template, a1, b1)
      if (used1 !== undefined) return fail(used1)
      const bill1 = await bill()
      ctx.evidence.push({ note: "the buyer's bill after the first use", answer: JSON.stringify(bill1) })
      if (bill1.length !== 1 || bill1[0].price_ulxc !== before * ULXC_PER_USD_MICRO) {
        return fail(`a use at ${before} µUSD should be one line of ${before * ULXC_PER_USD_MICRO} µLXC on the buyer's bill; it has ${JSON.stringify(bill1)}`)
      }
      const first = bill1[0]

      const raised = await put(offers.map((o) => (o.kind === 'per_use' ? { ...o, price_usd_micros: after } : o)))
      ctx.evidence.push({ note: `the seller raises the per-use price to ${after} µUSD`, answer: JSON.stringify(raised) })
      const perUse = raised.ok ? raised.value.offers.find((o) => o.kind === 'per_use' && o.licence === 'commercial') : undefined
      if (perUse?.price_usd_micros !== after) return fail(`raising the per-use price to ${after} µUSD: ${raised.ok ? JSON.stringify(raised.value) : `${raised.status} ${raised.error}`}`)

      const used2 = await askTotals(ctx, id, model, template, a2, b2)
      if (used2 !== undefined) return fail(used2)
      const bill2 = await bill()
      ctx.evidence.push({ note: "the buyer's bill after the second use", answer: JSON.stringify(bill2) })
      const again = bill2.find((l) => l.use_id === first.use_id)
      const next = bill2.filter((l) => l.use_id !== first.use_id)
      if (again === undefined || next.length !== 1) return fail(`two uses should be two lines on the buyer's bill; it has ${JSON.stringify(bill2)}`)
      if (again.price_ulxc !== first.price_ulxc) return fail(`after the price change, the first use reads ${again.price_ulxc} µLXC on the bill; it was billed ${first.price_ulxc}`)
      if (next[0].price_ulxc !== after * ULXC_PER_USD_MICRO) {
        return fail(`the use after the price change is billed ${next[0].price_ulxc} µLXC; the per-use price is now ${after} µUSD, ${after * ULXC_PER_USD_MICRO} µLXC`)
      }
      return { pass: true, detail: `the buyer read all four offers with their licence terms; a second commercial rent was refused 400 and changed nothing; ` +
        `the first use is billed ${first.price_ulxc} µLXC and stays so, and the use after the seller raised the price to ${after} µUSD is billed ${next[0].price_ulxc} µLXC` }
    },
  }
}

/**
 * B32.78 — a listing rented, used under the licence, and an agent key a personal licence does not cover (Lens B32.19). The
 * seller is a workspace the scenario makes; the buyer is the scenario's own workspace, so its bill holds these listings'
 * lines alone. A rent lasts a day at the shortest, so one run sees when it ends, not the end itself.
 */
export function marketRent(seed: number): Scenario {
  const perUse = 100_000
  const rentPrice = 1_500_000
  const personalPrice = 500_000
  const days = 30
  const uses = 3
  const fund = 2_000_000
  return {
    id: 'market-rent',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Marketplace',
    title: `a buyer rents a listing for ${days} days with an Idempotency-Key, and the same request again answers the same licence and buys nothing; ` +
      `${uses} uses under it put nothing on the bill beside the rent, and the licence reads active with ${uses} uses covered until its end; ` +
      "an agent's key in the same workspace, which holds only a personal licence to another listing, is billed per use",
    run: async (ctx) => {
      const { env, app } = ctx
      const r = seeded(seed * 59 + 31)
      const sums = Array.from({ length: uses + 1 }, () => [100 + Math.floor(r() * 900), 100 + Math.floor(r() * 900)] as const)
      const template = 'What is {{a}} + {{b}}? Reply with the number only.'
      const model = env.catalog.find((m) => m.display_name === app.modelNameInUse)
      if (model === undefined) throw new Error(`the catalog has no model named "${app.modelNameInUse}"`)
      const [seller] = await env.lens.createUsers(1)

      // The seller publishes with its offers; the buyer reads them back, with the ids a licence is bought on.
      const publish = async (title: string, offers: MarketOffer[]): Promise<{ id: string; offers: MarketOffer[] } | string> => {
        const pub = await env.lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title, description: '', visibility: 'public',
          artifact: { template, model: model.id }, changelog: '', offers })
        ctx.evidence.push({ note: `the seller publishes "${title}" with ${offers.map((o) => `a ${o.licence} ${o.kind}`).join(' and ')}`, answer: JSON.stringify(pub) })
        if (!pub.ok) return `publishing "${title}" was refused: ${pub.status} ${pub.error}`
        if (pub.value.review_status !== 'approved') {
          // B32.46 — a listing like another night's is held for review, hidden from the buyer; a person approves it.
          if (!env.lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
          const ok = await env.lens.moderate(pub.value.id, 'approve')
          if (!ok.ok) return `approving the held listing ${pub.value.id}: ${ok.status} ${ok.error}`
        }
        const read = await env.lens.act<{ offers: MarketOffer[] | null }>(app.user, 'GET', `/v1/marketplace/listings/${pub.value.id}`)
        if (!read.ok) return `the buyer reading "${title}": ${read.status} ${read.error}`
        return { id: pub.value.id, offers: read.value.offers ?? [] }
      }
      const license = (listing: string, offer: string, key: string) =>
        env.lens.act<MarketLicence>(app.user, 'POST', `/v1/workspaces/{ws}/marketplace/listings/${listing}/licences`, { offer_id: offer }, { 'Idempotency-Key': key })
      const billFor = async (listing: string) => ((await env.lens.marketBill(app.user)).lines ?? []).filter((l) => l.listing_id === listing)
      // A use on Lens with `credential` (the person's token, or an agent's key), held against the cap and booked for the ledger
      // read-back: Lens's answer, or why not.
      const runAs = async (credential: string, who: string, listing: string, [a, b]: readonly [number, number]): Promise<{ id: string; charge: string } | string> => {
        const rows0 = new Set((await spendRows(ctx)).map((x) => x.id))
        const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(template.length + 8), USE_MAX_TOKENS))
        let used
        try {
          used = await env.lens.as(credential, 'POST', `/v1/workspaces/${app.user.workspaceID}/marketplace/listings/${listing}/use`, { variables: { a: String(a), b: String(b) } })
        } catch (e) {
          env.cap.settle(hold, undefined)
          throw e
        }
        const charged = (await spendRows(ctx)).filter((x) => !rows0.has(x.id))
        env.cap.settle(hold, used.status === 200 ? (charged.reduce((t, x) => t - x.amount_ulxc, 0) / 1e6) * env.usdPerLXC : undefined)
        for (const x of charged) env.book.add(app.user.workspaceID, -x.amount_ulxc)
        ctx.evidence.push({ note: `${who} uses it`, answer: `${used.status} ${used.text.slice(0, 300)}` })
        if (used.status !== 200) return `${who}'s use was refused: ${used.status} ${used.text.slice(0, 200)}`
        const u = JSON.parse(used.text) as { id: string; charge: string; output?: string }
        if (!statesNumber(u.output ?? '', a + b)) return `the listing answered ${who} wrong: expected ${a + b}, got "${u.output}"`
        return u
      }

      const rented = await publish(`Rented ${seed}-${RUN_SALT}`, [{ kind: 'per_use', licence: 'commercial', price_usd_micros: perUse },
        { kind: 'rent', licence: 'commercial', price_usd_micros: rentPrice, period_days: days }])
      if (typeof rented === 'string') return fail(rented)
      const rent = rented.offers.find((o) => o.kind === 'rent' && o.licence === 'commercial')
      if (rent?.id === undefined) return fail(`the buyer cannot see the listing's commercial rent offer: ${JSON.stringify(rented.offers)}`)

      // Rented, then the same request again — a retry, as a client whose answer was lost sends it.
      const key = randomUUID()
      const bought = await license(rented.id, rent.id, key)
      ctx.evidence.push({ note: `the buyer rents it for ${days} days`, answer: JSON.stringify(bought) })
      if (!bought.ok || bought.status !== 201) return fail(`renting the listing should answer 201 with the licence; Lens answered ${bought.status}: ${bought.ok ? JSON.stringify(bought.value) : bought.error}`)
      const lic = bought.value
      const replay = await license(rented.id, rent.id, key)
      ctx.evidence.push({ note: 'the same rent, sent again with its Idempotency-Key', answer: JSON.stringify(replay) })
      if (!replay.ok || replay.status !== 200 || replay.value.id !== lic.id) {
        return fail(`the rent sent again with its Idempotency-Key should answer 200 with licence ${lic.id}; Lens answered ${replay.status}: ${replay.ok ? JSON.stringify(replay.value) : replay.error}`)
      }
      const rentLine = await billFor(rented.id)
      ctx.evidence.push({ note: "the buyer's bill after the rent and its replay", answer: JSON.stringify(rentLine) })
      if (rentLine.length !== 1 || rentLine[0].use_id !== lic.use_id || rentLine[0].price_ulxc !== rentPrice * ULXC_PER_USD_MICRO) {
        return fail(`a rent at ${rentPrice} µUSD, sent twice with one key, should be one line of ${rentPrice * ULXC_PER_USD_MICRO} µLXC on the bill; it has ${JSON.stringify(rentLine)}`)
      }

      // B32.57 — the first use is made on the listing's page, as a person makes it, and the page says the rent covered it.
      const [pa, pb] = sums[0]
      const rows0 = new Set((await spendRows(ctx)).map((x) => x.id))
      const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(template.length + 8), USE_MAX_TOKENS))
      let onPage
      try {
        onPage = await runListing(app, rented.id, { a: String(pa), b: String(pb) })
      } catch (e) {
        env.cap.settle(hold, undefined)
        throw e
      }
      const charged = (await spendRows(ctx)).filter((x) => !rows0.has(x.id))
      env.cap.settle(hold, onPage.error === undefined ? (charged.reduce((t, x) => t - x.amount_ulxc, 0) / 1e6) * env.usdPerLXC : undefined)
      for (const x of charged) env.book.add(app.user.workspaceID, -x.amount_ulxc)
      ctx.evidence.push({ note: "the buyer uses it on the listing's page", answer: onPage.shown, error: onPage.error })
      if (onPage.error !== undefined) return fail(`the buyer's use on the listing's page was refused: ${onPage.error}`)
      if (!statesNumber(onPage.shown ?? '', pa + pb)) return fail(`the listing answered the buyer's page wrong: expected ${pa + pb}, got "${onPage.shown}"`)
      if (!(onPage.shown ?? '').includes('Covered by your licence')) return fail(`the listing's page should say the rent covered the use; it showed "${onPage.shown}"`)
      for (const sum of sums.slice(1, uses)) {
        const u = await runAs(app.user.token, 'the buyer', rented.id, sum)
        if (typeof u === 'string') return fail(u)
      }
      const after = await billFor(rented.id)
      ctx.evidence.push({ note: `the buyer's bill after ${uses} uses under the licence`, answer: JSON.stringify(after) })
      const billedUses = after.filter((l) => l.use_id !== lic.use_id)
      if (billedUses.length > 0) return fail(`${billedUses.length} of ${uses} uses the rent covers are on the buyer's bill: ${JSON.stringify(billedUses)}`)
      if (after.length !== 1) return fail(`the rent's line is no longer on the bill: ${JSON.stringify(after)}`)

      const held = await env.lens.act<{ licences: MarketLicence[] | null }>(app.user, 'GET', '/v1/workspaces/{ws}/marketplace/licences')
      ctx.evidence.push({ note: "the buyer's licences", answer: JSON.stringify(held) })
      if (!held.ok) return fail(`reading the buyer's licences: ${held.status} ${held.error}`)
      const mine = (held.value.licences ?? []).filter((x) => x.listing_id === rented.id)
      if (mine.length !== 1) return fail(`the buyer should hold one licence to the rented listing; it holds ${mine.length}: ${JSON.stringify(mine)}`)
      const [l] = mine
      if (l.id !== lic.id || l.status !== 'active' || l.kind !== 'rent' || l.licence !== 'commercial') return fail(`the rent should read active, a commercial rent, as ${lic.id}: ${JSON.stringify(l)}`)
      if (l.uses_covered !== uses) return fail(`the rent covered ${uses} uses; it reads uses_covered ${l.uses_covered}`)
      const ends = l.ends_at === null ? NaN : Date.parse(l.ends_at) - Date.parse(l.starts_at)
      if (!(Math.abs(ends - days * DAY_MS) < 60_000)) return fail(`a ${days}-day rent should end ${days} days after it starts; it runs ${l.starts_at} to ${String(l.ends_at)}`)

      // An agent's key, in a workspace that holds only a personal licence to the listing: it pays per use.
      const personal = await publish(`Personal ${seed}-${RUN_SALT}`, [{ kind: 'per_use', licence: 'commercial', price_usd_micros: perUse },
        { kind: 'rent', licence: 'personal', price_usd_micros: personalPrice, period_days: days }])
      if (typeof personal === 'string') return fail(personal)
      const mineOnly = personal.offers.find((o) => o.kind === 'rent' && o.licence === 'personal')
      if (mineOnly?.id === undefined) return fail(`the buyer cannot see the listing's personal rent offer: ${JSON.stringify(personal.offers)}`)
      const own = await license(personal.id, mineOnly.id, randomUUID())
      ctx.evidence.push({ note: 'the buyer rents the second listing under a personal licence', answer: JSON.stringify(own) })
      if (!own.ok || own.value.licence !== 'personal') return fail(`renting a personal licence: ${own.status} ${own.ok ? JSON.stringify(own.value) : own.error}`)
      const agent = await env.lens.createAgent(app.user, `Renter ${RUN_SALT}`)
      const k = await env.lens.act<{ key: string }>(app.user, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'market-rent' })
      if (!k.ok) return fail(`issuing ${agent.name} a key was refused: ${k.status} ${k.error}`)
      await env.lens.fundAgent(app.user, agent.id, fund)
      const use = await runAs(k.value.key, `${agent.name}'s key`, personal.id, sums[uses])
      if (typeof use === 'string') return fail(use)
      const lines = await billFor(personal.id)
      ctx.evidence.push({ note: "the second listing's lines on the buyer's bill", answer: JSON.stringify(lines) })
      const line = lines.find((x) => x.use_id === use.id)
      if (use.charge !== 'billed' || line === undefined) {
        return fail(`a personal licence never covers an agent's key, so its use should be billed per use; Lens charged it "${use.charge}" and the bill has ${JSON.stringify(lines)}`)
      }
      if (line.price_ulxc !== perUse * ULXC_PER_USD_MICRO || line.agent_id !== agent.id) {
        return fail(`the agent's use should be one line of ${perUse * ULXC_PER_USD_MICRO} µLXC for ${agent.id}; the bill has ${JSON.stringify(line)}`)
      }
      return { pass: true, detail: `a ${days}-day rent bought once (the replay answered licence ${lic.id}) is one ${rentPrice * ULXC_PER_USD_MICRO} µLXC line; ` +
        `${uses} uses under it added none, and it reads active with ${uses} uses covered until ${String(l.ends_at)}; ` +
        `the agent's key, beside a personal licence only, was billed ${line.price_ulxc} µLXC for its use` }
    },
  }
}

/** B32.79 — one use of a listing as Lens answers it, with what B32.21 says of a trial. */
interface TrialUse {
  id: string
  charge: string
  price_ulxc: number
  output?: string
  trial?: boolean
  trial_uses_left?: number
  would_have_cost_usd_micros?: number
}

/**
 * B32.79 — a listing's free trial uses, on test money (Lens B32.21). The seller is a workspace the scenario makes; the
 * buyer is the scenario's own workspace, so its bill holds this listing's uses alone. Each trial is free and says what it
 * would have cost; the use after the last is billed, and once the bill is paid only that one has earned the seller anything.
 */
export function marketTrial(seed: number): Scenario {
  const perUse = 100_000
  const trials = 3
  return {
    id: 'market-trial',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Marketplace',
    title: `a listing's per-use offer gives ${trials} trial uses: each of the buyer's first ${trials} answers trial with one fewer left and what it would have cost, ` +
      "the use after them is billed at the offer's price, the buyer's bill holds that one line alone, and once the bill is paid no trial use has earned the seller anything",
    run: async (ctx) => {
      const { env, app } = ctx
      const r = seeded(seed * 61 + 37)
      const sums = Array.from({ length: trials + 1 }, () => [100 + Math.floor(r() * 900), 100 + Math.floor(r() * 900)] as const)
      const template = 'What is {{a}} + {{b}}? Reply with the number only.'
      const model = env.catalog.find((m) => m.display_name === app.modelNameInUse)
      if (model === undefined) throw new Error(`the catalog has no model named "${app.modelNameInUse}"`)
      const [seller] = await env.lens.createUsers(1)

      const title = `Trial ${seed}-${RUN_SALT}`
      const pub = await env.lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title, description: '', visibility: 'public',
        artifact: { template, model: model.id }, changelog: '', offers: [{ kind: 'per_use', licence: 'commercial', price_usd_micros: perUse, trial_uses: trials }] })
      ctx.evidence.push({ note: `the seller publishes "${title}" at ${perUse} µUSD a use with ${trials} trial uses`, answer: JSON.stringify(pub) })
      if (!pub.ok) return fail(`publishing with ${trials} trial uses was refused: ${pub.status} ${pub.error}`)
      const id = pub.value.id
      if (pub.value.review_status !== 'approved') {
        // B32.46 — a listing like another night's is held for review, hidden from the buyer; a person approves it.
        if (!env.lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
        const ok = await env.lens.moderate(id, 'approve')
        if (!ok.ok) return fail(`approving the held listing ${id}: ${ok.status} ${ok.error}`)
      }
      const seen = await env.lens.act<{ offers: MarketOffer[] | null }>(app.user, 'GET', `/v1/marketplace/listings/${id}`)
      ctx.evidence.push({ note: "the buyer reads the listing's offers", answer: JSON.stringify(seen.ok ? seen.value.offers : seen) })
      if (!seen.ok) return fail(`the buyer reading the listing: ${seen.status} ${seen.error}`)
      const offer = (seen.value.offers ?? []).find((o) => o.kind === 'per_use' && o.licence === 'commercial')
      if (offer?.trial_uses !== trials) return fail(`the buyer reads the per-use offer with ${String(offer?.trial_uses)} trial uses; it was published with ${trials}: ${JSON.stringify(seen.value.offers)}`)

      // Each use on Lens's use route, held against the cap and booked for the ledger read-back: a trial's model call is
      // still the buyer's ordinary spend. Lens's answer, or why not.
      const oneUse = async (n: number, [a, b]: readonly [number, number]): Promise<TrialUse | string> => {
        const rows0 = new Set((await spendRows(ctx)).map((x) => x.id))
        const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(template.length + 8), USE_MAX_TOKENS))
        let used
        try {
          used = await env.lens.as(app.user.token, 'POST', `/v1/workspaces/${app.user.workspaceID}/marketplace/listings/${id}/use`, { variables: { a: String(a), b: String(b) } })
        } catch (e) {
          env.cap.settle(hold, undefined)
          throw e
        }
        const charged = (await spendRows(ctx)).filter((x) => !rows0.has(x.id))
        env.cap.settle(hold, used.status === 200 ? (charged.reduce((t, x) => t - x.amount_ulxc, 0) / 1e6) * env.usdPerLXC : undefined)
        for (const x of charged) env.book.add(app.user.workspaceID, -x.amount_ulxc)
        ctx.evidence.push({ note: `the buyer's use ${n}`, answer: `${used.status} ${used.text.slice(0, 400)}` })
        if (used.status !== 200) return `the buyer's use ${n} was refused: ${used.status} ${used.text.slice(0, 200)}`
        const u = JSON.parse(used.text) as TrialUse
        if (!statesNumber(u.output ?? '', a + b)) return `the listing answered use ${n} wrong: expected ${a + b}, got "${u.output}"`
        return u
      }
      const said = ({ output: _o, ...u }: TrialUse) => JSON.stringify(u)
      const uses: TrialUse[] = []
      for (const [i, sum] of sums.entries()) {
        const u = await oneUse(i + 1, sum)
        if (typeof u === 'string') return fail(u)
        uses.push(u)
        const left = trials - i - 1
        if (i < trials && (u.trial !== true || u.charge !== 'trial' || u.price_ulxc !== 0 || u.trial_uses_left !== left || u.would_have_cost_usd_micros !== perUse)) {
          return fail(`use ${i + 1} of ${trials} trial uses should answer trial: true, charge trial at 0, ${left} left and would_have_cost_usd_micros ${perUse}; Lens answered ${said(u)}`)
        }
        if (i === trials && (u.trial === true || u.charge !== 'billed' || u.price_ulxc !== perUse * ULXC_PER_USD_MICRO)) {
          return fail(`the use after the ${trials} trial uses should be billed at ${perUse * ULXC_PER_USD_MICRO} µLXC and answer no trial; Lens answered ${said(u)}`)
        }
      }
      const billed = uses[trials]
      const trialIDs = new Set(uses.slice(0, trials).map((u) => u.id))

      const lines = ((await env.lens.marketBill(app.user)).lines ?? []).filter((l) => l.listing_id === id)
      ctx.evidence.push({ note: `the buyer's bill after ${trials} trial uses and one billed`, answer: JSON.stringify(lines) })
      const trialLines = lines.filter((l) => trialIDs.has(l.use_id))
      if (trialLines.length > 0) return fail(`${trialLines.length} of the ${trials} trial uses are on the buyer's bill: ${JSON.stringify(trialLines)}`)
      if (lines.length !== 1 || lines[0].use_id !== billed.id || lines[0].price_ulxc !== perUse * ULXC_PER_USD_MICRO) {
        return fail(`the buyer's bill should hold one line, the billed use's at ${perUse * ULXC_PER_USD_MICRO} µLXC; it has ${JSON.stringify(lines)}`)
      }

      // Paid, the bill clears the one billed use; the seller's earnings are this listing's alone, a seller new this run.
      const paid = await payBill(ctx)
      if (typeof paid === 'string') return fail(paid)
      const earned = (await env.lens.marketEarnings(seller)).earnings ?? []
      ctx.evidence.push({ note: "the seller's earnings once the bill is paid", answer: JSON.stringify(earned) })
      const trialEarned = earned.filter((e) => trialIDs.has(e.use_id))
      if (trialEarned.length > 0) return fail(`a trial use never earns; once the bill was paid the seller has earnings from ${trialEarned.length} of them: ${JSON.stringify(trialEarned)}`)
      const share = keptOf(perUse, env.fees.market_take_bps)
      const e = earned.find((x) => x.use_id === billed.id)
      if (e?.share_usd_micros !== share) return fail(`the billed use's earning reads ${JSON.stringify(e)}; the seller's ${percent(10_000 - env.fees.market_take_bps)} of ${perUse} µUSD is ${share}`)
      if (earned.length !== 1) return fail(`the seller earned from ${earned.length} uses; one was billed: ${JSON.stringify(earned)}`)
      return { pass: true, detail: `${trials} trial uses answered trial with ${trials - 1} to 0 left, each would have cost ${perUse} µUSD; the next was billed ${billed.price_ulxc} µLXC, ` +
        `the bill's one line; paid, it alone earned the seller ${share} µUSD` }
    },
  }
}

/**
 * B32.80 — an agent's licences within its mandate (Lens B32.22): the most one licence may commit it to, whether it may
 * subscribe, and an approval that lets one rent through once. The seller is a workspace the scenario makes; the buyer is the
 * scenario's own workspace, so its bill and its licences hold this listing's alone.
 */
export function marketAgentCommitment(seed: number): Scenario {
  const perUse = 100_000
  const rentPrice = 1_500_000
  const enterprisePrice = 2_500_000
  const subscribePrice = 500_000
  const maxCommitment = 20_000_000
  const approvalAbove = 10_000_000
  const days = 30
  const rentULXC = rentPrice * ULXC_PER_USD_MICRO
  const lx = (ulxc: number) => `${ulxc / 1e6} LXC`
  return {
    id: 'market-agent-commitment',
    owner: 'talyvor-lens',
    own: true,
    agents: 2,
    feature: 'Marketplace',
    title: `an agent whose rules commit it to at most ${lx(maxCommitment)} a licence rents one at ${lx(rentULXC)} with its own key, and is refused a ` +
      `${lx(enterprisePrice * ULXC_PER_USD_MICRO)} rent naming max_commitment_ulxc and a subscription naming may_subscribe; a second agent, above its ` +
      'approval amount, is refused with an approval, the approved rent goes through once and the next needs a new approval; ' +
      'the bill and the licences hold the two rents alone',
    run: async (ctx) => {
      const { env, app } = ctx
      const model = env.catalog.find((m) => m.display_name === app.modelNameInUse)
      if (model === undefined) throw new Error(`the catalog has no model named "${app.modelNameInUse}"`)
      const [seller] = await env.lens.createUsers(1)

      const title = `Commitment ${seed}-${RUN_SALT}`
      const pub = await env.lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title, description: '', visibility: 'public',
        artifact: { template: 'What is {{a}} + {{b}}? Reply with the number only.', model: model.id }, changelog: '', offers: [
          { kind: 'per_use', licence: 'commercial', price_usd_micros: perUse },
          { kind: 'rent', licence: 'commercial', price_usd_micros: rentPrice, period_days: days },
          { kind: 'rent', licence: 'enterprise', price_usd_micros: enterprisePrice, period_days: days, seats: 5 },
          { kind: 'subscribe', licence: 'commercial', price_usd_micros: subscribePrice, period_days: days },
        ] })
      ctx.evidence.push({ note: `the seller publishes "${title}" with a commercial and an enterprise ${days}-day rent and a commercial subscription`, answer: JSON.stringify(pub) })
      if (!pub.ok) return fail(`publishing "${title}" was refused: ${pub.status} ${pub.error}`)
      const listing = pub.value.id
      if (pub.value.review_status !== 'approved') {
        // B32.46 — a listing like another night's is held for review, hidden from the buyer; a person approves it.
        if (!env.lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
        const ok = await env.lens.moderate(listing, 'approve')
        if (!ok.ok) return fail(`approving the held listing ${listing}: ${ok.status} ${ok.error}`)
      }
      const read = await env.lens.act<{ offers: MarketOffer[] | null }>(app.user, 'GET', `/v1/marketplace/listings/${listing}`)
      if (!read.ok) return fail(`the buyer reading "${title}": ${read.status} ${read.error}`)
      const offerOf = (kind: string, licence: string) => (read.value.offers ?? []).find((o) => o.kind === kind && o.licence === licence)?.id
      const rent = offerOf('rent', 'commercial')
      const enterprise = offerOf('rent', 'enterprise')
      const subscription = offerOf('subscribe', 'commercial')
      if (rent === undefined || enterprise === undefined || subscription === undefined) return fail(`the buyer cannot see the listing's rents and subscription: ${JSON.stringify(read.value.offers)}`)

      // An agent of the buyer's with its own key, its rules saved as given.
      const agentWith = async (name: string, rules: Record<string, number>): Promise<{ id: string; name: string; key: string } | string> => {
        const a = await env.lens.createAgent(app.user, name)
        const k = await env.lens.act<{ key: string }>(app.user, 'POST', `/v1/workspaces/{ws}/agents/${a.id}/keys`, { name: 'market-agent-commitment' })
        if (!k.ok) return `issuing ${a.name} a key was refused: ${k.status} ${k.error}`
        const put = await env.lens.act<Record<string, unknown>>(app.user, 'PUT', `/v1/workspaces/{ws}/agents/${a.id}/rules`, rules)
        ctx.evidence.push({ note: `${a.name}'s rules`, answer: JSON.stringify(put) })
        if (!put.ok) return `setting ${a.name}'s rules ${JSON.stringify(rules)} was refused: ${put.status} ${put.error}`
        const unsaved = Object.entries(rules).filter(([r, v]) => put.value[r] !== v)
        if (unsaved.length > 0) return `${a.name}'s rules were saved without ${unsaved.map(([r, v]) => `${r} ${v}`).join(', ')}: ${JSON.stringify(put.value)}`
        return { ...a, key: k.value.key }
      }
      // A licence taken with an agent's key: Lens's status and body.
      const license = async (who: { name: string; key: string }, offer: string, key: string, what: string) => {
        const r = await env.lens.as(who.key, 'POST', `/v1/workspaces/${app.user.workspaceID}/marketplace/listings/${listing}/licences`, { offer_id: offer }, { 'Idempotency-Key': key })
        ctx.evidence.push({ note: `${who.name} ${what}`, answer: `${r.status} ${r.text.slice(0, 400)}` })
        let body: Partial<MarketLicence> & { error?: string; approval_id?: string } = {}
        try {
          body = JSON.parse(r.text) as typeof body
        } catch {
          // not JSON: the status and the text say what happened
        }
        return { status: r.status, text: r.text.slice(0, 300), body }
      }

      // Within its commitment, then above it, then a subscription it may not take.
      const capped = await agentWith(`Committed ${RUN_SALT}`, { max_commitment_ulxc: maxCommitment })
      if (typeof capped === 'string') return fail(capped)
      const first = await license(capped, rent, randomUUID(), `rents for ${lx(rentULXC)}, within ${lx(maxCommitment)}`)
      if (first.status !== 201 || first.body.agent_id !== capped.id || first.body.price_ulxc !== rentULXC) {
        return fail(`${capped.name} renting at ${lx(rentULXC)}, within its ${lx(maxCommitment)} commitment, should answer 201 with its licence; Lens answered ${first.status} ${first.text}`)
      }
      const over = await license(capped, enterprise, randomUUID(), `rents for ${lx(enterprisePrice * ULXC_PER_USD_MICRO)}, above ${lx(maxCommitment)}`)
      if (over.status !== 403 || !(over.body.error ?? '').includes('max_commitment_ulxc')) {
        return fail(`a ${lx(enterprisePrice * ULXC_PER_USD_MICRO)} rent above ${capped.name}'s ${lx(maxCommitment)} commitment should be refused 403 naming max_commitment_ulxc; Lens answered ${over.status} ${over.text}`)
      }
      const sub = await license(capped, subscription, randomUUID(), 'subscribes, with no may_subscribe')
      if (sub.status !== 403 || !(sub.body.error ?? '').includes('may_subscribe')) {
        return fail(`a subscription by ${capped.name}, whose rules do not let it subscribe, should be refused 403 naming may_subscribe; Lens answered ${sub.status} ${sub.text}`)
      }

      // Above its approval amount: refused with an approval, approved, the same request through once, the next refused again.
      const approver = await agentWith(`Approved ${RUN_SALT}`, { approval_above_ulxc: approvalAbove })
      if (typeof approver === 'string') return fail(approver)
      const key = randomUUID()
      const asked = await license(approver, rent, key, `rents for ${lx(rentULXC)}, above its ${lx(approvalAbove)} approval amount`)
      const approval = asked.body.approval_id ?? ''
      if (asked.status !== 403 || approval === '') {
        return fail(`a ${lx(rentULXC)} rent above ${approver.name}'s ${lx(approvalAbove)} approval amount should be refused 403 with an approval_id; Lens answered ${asked.status} ${asked.text}`)
      }
      const approved = await env.lens.act(app.user, 'POST', `/v1/workspaces/{ws}/agents/approvals/${approval}/approve`, {})
      ctx.evidence.push({ note: `the owner approves ${approval}`, answer: JSON.stringify(approved) })
      if (!approved.ok) return fail(`the owner approving ${approval} was refused: ${approved.status} ${approved.error}`)
      const through = await license(approver, rent, key, 'sends the same rent again, approved')
      if (through.status !== 201 || through.body.agent_id !== approver.id || through.body.price_ulxc !== rentULXC) {
        return fail(`approved, ${approver.name}'s rent sent again should answer 201 with its licence; Lens answered ${through.status} ${through.text}`)
      }
      const again = await license(approver, rent, randomUUID(), 'rents a second time, on the same approval')
      if (again.status !== 403 || (again.body.approval_id ?? '') === '' || again.body.approval_id === approval) {
        return fail(`one approval lets one rent through: ${approver.name}'s second rent should be refused 403 with a new approval, not ${approval}; Lens answered ${again.status} ${again.text}`)
      }

      // The bill and the licences: the two rents alone.
      const ids = [first.body.id, through.body.id]
      const lines = ((await env.lens.marketBill(app.user)).lines ?? []).filter((l) => l.listing_id === listing)
      ctx.evidence.push({ note: "the listing's lines on the buyer's bill", answer: JSON.stringify(lines) })
      const want = [[first.body.use_id, capped.id], [through.body.use_id, approver.id]]
      if (lines.length !== 2 || !want.every(([use, agent]) => lines.some((l) => l.use_id === use && l.agent_id === agent && l.price_ulxc === rentULXC))) {
        return fail(`the buyer's bill should hold two ${lx(rentULXC)} rents, one for each agent, and nothing refused; it has ${JSON.stringify(lines)}`)
      }
      const held = await env.lens.act<{ licences: MarketLicence[] | null }>(app.user, 'GET', '/v1/workspaces/{ws}/marketplace/licences')
      ctx.evidence.push({ note: "the buyer's licences", answer: JSON.stringify(held) })
      if (!held.ok) return fail(`reading the buyer's licences: ${held.status} ${held.error}`)
      const mine = (held.value.licences ?? []).filter((x) => x.listing_id === listing)
      if (mine.length !== 2 || !ids.every((x) => mine.some((l) => l.id === x && l.kind === 'rent' && l.licence === 'commercial'))) {
        return fail(`the buyer should hold two licences to the listing, the two commercial rents ${ids.join(' and ')}; it holds ${JSON.stringify(mine)}`)
      }
      return { pass: true, detail: `${capped.name} rented at ${lx(rentULXC)} and was refused ${lx(enterprisePrice * ULXC_PER_USD_MICRO)} naming max_commitment_ulxc and a ` +
        `subscription naming may_subscribe; ${approver.name}'s rent went through once on approval ${approval}, and its next filed ${again.body.approval_id}; ` +
        'the bill holds the two rents and the buyer the two licences' }
    },
  }
}

/** B32.81 — one MCP tool call as Lens answers it: the tool's JSON text, or its refusal (isError) and why. */
interface ToolAnswer {
  status: number
  ok: boolean
  refused: boolean
  text: string
}

/**
 * B32.81 — an agent shopping the marketplace over MCP with its own key (Lens B32.23): it searches, reads a listing's offers,
 * rents within its commitment and is refused a rent above it, uses the rented listing under its licence and a second one at
 * no more than its max price, and is refused that use once the seller raises the price above it. The seller is a workspace
 * the scenario makes; the buyer is the scenario's own workspace, so its bill and its licences hold these listings' alone.
 */
export function marketAgentMCP(seed: number): Scenario {
  const perUse = 50_000
  const raised = 100_000
  const rentPrice = 1_500_000
  const enterprisePrice = 2_500_000
  const maxCommitment = 20_000_000
  const days = 30
  const fund = 2_000_000
  const rentULXC = rentPrice * ULXC_PER_USD_MICRO
  const useULXC = perUse * ULXC_PER_USD_MICRO
  return {
    id: 'market-agent-mcp',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Marketplace',
    title: `an agent with its own key, over MCP, finds a listing (market_search), reads its offers (market_listing), rents it at ${rentPrice} µUSD within ` +
      `its ${maxCommitment} µLXC commitment and is refused the ${enterprisePrice} µUSD enterprise rent naming max_commitment_ulxc (market_license); its use ` +
      `of the rented listing is licensed, and a second listing's at ${perUse} µUSD with max_price_usd_micros ${perUse} is billed, then refused naming it once ` +
      `the seller asks ${raised}; the bill holds the rent and the one billed use, and the buyer the one licence`,
    run: async (ctx) => {
      const { env, app } = ctx
      const r = seeded(seed * 61 + 17)
      const sums = Array.from({ length: 3 }, () => [100 + Math.floor(r() * 900), 100 + Math.floor(r() * 900)] as const)
      const template = 'What is {{a}} + {{b}}? Reply with the number only.'
      const model = env.catalog.find((m) => m.display_name === app.modelNameInUse)
      if (model === undefined) throw new Error(`the catalog has no model named "${app.modelNameInUse}"`)
      const [seller] = await env.lens.createUsers(1)

      // The seller publishes; held for review, a moderator approves it, as a buyer may then find it.
      const publish = async (title: string, offers: MarketOffer[]): Promise<string | { error: string }> => {
        const pub = await env.lens.act<Listing>(seller, 'POST', '/v1/workspaces/{ws}/marketplace/listings', { kind: 'prompt', title, description: '', visibility: 'public',
          artifact: { template, model: model.id }, changelog: '', offers })
        ctx.evidence.push({ note: `the seller publishes "${title}" with ${offers.map((o) => `a ${o.licence} ${o.kind}`).join(', ')}`, answer: JSON.stringify(pub) })
        if (!pub.ok) return { error: `publishing "${title}" was refused: ${pub.status} ${pub.error}` }
        if (pub.value.review_status !== 'approved') {
          // B32.46 — a listing like another night's is held for review, hidden from the buyer; a person approves it.
          if (!env.lens.canModerate) throw new CannotTest(`the listing was ${pub.value.review_status}, and approving it needs a moderator key: LENS_MODERATOR_KEY, from \`lens moderator-keys create\``)
          const ok = await env.lens.moderate(pub.value.id, 'approve')
          if (!ok.ok) return { error: `approving the held listing ${pub.value.id}: ${ok.status} ${ok.error}` }
        }
        return pub.value.id
      }
      const word = freshWord(seed * 37 + 11)
      const shopTitle = `Errand ${word} ${seed}`
      const shop = await publish(shopTitle, [{ kind: 'per_use', licence: 'commercial', price_usd_micros: perUse },
        { kind: 'rent', licence: 'commercial', price_usd_micros: rentPrice, period_days: days },
        { kind: 'rent', licence: 'enterprise', price_usd_micros: enterprisePrice, period_days: days, seats: 5 }])
      if (typeof shop !== 'string') return fail(shop.error)
      const metered = await publish(`Metered ${seed}-${RUN_SALT}`, [{ kind: 'per_use', licence: 'commercial', price_usd_micros: perUse }])
      if (typeof metered !== 'string') return fail(metered.error)

      // The buyer's agent, its key, its commitment, and money for the model calls its uses run.
      const agent = await env.lens.createAgent(app.user, `Shopper ${RUN_SALT}`)
      const k = await env.lens.act<{ key: string }>(app.user, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'market-agent-mcp' })
      if (!k.ok) return fail(`issuing ${agent.name} a key was refused: ${k.status} ${k.error}`)
      const rules = await env.lens.act<Record<string, unknown>>(app.user, 'PUT', `/v1/workspaces/{ws}/agents/${agent.id}/rules`, { max_commitment_ulxc: maxCommitment })
      ctx.evidence.push({ note: `${agent.name}'s rules`, answer: JSON.stringify(rules) })
      if (!rules.ok || rules.value.max_commitment_ulxc !== maxCommitment) {
        return fail(`${agent.name}'s rules should save max_commitment_ulxc ${maxCommitment}; Lens answered ${rules.status} ${rules.ok ? JSON.stringify(rules.value) : rules.error}`)
      }
      await env.lens.fundAgent(app.user, agent.id, fund)

      // One JSON-RPC tools/call on POST /mcp with the agent's own key.
      let rpc = 0
      const tool = async (name: string, args: Record<string, unknown>): Promise<ToolAnswer> => {
        const got = await env.lens.as(k.value.key, 'POST', '/mcp', { jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } })
        ctx.evidence.push({ note: `${agent.name} calls ${name} ${JSON.stringify(args)}`, answer: `${got.status} ${got.text.slice(0, 400)}` })
        let body: { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } } = {}
        try {
          body = JSON.parse(got.text) as typeof body
        } catch {
          // not JSON: the status and the text say what happened
        }
        const refused = body.result?.isError === true
        return { status: got.status, ok: got.status === 200 && body.result !== undefined && !refused, refused, text: body.result?.content?.[0]?.text ?? body.error?.message ?? got.text.slice(0, 300) }
      }
      const valueOf = <T>(t: ToolAnswer): T | undefined => {
        try {
          return JSON.parse(t.text) as T
        } catch {
          return undefined
        }
      }
      // market_use, held against the cap and booked for the ledger read-back as a use on Lens's HTTP route is.
      const runUse = async (listing: string, [a, b]: readonly [number, number], max?: number): Promise<ToolAnswer> => {
        const rows0 = new Set((await spendRows(ctx)).map((x) => x.id))
        const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(template.length + 8), USE_MAX_TOKENS))
        let t: ToolAnswer
        try {
          t = await tool('market_use', { listing_id: listing, variables: { a: String(a), b: String(b) }, ...(max === undefined ? {} : { max_price_usd_micros: max }) })
        } catch (e) {
          env.cap.settle(hold, undefined)
          throw e
        }
        const charged = (await spendRows(ctx)).filter((x) => !rows0.has(x.id))
        env.cap.settle(hold, t.ok ? (charged.reduce((s, x) => s - x.amount_ulxc, 0) / 1e6) * env.usdPerLXC : undefined)
        for (const x of charged) env.book.add(app.user.workspaceID, -x.amount_ulxc)
        return t
      }
      type UseAnswer = { id: string; charge: string; price_ulxc: number; output?: string }

      // Found, read, rented within the commitment, refused above it.
      const found = await tool('market_search', { text: word })
      const hits = valueOf<{ listings: Listing[] | null }>(found)?.listings ?? []
      if (!found.ok || !hits.some((l) => l.id === shop)) return fail(`market_search for "${word}" should find "${shopTitle}" (${shop}); Lens answered ${found.status} ${found.text}`)
      const read = await tool('market_listing', { listing_id: shop })
      const offers = valueOf<{ offers: MarketOffer[] | null }>(read)?.offers ?? []
      const rent = offers.find((o) => o.kind === 'rent' && o.licence === 'commercial')?.id
      const enterprise = offers.find((o) => o.kind === 'rent' && o.licence === 'enterprise')?.id
      if (!read.ok || rent === undefined || enterprise === undefined) return fail(`market_listing should give "${shopTitle}"'s commercial and enterprise rents; Lens answered ${read.status} ${read.text}`)
      const rented = await tool('market_license', { listing_id: shop, offer_id: rent, idempotency_key: randomUUID() })
      const lic = valueOf<MarketLicence>(rented)
      if (!rented.ok || lic === undefined || lic.agent_id !== agent.id || lic.price_ulxc !== rentULXC || lic.kind !== 'rent' || lic.licence !== 'commercial') {
        return fail(`market_license on the ${rentPrice} µUSD commercial rent, within ${agent.name}'s ${maxCommitment} µLXC commitment, should answer its licence; Lens answered ${rented.status} ${rented.text}`)
      }
      const over = await tool('market_license', { listing_id: shop, offer_id: enterprise, idempotency_key: randomUUID() })
      if (!over.refused || !over.text.includes('max_commitment_ulxc')) {
        return fail(`market_license on the ${enterprisePrice} µUSD enterprise rent, above ${agent.name}'s ${maxCommitment} µLXC commitment, should be isError naming max_commitment_ulxc; Lens answered ${over.status} ${over.text}`)
      }

      // Used under the licence; the second listing used at its price, then refused above the agent's max price.
      const licensed = await runUse(shop, sums[0])
      const lu = valueOf<UseAnswer>(licensed)
      if (!licensed.ok || lu === undefined) return fail(`${agent.name}'s market_use of the rented listing was refused: ${licensed.status} ${licensed.text}`)
      if (lu.charge !== 'licensed') return fail(`the rent covers ${agent.name}'s use of "${shopTitle}", so market_use should answer charge "licensed"; it answered ${licensed.text.slice(0, 300)}`)
      if (!statesNumber(lu.output ?? '', sums[0][0] + sums[0][1])) return fail(`the listing answered ${agent.name} wrong: expected ${sums[0][0] + sums[0][1]}, got "${lu.output}"`)
      const billed = await runUse(metered, sums[1], perUse)
      const bu = valueOf<UseAnswer>(billed)
      if (!billed.ok || bu === undefined || bu.charge !== 'billed' || bu.price_ulxc !== useULXC) {
        return fail(`market_use of a ${perUse} µUSD listing with max_price_usd_micros ${perUse} should answer charge "billed" at ${useULXC} µLXC; Lens answered ${billed.status} ${billed.text}`)
      }
      const raise = await env.lens.act(seller, 'PUT', `/v1/workspaces/{ws}/marketplace/listings/${metered}/offers`, { offers: [{ kind: 'per_use', licence: 'commercial', price_usd_micros: raised }] })
      ctx.evidence.push({ note: `the seller raises the second listing's per-use offer to ${raised} µUSD`, answer: JSON.stringify(raise) })
      if (!raise.ok) return fail(`the seller raising the per-use offer to ${raised} µUSD was refused: ${raise.status} ${raise.error}`)
      const priced = await runUse(metered, sums[2], perUse)
      if (!priced.refused || !priced.text.includes('max_price_usd_micros')) {
        return fail(`market_use of a listing now at ${raised} µUSD with max_price_usd_micros ${perUse} should be isError naming max_price_usd_micros; Lens answered ${priced.status} ${priced.text}`)
      }

      // The bill and the licences: the rent and the one billed use; the one licence.
      const lines = ((await env.lens.marketBill(app.user)).lines ?? []).filter((l) => l.listing_id === shop || l.listing_id === metered)
      ctx.evidence.push({ note: "the two listings' lines on the buyer's bill", answer: JSON.stringify(lines) })
      const want = [[lic.use_id, shop, rentULXC], [bu.id, metered, useULXC]] as const
      if (lines.length !== 2 || !want.every(([u, l, p]) => lines.some((x) => x.use_id === u && x.listing_id === l && x.price_ulxc === p && x.agent_id === agent.id))) {
        return fail(`the buyer's bill should hold exactly ${agent.name}'s ${rentULXC} µLXC rent and its one ${useULXC} µLXC use — nothing for the refused rent, the licensed use or the use above its max price; it has ${JSON.stringify(lines)}`)
      }
      const held = await env.lens.act<{ licences: MarketLicence[] | null }>(app.user, 'GET', '/v1/workspaces/{ws}/marketplace/licences')
      ctx.evidence.push({ note: "the buyer's licences", answer: JSON.stringify(held) })
      if (!held.ok) return fail(`reading the buyer's licences: ${held.status} ${held.error}`)
      const mine = (held.value.licences ?? []).filter((x) => x.listing_id === shop || x.listing_id === metered)
      if (mine.length !== 1 || mine[0].id !== lic.id) return fail(`the buyer should hold one licence, ${agent.name}'s rent ${lic.id}, and nothing from the refused one; it holds ${JSON.stringify(mine)}`)
      return { pass: true, detail: `${agent.name} found "${shopTitle}" over MCP, rented it (${lic.id}, ${rentULXC} µLXC) and was refused the enterprise rent naming ` +
        `max_commitment_ulxc; its use under the rent was licensed, the second listing's billed ${useULXC} µLXC and then refused naming max_price_usd_micros at ` +
        `${raised} µUSD; the bill holds the two lines and the buyer the one licence` }
    },
  }
}
