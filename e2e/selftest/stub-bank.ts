// B17.6 SELF-TEST — the stand-in Lens's Agent Bank (B19) and marketplace (B20), as much of each as
// Agent Wallets, the marketplace screens and the bank scenarios read and write: agents and their keys,
// funding, rules, approvals, pausing, payments inside a company and to another company's agent, the
// double-entry postings and the statements built from them; listings, uses, the buyer's bill and the
// seller's earnings. A bill is never paid here, so earnings stay pending, as a synthetic company's do.
//
// STUB_BREAK=agent-limit plants the defect the bank's DONE names: an agent's limit per request is
// recorded but never refuses.
//
// B25.4 adds money between owners (B22) and the marketplace's review, reports, takedowns and payouts,
// as B25.3 made each work for test users: transfers, refunds and requests between two companies' agents,
// loans, escrow, pots, recurring transfers and cash-outs (the last two paid by tick(), as Lens's minute
// tick pays them), agent cards, listings held for review, the moderators' queue behind a moderator key,
// and a seller's Stripe account. STUB_BREAK may name several of these, comma-separated, one per scenario:
//   send-one-side       — a send leaves the sender but never reaches the other company's agent
//   refund-kept         — giving a transfer back takes it from the receiver and never returns it to the sender
//   request-unpaid      — accepting a request marks it accepted and pays nothing
//   loan-no-payout      — accepting a loan makes it active without paying the borrower
//   escrow-open-free    — paying into escrow takes nothing from the payer
//   escrow-release-lost — confirming delivery releases the escrow to nobody
//   escrow-dispute-pays — disputing an escrow pays the payee anyway
//   pot-out-lost        — moving credits out of a pot empties it into nothing
//   schedule-twice      — each run of a recurring transfer pays twice
//   cash-out-free       — a cash-out is paid without holding the credits from the agent
//   card-live           — an agent's card is issued in live mode
//   review-public       — a listing held for review is in the public catalog
//   approve-noop        — a moderator's approval answers but leaves the listing held
//   report-lost         — a report is acknowledged and never reaches the moderators' queue
//   takedown-no-refund  — taking a listing down refunds nobody
//   connect-none        — Connect with Stripe sends the browser to Stripe but records no account
//   b30-capability-gone — fx, one of B30.1's money-and-markets capabilities, is missing from the list (B30.115)
//
// B25.8 adds what Lens (B25.7) brings due for a test workspace with the synthetic key: a loan's instalment
// (taken or missed by tick(), as Lens's minute tick does), a buyer's bill paid and refunded, a purchase on
// an agent's card; and a seller taking their earnings as credits. Its defects, one per scenario:
//   loan-repay-lost     — an instalment is taken from the borrower and never reaches the lender
//   loan-default-never  — a late loan missed again stays late, never in default
//   card-free           — an approved card purchase takes nothing from the agent
//   payout-uncredited   — taking earnings as credits records the payout and credits nothing
//   bill-refund-kept    — refunding a paid bill marks the buyer's use refunded and leaves the seller's earning

import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface BankWorkspace {
  id: string
  balance: number
}

export interface BankDeps {
  brk: string
  workspace: (id: string) => BankWorkspace | undefined
  /** Runs one question on a model for ws, booking what it cost on ws's ledger as a spend row. */
  runModel: (ws: BankWorkspace, model: string, text: string) => { answer: string } | { error: string }
  json: (res: ServerResponse, status: number, body: unknown) => void
  read: (req: IncomingMessage) => Promise<string>
  /** B25.4 — the moderator key the review queue takes, and where the stub serves Stripe's onboarding */
  moderatorKey: string
  base: string
  /** B25.8 — books `ulxc` (negative: a debit) on workspace `ws`'s ledger as a row of `type`, tagged with `metadata` */
  credit: (ws: string, ulxc: number, type: string, description: string, metadata?: object) => void
  /** B26.24 — answers a route the stub does not know: a 404 the self-test names */
  miss: (req: IncomingMessage, res: ServerResponse, path: string) => void
}

interface Rules {
  max_per_request_ulxc: number
  hourly_limit_ulxc: number
  daily_limit_ulxc: number
  weekly_limit_ulxc: number
  monthly_limit_ulxc: number
  /** B28.25 — a day's cap per model, by modelCapKey; a save without it keeps the caps, one with it replaces them. */
  model_daily_limits_ulxc: Record<string, number>
  /** B28.26 — the requests it may make in any sixty seconds; zero is no cap, and a save without it keeps the cap. */
  requests_per_minute: number
  approval_above_ulxc: number
  allowed_models: string[]
  allowed_providers: string[]
  allowed_listings: string[]
  /** B28.27 — who it may pay and who it may not, by payee id; a save without them keeps the lists. */
  allowed_payees: string[]
  blocked_payees: string[]
  /** B28.28 — a day's cap per payee, by the id the payee lists name it by; a save without it keeps the caps, one with it replaces them. */
  payee_daily_limits_ulxc: Record<string, number>
  active_from: string
  active_until: string
  timezone: string
  pause_on_unusual_spend: boolean
}
interface Agent { id: string; ws: string; name: string; owner_user_id: string; created_at: string; keys: string[]; paused_at?: string; paused_reason?: string; rules: Rules; description?: string; archived_at?: string; versions?: RulesVersion[]; boosts?: Boost[] }
/** B28.32 — Lens B28.308's agent_rule_boosts: one of the agent's limits raised from the rules' value until a time. */
interface Boost { rule: BoostRule; raised_from: number; value: number; until: string; created_by: string; created_at: string }
const BOOSTABLE = ['max_per_request_ulxc', 'hourly_limit_ulxc', 'daily_limit_ulxc', 'weekly_limit_ulxc', 'monthly_limit_ulxc', 'approval_above_ulxc', 'requests_per_minute'] as const
type BoostRule = (typeof BOOSTABLE)[number]
/** B28.31 — Lens B28.307's agent_rules_versions: the rules as each change left them, newest first, by whom and how. */
interface RulesVersion { version: number; rules: Rules; changed_by: string; change: string; created_at: string }
interface Posting { posting_id: number; entry_id: string; at: string; ws: string; account: string; kind: string; amount_ulxc: number; counterparty: string; ref?: string; model?: string }
interface Approval {
  id: string; ws: string; agent_id: string; amount_ulxc: number; model: string; status: string; created_at: string; decided_at?: string; fingerprint: string
  /** Who a payment goes to, and its memo (Lens economy.AgentApproval since B23.5); none for a request to a model. */
  payee?: { kind: string; id: string; name: string }; memo?: string
}
interface Listing {
  id: string; workspace_id: string; kind: string; title: string; description: string; price_per_use_ulxc: number
  visibility: string; latest_version: number; created_at: string; updated_at: string; review_status: string
  artifact: Record<string, unknown>; changelog: string
}
interface Use {
  id: string; listing_id: string; seller: string; buyer: string; agent_id: string; price_ulxc: number; charge: string; used_at: string; payee_agent_id: string; memo: string
  refunded_at?: string
  /** B25.8 — the bill it was paid on, when, and a refund that left the seller's share in place (bill-refund-kept) */
  invoice?: string; cleared_at?: string; kept?: boolean
}
interface Payout { id: string; ws: string; method: 'credits'; month: string; gross_usd_micros: number; net_usd_micros: number; credits_ulxc: number; paid_at: string; created_at: string }
interface CardAuth {
  id: string; agent_id: string; authorization_id: string; approved: boolean; reason: string; amount_minor: number; currency: string
  merchant_name: string; merchant_category: string; amount_usd_micros: number; amount_ulxc: number; created_at: string
}
interface Transfer {
  id: string; from_workspace_id: string; from_agent_id: string; to_workspace_id: string; to_agent_id: string; amount_ulxc: number; memo: string
  class: 'GREEN' | 'AMBER'; test_funded_ulxc: number; request_id?: string; schedule_id?: string; refund_of?: string; loan_id?: string; created_at: string
}
interface MoneyReq {
  id: string; from_workspace_id: string; from_agent_id: string; to_workspace_id: string; to_agent_id: string; amount_ulxc: number; memo: string
  status: 'pending' | 'accepted' | 'declined'; transfer_id?: string; created_at: string; decided_at?: string
}
interface Loan {
  id: string; lender_workspace_id: string; lender_agent_id: string; borrower_workspace_id: string; borrower_agent_id: string; principal_ulxc: number
  interest_bps: number; instalments: number; every: string; late_fee_ulxc: number; memo: string; status: string; paid_instalments: number
  next_due_at?: string; offered_at: string; decided_at?: string; events: { kind: string; transfer_id?: string; at: string }[]
}
interface Escrow {
  id: string; payer_workspace_id: string; payer_agent_id: string; payee_workspace_id: string; payee_agent_id: string; amount_ulxc: number; memo: string
  class: 'GREEN' | 'AMBER'; test_funded_ulxc: number; release_at: string; status: 'held' | 'disputed' | 'released' | 'returned'; created_at: string
  decided_at?: string; events: { kind: string; actor: string; detail?: string; at: string }[]
}
interface Pot { id: string; agent_id: string; name: string; kind: string; target_ulxc?: number; locked_until?: string; created_at: string }
interface Schedule {
  id: string; ws: string; from_agent_id: string; to_agent_id: string; amount_ulxc: number; memo: string; every: string; next_run_at: string; active: boolean
  created_at: string; runs: { tick_at: string; outcome: 'paid' | 'refused'; entry_id?: string; detail?: string; created_at: string }[]
}
interface CashOut {
  id: string; workspace_id: string; agent_id: string; amount_ulxc: number; amount_uusd: number; test_funded_ulxc: number; destination: string
  partner: string; partner_ref?: string; status: 'held' | 'submitted' | 'paid' | 'failed'; created_at: string; decided_at?: string
}
interface Report { id: string; listing_id: string; reporter: string; reason: string; details: string; created_at: string; resolved: boolean }
interface ConnectAccount { stripe_account_id: string; country: string; details_submitted: boolean; payouts_enabled: boolean; currently_due: string[] }

const PERIOD_MS: Record<string, number> = { hour: 3600e3, day: 24 * 3600e3, week: 7 * 24 * 3600e3, month: 30 * 24 * 3600e3 }
/** What Lens's publish review holds for a person to judge (market B20.4): text that reads as a prompt injection. */
const READS_AS_INJECTION = /\b(you are now|pretend (you are|to be)|ignore (all )?(previous|prior) instructions)\b/i
/** The capabilities Agent Wallets asks after (Lens economy.Capabilities): each test money only. */
const CAPABILITIES = [
  ['pay_another_owner', 'Pay another owner'], ['loans_between_companies', 'Loans between companies'], ['escrow', 'Escrow'],
  ['rules_approvals_statements_pots', 'Rules, approvals, statements and pots'], ['cash_out', 'Cash out'], ['company_credit_line', 'Company credit line'],
].map(([capability, name]) => ({ capability, name, class: 'AMBER', real_money: false }))
/** B30.115 — and the money-and-markets ones B30.1 added, in Lens's classes; `b30-capability-gone` drops fx. */
const B30_CAPABILITIES = [
  ['currency_accounts', 'RED'], ['account_details', 'RED'], ['payments_in', 'RED'], ['payments_out', 'RED'], ['pay_by_bank', 'AMBER'],
  ['fx', 'RED'], ['stablecoins', 'RED'], ['x402', 'RED'], ['merchant_acceptance', 'RED'], ['b2b_credit', 'AMBER'], ['seller_advances', 'AMBER'],
  ['lending_marketplace', 'AMBER'], ['trade_equities', 'RED'], ['trade_crypto', 'RED'], ['trade_prediction', 'RED'], ['treasury_sweep', 'RED'],
  ['price_lock', 'AMBER'], ['cover', 'RED'], ['payouts_to_people', 'RED'],
].map(([capability, cls]) => ({ capability, name: capability, class: cls, real_money: false }))

const noRules = (): Rules => ({ max_per_request_ulxc: 0, hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 0, model_daily_limits_ulxc: {}, requests_per_minute: 0, approval_above_ulxc: 0,
  allowed_models: [], allowed_providers: [], allowed_listings: [], allowed_payees: [], blocked_payees: [], payee_daily_limits_ulxc: {}, active_from: '', active_until: '', timezone: '', pause_on_unusual_spend: false })

const lxc = (ulxc: number): string => String(ulxc / 1e6)

/** The name a per-model cap knows a model by, as Lens's economy.modelCapKey: lower-case, no dated or -latest suffix. */
const modelCapKey = (model: string): string => model.trim().toLowerCase().replace(/-(\d{8}|\d{4}-\d{2}-\d{2}|latest)$/, '')

/** The caps a save names, by modelCapKey, the zeros (no cap) left out — as Lens stores them. */
const modelCaps = (caps: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(caps).filter(([, v]) => v > 0).map(([m, v]) => [modelCapKey(m), v]))
/** µLXC per µUSD (LXC is pegged at $0.10), and µUSD a penny buys, at the stub's fixed pound. */
const ULXC_PER_USD_MICRO = 10
const USD_MICROS_PER_PENNY = 12_700
const id = (prefix: string): string => prefix + randomBytes(8).toString('hex')

export class Bank {
  private readonly d: BankDeps
  private readonly agents = new Map<string, Agent>()
  private readonly keys = new Map<string, Agent>()
  private readonly postings: Posting[] = []
  private readonly approvals: Approval[] = []
  private readonly allPaused = new Map<string, { at: string; reason: string }>()
  /** B28.26 — when each agent's admitted requests were held, as Lens counts its holds for the per-minute rule. */
  private readonly asked = new Map<string, number[]>()
  private readonly listings = new Map<string, Listing>()
  private readonly uses: Use[] = []
  private nextPosting = 1
  private readonly transfers: Transfer[] = []
  private readonly requests: MoneyReq[] = []
  private readonly loans: Loan[] = []
  private readonly escrows: Escrow[] = []
  private readonly pots: Pot[] = []
  private readonly schedules: Schedule[] = []
  private readonly cashOuts: CashOut[] = []
  private readonly cards = new Map<string, object>()
  private readonly reports: Report[] = []
  private readonly accounts = new Map<string, ConnectAccount>()
  private readonly payouts: Payout[] = []
  private readonly cardAuths: CardAuth[] = []

  constructor(d: BankDeps) {
    this.d = d
  }

  /** The workspace and agent an agent key belongs to. */
  agentOfKey(key: string): { ws: BankWorkspace; agent: Agent } | undefined {
    const a = this.keys.get(key)
    const ws = a === undefined ? undefined : this.d.workspace(a.ws)
    return a === undefined || ws === undefined ? undefined : { ws, agent: a }
  }

  private balance(account: string): number {
    return this.postings.filter((p) => p.account === account).reduce((s, p) => s + p.amount_ulxc, 0)
  }

  private post(ws: string, kind: string, legs: [string, number, string][], ref?: string, model?: string): string {
    const entry = id('ent_')
    const at = new Date().toISOString()
    for (const [account, amount, counterparty] of legs) {
      this.postings.push({ posting_id: this.nextPosting++, entry_id: entry, at, ws, account, kind, amount_ulxc: amount, counterparty, ref, ...(model === undefined ? {} : { model }) })
    }
    return entry
  }

  private book(ws: BankWorkspace): object {
    const agents = [...this.agents.values()].filter((a) => a.ws === ws.id).map((a) => ({
      id: a.id, name: a.name, balance_ulxc: this.balance(`agent:${a.id}`),
      pots_ulxc: this.pots.filter((p) => p.agent_id === a.id).reduce((s, p) => s + this.balance(`pot:${p.id}`), 0),
      spent_ulxc: this.postings.filter((p) => p.account === `agent:${a.id}` && p.kind === 'spend').reduce((s, p) => s - p.amount_ulxc, 0),
      keys: a.keys, created_at: a.created_at, paused_at: a.paused_at, paused_reason: a.paused_reason, owner_user_id: a.owner_user_id, verified: false,
      description: a.description ?? '', archived_at: a.archived_at,
    }))
    const allocated = agents.reduce((s, a) => s + a.balance_ulxc + a.pots_ulxc, 0)
    const paused = this.allPaused.get(ws.id)
    return {
      workspace_balance_ulxc: ws.balance, allocated_ulxc: allocated, unallocated_ulxc: ws.balance - allocated,
      spent_ulxc: agents.reduce((s, a) => s + a.spent_ulxc, 0), agents,
      ...(paused === undefined ? {} : { all_paused_at: paused.at, all_paused_reason: paused.reason }),
    }
  }

  /**
   * Lens's agent rules (economy/agent_rules.go), in its order: the pauses, the models, a payment's payee (B28.27), the limit per
   * request, the hour's, day's, week's and month's limits, the model's day, the payee's day (B28.28), then the approval amount. A refusal is 403 naming the rule
   * (429 for the requests-a-minute rule, checked after the models, B28.26);
   * a request above the approval amount files an approval, and an approved one goes through once.
   */
  judge(agent: Agent, amount: number, req: { model?: string; payment?: boolean; payee?: Agent; memo?: string; fingerprint: string }): { status: number; error: string } | undefined {
    const rule = (s: string) => ({ status: 403, error: `the agent's spending rules refuse this request: ${s}` })
    const all = this.allPaused.get(agent.ws)
    if (all !== undefined) return rule(`every agent in this workspace is paused (${all.reason || "paused by the workspace's owner"}) — the workspace's owner can resume them`)
    if (agent.paused_at !== undefined) return rule(`the agent is paused (${agent.paused_reason || "paused by the workspace's owner"}) — the workspace's owner can resume it`)
    const r = this.rulesInForce(agent)
    const what = req.payment ? 'payment' : 'request'
    if (r.allowed_models.length > 0 && !req.payment && !r.allowed_models.includes(req.model ?? '')) return rule(`the agent may not use the model "${req.model}"`)
    if (req.payment && req.payee !== undefined) {
      // B28.27 — a payee is named by its own id or its company's, as Lens's payeeIDs reads it.
      const ids = [req.payee.id, req.payee.ws]
      if (ids.some((x) => r.blocked_payees.includes(x))) return rule(`the agent may not pay agent "${req.payee.id}"`)
      if (r.allowed_payees.length > 0 && !ids.some((x) => r.allowed_payees.includes(x))) {
        return rule(`the agent may pay only the payees its rules name, and agent "${req.payee.id}" is not one`)
      }
    }
    if (r.requests_per_minute > 0 && !req.payment) {
      const since = Date.now() - 60_000
      const asked = (this.asked.get(agent.id) ?? []).filter((t) => t > since).length
      if (asked >= r.requests_per_minute) {
        return { status: 429, error: `the agent's spending rules refuse this request: the agent may make ${r.requests_per_minute} requests a minute and has made ${asked} in the last minute; try again shortly` }
      }
    }
    if (r.max_per_request_ulxc > 0 && amount > r.max_per_request_ulxc && this.d.brk !== 'agent-limit') {
      return rule(`this ${what} would cost up to ${lxc(amount)} LXC; the agent's limit per request is ${lxc(r.max_per_request_ulxc)} LXC`)
    }
    const spent = this.postings.filter((p) => p.account === `agent:${agent.id}` && (p.kind === 'spend' || (p.kind === 'pay' && p.amount_ulxc < 0)))
      .reduce((s, p) => s - p.amount_ulxc, 0)
    for (const [limit, name] of [[r.hourly_limit_ulxc, 'hourly'], [r.daily_limit_ulxc, 'daily'], [r.weekly_limit_ulxc, 'weekly'], [r.monthly_limit_ulxc, 'monthly']] as const) {
      if (limit > 0 && spent + amount > limit) {
        return rule(`the agent has spent ${lxc(spent)} LXC of its ${name} limit of ${lxc(limit)} LXC, and this ${what} would cost up to ${lxc(amount)} LXC`)
      }
    }
    const modelCap = r.model_daily_limits_ulxc[modelCapKey(req.model ?? '')] ?? 0
    if (modelCap > 0 && !req.payment) {
      const today = new Date(new Date().toISOString().slice(0, 10)).toISOString()
      const onModel = this.postings.filter((p) => p.account === `agent:${agent.id}` && p.kind === 'spend' && p.model === modelCapKey(req.model ?? '') && p.at >= today)
        .reduce((s, p) => s - p.amount_ulxc, 0)
      if (onModel + amount > modelCap) {
        return rule(`the agent has spent ${lxc(onModel)} LXC of its daily limit of ${lxc(modelCap)} LXC for the model "${req.model}", and this request would cost up to ${lxc(amount)} LXC`)
      }
    }
    if (req.payment && req.payee !== undefined) {
      // B28.28 — what it has paid the payee today, by the payee's id or its company's, as Lens's agent_payee_payments counts it.
      const today = new Date(new Date().toISOString().slice(0, 10)).toISOString()
      for (const pid of [req.payee.id, req.payee.ws]) {
        const limit = r.payee_daily_limits_ulxc[pid] ?? 0
        if (limit <= 0) continue
        const paid = this.postings.filter((p) => p.account === `agent:${agent.id}` && p.kind === 'pay' && p.amount_ulxc < 0 && p.at >= today &&
          [p.counterparty.slice('agent:'.length), this.agents.get(p.counterparty.slice('agent:'.length))?.ws].includes(pid)).reduce((s, p) => s - p.amount_ulxc, 0)
        if (paid + amount > limit) {
          return rule(`the agent has paid ${lxc(paid)} LXC today of its daily limit of ${lxc(limit)} LXC for "${pid}", and this payment would cost ${lxc(amount)} LXC`)
        }
      }
    }
    if (r.approval_above_ulxc > 0 && amount > r.approval_above_ulxc) {
      const ok = this.approvals.find((a) => a.agent_id === agent.id && a.fingerprint === req.fingerprint && a.status === 'approved')
      if (ok !== undefined) {
        ok.status = 'used'
        return undefined
      }
      const a: Approval = { id: id('apr_'), ws: agent.ws, agent_id: agent.id, amount_ulxc: amount, model: req.model ?? '', status: 'pending',
        created_at: new Date().toISOString(), fingerprint: req.fingerprint,
        ...(req.payee === undefined ? {} : { payee: { kind: 'agent', id: req.payee.id, name: req.payee.name } }), ...(req.memo ? { memo: req.memo } : {}) }
      this.approvals.unshift(a)
      return { status: 403, error: `economy: this request would cost up to ${lxc(amount)} LXC, above the agent's approval amount — approval ${a.id} must be approved by the workspace's owner before it is retried` }
    }
    return undefined
  }

  /** An agent's proxied request, judged at its worst case before the model; undefined lets it through. */
  admit(agent: Agent, worst: number, model: string, prompt: string): { status: number; error: string } | undefined {
    const refused = this.judge(agent, worst, { model, fingerprint: createHash('sha256').update(`${agent.id}\0${model}\0${prompt}`).digest('hex') })
    if (refused !== undefined) return refused
    if (worst > this.balance(`agent:${agent.id}`)) return { status: 402, error: 'agent LXC sub-budget exceeded or insufficient balance' }
    this.asked.set(agent.id, [...(this.asked.get(agent.id) ?? []), Date.now()])
    return undefined
  }

  /** What a served request cost, posted from the agent to spend, naming its model — beside the workspace's ledger row. */
  spent(agent: Agent, charge: number, model: string): void {
    if (charge > 0) this.post(agent.ws, 'spend', [[`agent:${agent.id}`, -charge, 'spend'], ['spend', charge, `agent:${agent.id}`]], undefined, modelCapKey(model))
  }

  private statement(ws: string, agentID: string | undefined, url: URL): object | string {
    const day = (s: string | null, dflt: Date): Date | undefined => {
      if (s === null || s === '') return dflt
      const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s)
      return Number.isNaN(t.getTime()) ? undefined : t
    }
    const now = new Date()
    const from = day(url.searchParams.get('from'), new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))
    const to = day(url.searchParams.get('to'), now)
    if (from === undefined || to === undefined) return 'from and to must be RFC 3339 times or YYYY-MM-DD dates'
    const mine = this.postings.filter((p) => p.ws === ws && (agentID === undefined || p.account === `agent:${agentID}`))
    const before = mine.filter((p) => new Date(p.at) < from)
    const within = mine.filter((p) => new Date(p.at) >= from && new Date(p.at) < to)
    const names = [...new Set([...before, ...within].map((p) => p.account))].sort()
    const running = new Map(names.map((n) => [n, before.filter((p) => p.account === n).reduce((s, p) => s + p.amount_ulxc, 0)]))
    const accounts = names.map((n) => {
      const opening = running.get(n) ?? 0
      const moves = within.filter((p) => p.account === n)
      const inn = moves.filter((p) => p.amount_ulxc > 0).reduce((s, p) => s + p.amount_ulxc, 0)
      const out = moves.filter((p) => p.amount_ulxc < 0).reduce((s, p) => s - p.amount_ulxc, 0)
      return { account: n, opening_ulxc: opening, in_ulxc: inn, out_ulxc: out, closing_ulxc: opening + inn - out }
    })
    const lines = within.map((p) => {
      const after = (running.get(p.account) ?? 0) + p.amount_ulxc
      running.set(p.account, after)
      return { posting_id: p.posting_id, entry_id: p.entry_id, at: p.at, account: p.account, kind: p.kind, amount_ulxc: p.amount_ulxc,
        counterparty: p.counterparty, ref: p.ref, balance_after_ulxc: after }
    })
    // The loans and escrows the workspace (or the agent) is party to, as Lens lists them beside the lines (B22.5, B22.6).
    const party = (wss: string[], agents: string[]) => (agentID === undefined ? wss.includes(ws) : agents.includes(agentID))
    const loans = this.loans.filter((l) => party([l.lender_workspace_id, l.borrower_workspace_id], [l.lender_agent_id, l.borrower_agent_id]))
    const escrows = this.escrows.filter((e) => party([e.payer_workspace_id, e.payee_workspace_id], [e.payer_agent_id, e.payee_agent_id]))
    return { workspace_id: ws, agent_id: agentID, from: from.toISOString(), to: to.toISOString(), accounts, lines, loans, escrows }
  }

  private async body<T>(req: IncomingMessage): Promise<T> {
    return JSON.parse((await this.d.read(req)) || '{}') as T
  }

  private pay(res: ServerResponse, ws: BankWorkspace, from: Agent, to: string, amount: number, memo: string): void {
    const { json } = this.d
    if (!(amount > 0)) return json(res, 400, { error: 'body must be {"to_agent_id": "<agent>", "amount_ulxc": <positive µLXC>, "memo": "<optional>"}' })
    const payee = this.agents.get(to)
    if (payee === undefined) return json(res, 404, { error: 'economy: no such agent in this workspace' })
    if (payee.id === from.id) return json(res, 400, { error: 'economy: an agent cannot pay itself' })
    const refused = this.judge(from, amount, { payment: true, payee, memo, fingerprint: `pay\0${from.id}\0${to}\0${amount}\0${memo}` })
    if (refused !== undefined) return json(res, refused.status, { error: refused.error })
    if (payee.ws !== ws.id) {
      // B19.15: another company's agent, through the marketplace: one billed use on the payer's bill.
      const use: Use = { id: id('use_'), listing_id: '', seller: payee.ws, buyer: ws.id, agent_id: from.id, price_ulxc: amount, charge: 'billed',
        used_at: new Date().toISOString(), payee_agent_id: payee.id, memo }
      this.uses.push(use)
      return json(res, 200, { entry_id: use.id, from_agent_id: from.id, to_agent_id: payee.id, amount_ulxc: amount,
        from_balance_ulxc: this.balance(`agent:${from.id}`), to_balance_ulxc: 0, memo, to_workspace_id: payee.ws, via: 'marketplace' })
    }
    if (amount > this.balance(`agent:${from.id}`)) return json(res, 409, { error: `economy: the agent holds ${lxc(this.balance(`agent:${from.id}`))} LXC` })
    const entry = this.post(ws.id, 'pay', [[`agent:${from.id}`, -amount, `agent:${payee.id}`], [`agent:${payee.id}`, amount, `agent:${from.id}`]], memo || undefined)
    return json(res, 200, { entry_id: entry, from_agent_id: from.id, to_agent_id: payee.id, amount_ulxc: amount,
      from_balance_ulxc: this.balance(`agent:${from.id}`), to_balance_ulxc: this.balance(`agent:${payee.id}`), memo })
  }

  /** An agent key paying from its own agent — the one workspace route an agent's key may take. */
  /**
   * B28.349 — Lens's /mcp as Chat uses it (talyvor-lens B28.83): tools/list offers wallet_agents_spend, and tools/call
   * answers what the workspace's agents spent in [from, to) — every line that took money out of an agent to someone
   * else — per agent, each line by its entry, as JSON text.
   */
  mcp(ws: string, rpc: { id?: unknown; method?: string; params?: { name?: string; arguments?: { from?: string; to?: string; agent?: string } } }): object {
    const reply = (result: object) => ({ jsonrpc: '2.0', id: rpc.id ?? null, result })
    if (rpc.method === 'tools/list') {
      return reply({ tools: [{ name: 'wallet_agents_spend',
        description: 'What this workspace’s agents spent over a period, per agent, with every statement line it was spent in. Amounts are µLXC (1 LXC = 1,000,000 µLXC).',
        inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'when the period starts: RFC 3339, or YYYY-MM-DD (midnight UTC); today when not given' },
          to: { type: 'string', description: 'when it ends, the same way; now when not given' },
          agent: { type: 'string', description: 'one agent, by its id or name; every agent when not given' } }, required: [] } }] })
    }
    if (rpc.method !== 'tools/call' || rpc.params?.name !== 'wallet_agents_spend') {
      return { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: `unknown tool: ${rpc.params?.name ?? rpc.method}` } }
    }
    const day = new Date().toISOString().slice(0, 10)
    const from = new Date(rpc.params.arguments?.from || day).toISOString()
    const to = rpc.params.arguments?.to ? new Date(rpc.params.arguments.to).toISOString() : new Date(Date.now() + 1000).toISOString()
    const spentKinds = new Set(['spend', 'settle', 'pay', 'transfer', 'card', 'escrow'])
    const only = rpc.params.arguments?.agent
    const agents = [...this.agents.values()].filter((a) => a.ws === ws && (!only || a.id === only || a.name === only)).map((a) => {
      const lines = this.postings.filter((p) => p.account === `agent:${a.id}` && spentKinds.has(p.kind) && p.amount_ulxc < 0 && p.at >= from && p.at < to)
        .map((p) => ({ entry_id: p.entry_id, kind: p.kind, amount_ulxc: p.amount_ulxc, at: p.at }))
      return { agent_id: a.id, name: a.name, spent_ulxc: -lines.reduce((s, l) => s + l.amount_ulxc, 0), lines }
    }).filter((a) => a.lines.length > 0)
    const total = agents.reduce((s, a) => s + a.spent_ulxc, 0)
    return reply({ content: [{ type: 'text', text: JSON.stringify({ from, to, total_ulxc: total, agents }) }] })
  }

  async agentPay(req: IncomingMessage, res: ServerResponse, key: string, path: string): Promise<boolean> {
    const m = /^\/v1\/workspaces\/([^/]+)\/agents\/([^/]+)\/pay$/.exec(path)
    const who = this.agentOfKey(key)
    if (m === null || who === undefined || req.method !== 'POST') return false
    if (who.ws.id !== m[1] || who.agent.id !== m[2]) {
      this.d.json(res, 403, { error: "only the paying agent's own key, the workspace's owner or an admin may pay from an agent" })
      return true
    }
    const b = await this.body<{ to_agent_id?: string; amount_ulxc?: number; memo?: string }>(req)
    this.pay(res, who.ws, who.agent, b.to_agent_id ?? '', b.amount_ulxc ?? 0, b.memo ?? '')
    return true
  }

  private listingOut(l: Listing, viewer: string): object {
    const vars = typeof l.artifact.template === 'string' ? [...new Set([...l.artifact.template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((x) => x[1]))] : []
    const { artifact, changelog, ...rest } = l
    return { ...rest, versions: [{ version: 1, artifact_sha256: createHash('sha256').update(JSON.stringify(artifact)).digest('hex'), changelog,
      scan: {}, created_at: l.created_at, needs: { input: l.kind === 'agent' || l.kind === 'skill', variables: vars, model: String(artifact.model ?? '') },
      ...(viewer === l.workspace_id ? { artifact } : {}) }] }
  }

  /** GET /v1/marketplace/listings[/{id}]: the public catalog, as anyone signed in reads it. */
  publicRoute(res: ServerResponse, path: string, url: URL, viewer: string): boolean {
    const { json } = this.d
    if (path === '/v1/marketplace/listings') {
      const kind = url.searchParams.get('kind') ?? ''
      json(res, 200, { listings: [...this.listings.values()].filter((l) => l.visibility === 'public' && this.visible(l, viewer) && (kind === '' || l.kind === kind))
        .map((l) => { const { artifact: _a, changelog: _c, ...rest } = l; return rest }) })
      return true
    }
    const m = /^\/v1\/marketplace\/listings\/([^/]+)$/.exec(path)
    if (m === null) return false
    const l = this.listings.get(m[1])
    if (l === undefined || !this.visible(l, viewer)) json(res, 404, { error: 'market: no such listing' })
    else json(res, 200, this.listingOut(l, viewer))
    return true
  }

  // ─── B25.4: money between owners, and what the moderators and a seller's Stripe account do ───

  private broken(name: string): boolean {
    return this.d.brk.split(',').includes(name)
  }

  /**
   * B28.32 — the agent's rules with its boosts in force now laid over them, as Lens's agentRulesInForce reads them: a
   * boost raises its limit only while the rules leave it where it was, and from its time on it is not read.
   */
  private rulesInForce(a: Agent): Rules {
    const r = structuredClone(a.rules)
    for (const b of (a.boosts ?? []).filter((x) => Date.parse(x.until) > Date.now())) {
      if (r[b.rule] === b.raised_from && b.value > r[b.rule]) r[b.rule] = b.value
    }
    return r
  }

  /**
   * B28.31 — records the agent's rules as its next version, as Lens's recordRulesVersion does, unless they are its
   * latest: by the workspace's session (Lens mints it with the workspace as its user), and how.
   */
  private recordRules(a: Agent, ws: string, change: string): void {
    const versions = (a.versions ??= [])
    if (versions.length > 0 && JSON.stringify(versions[0].rules) === JSON.stringify(a.rules)) return
    versions.unshift({ version: versions.length + 1, rules: structuredClone(a.rules), changed_by: `jwt:user:${ws}`, change, created_at: new Date().toISOString() })
  }

  /**
   * Moves `amount` from `from` to `to` as Lens's transfers do (B22.3): judged by the payer's rules, one
   * posting on each side's book with the transfer as its ref. A refusal is its status and sentence.
   */
  private transfer(from: Agent, to: Agent, amount: number, memo: string, links: Partial<Transfer> = {}, credit = true): Transfer | { status: number; error: string } {
    if (!(amount > 0)) return { status: 400, error: 'economy: the amount must be positive µLXC' }
    if (from.id === to.id) return { status: 400, error: 'economy: an agent cannot pay itself' }
    const refused = this.judge(from, amount, { payment: true, fingerprint: `send\0${from.id}\0${to.id}\0${amount}\0${memo}\0${Date.now()}` })
    if (refused !== undefined) return refused
    const have = this.balance(`agent:${from.id}`)
    if (amount > have) return { status: 409, error: `economy: the agent holds ${lxc(have)} LXC` }
    const t: Transfer = { id: id('xfr_'), from_workspace_id: from.ws, from_agent_id: from.id, to_workspace_id: to.ws, to_agent_id: to.id, amount_ulxc: amount,
      memo, class: from.ws === to.ws ? 'GREEN' : 'AMBER', test_funded_ulxc: amount, created_at: new Date().toISOString(), ...links }
    this.transfers.unshift(t)
    this.post(from.ws, 'transfer', [[`agent:${from.id}`, -amount, `agent:${to.id}`]], t.id)
    if (credit) this.post(to.ws, 'transfer', [[`agent:${to.id}`, amount, `agent:${from.id}`]], t.id)
    return t
  }

  /** An agent by its wallet ID (or @handle, which the stub does not give out). */
  private wallet(address: string): Agent | undefined {
    return this.agents.get(address.trim())
  }

  /** Lens's minute tick (cmd/lens): every recurring transfer due, every loan instalment due, then every cash-out's next step. */
  tick(now = Date.now()): void {
    // B25.8 — a loan's instalment due is taken from the borrower (principal, interest and, when late, the
    // late fee), or missed: once, the loan is late and tried a period on; again, it is in default.
    for (const l of this.loans) {
      if ((l.status !== 'active' && l.status !== 'late') || l.next_due_at === undefined || Date.parse(l.next_due_at) > now) continue
      const k = l.paid_instalments + 1
      const interest = Math.floor(l.principal_ulxc * l.interest_bps / 10_000)
      const [p, i] = k === l.instalments
        ? [l.principal_ulxc - Math.floor(l.principal_ulxc / l.instalments) * (l.instalments - 1), interest - Math.floor(interest / l.instalments) * (l.instalments - 1)]
        : [Math.floor(l.principal_ulxc / l.instalments), Math.floor(interest / l.instalments)]
      const from = this.agents.get(l.borrower_agent_id)
      const to = this.agents.get(l.lender_agent_id)
      const at = new Date(now).toISOString()
      const t = from === undefined || to === undefined ? { status: 404, error: 'economy: no such agent' }
        : this.transfer(from, to, p + i + (l.status === 'late' ? l.late_fee_ulxc : 0), `loan ${l.id}: instalment ${k} of ${l.instalments}`, { loan_id: l.id }, !this.broken('loan-repay-lost'))
      if ('id' in t) {
        l.events.push({ kind: 'instalment', transfer_id: t.id, at })
        l.paid_instalments = k
        l.status = k === l.instalments ? 'repaid' : 'active'
        l.next_due_at = k === l.instalments ? undefined : new Date(Date.parse(l.decided_at ?? at) + (k + 1) * PERIOD_MS[l.every]).toISOString()
      } else if (l.status === 'late' && !this.broken('loan-default-never')) {
        l.events.push({ kind: 'missed', at }, { kind: 'defaulted', at })
        l.status = 'defaulted'
        l.next_due_at = undefined
      } else {
        l.events.push({ kind: 'missed', at }, { kind: 'late', at })
        l.status = 'late'
        l.next_due_at = new Date(Date.parse(l.next_due_at) + PERIOD_MS[l.every]).toISOString()
      }
    }
    for (const sc of this.schedules) {
      while (sc.active && Date.parse(sc.next_run_at) <= now) {
        const from = this.agents.get(sc.from_agent_id)
        const to = this.agents.get(sc.to_agent_id)
        const at = sc.next_run_at
        for (let n = this.broken('schedule-twice') ? 2 : 1; n > 0; n--) {
          const t = from === undefined || to === undefined ? { status: 404, error: 'economy: no such agent' } : this.transfer(from, to, sc.amount_ulxc, sc.memo, { schedule_id: sc.id })
          sc.runs.unshift('id' in t ? { tick_at: at, outcome: 'paid', entry_id: t.id, created_at: new Date(now).toISOString() }
            : { tick_at: at, outcome: 'refused', detail: t.error, created_at: new Date(now).toISOString() })
        }
        sc.next_run_at = new Date(Date.parse(at) + (PERIOD_MS[sc.every] ?? PERIOD_MS.month)).toISOString()
      }
    }
    for (const c of this.cashOuts) {
      if (c.status === 'held') {
        c.status = 'submitted'
        c.partner_ref = id('tco_')
      } else if (c.status === 'submitted') {
        c.status = 'paid'
        c.decided_at = new Date(now).toISOString()
        this.post(c.workspace_id, 'cash_out', [[`cash_out:${c.id}`, -c.amount_ulxc, 'partner:test']], c.id)
      }
    }
  }

  /**
   * B25.8 — Lens B25.7's synthetic-key routes that bring a test workspace's slow money due now (every stub
   * workspace is a test one): a loan's instalment, the buyer's bill paid and refunded, a purchase on a card.
   */
  async syntheticRoute(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    const { json } = this.d
    const now = new Date().toISOString()
    let m = /^\/v1\/synthetic\/workspaces\/([^/]+)\/loans\/([^/]+)\/due$/.exec(path)
    if (m !== null) {
      const l = this.loans.find((x) => x.id === m?.[2] && (x.lender_workspace_id === m[1] || x.borrower_workspace_id === m[1]) && (x.status === 'active' || x.status === 'late'))
      if (l === undefined) return json(res, 404, { error: 'no active or late test loan of this workspace has that id' }), true
      if (l.next_due_at === undefined || l.next_due_at > now) l.next_due_at = now
      return json(res, 200, l), true
    }
    if ((m = /^\/v1\/synthetic\/workspaces\/([^/]+)\/marketplace\/bill\/pay$/.exec(path)) !== null) {
      const due = this.uses.filter((u) => u.buyer === m?.[1] && u.charge === 'billed' && u.cleared_at === undefined && u.refunded_at === undefined)
      if (due.length === 0) return json(res, 409, { error: 'the bill holds no metered, unpaid marketplace use (a paid use is metered within a minute)' }), true
      const invoice = id('in_synthetic_')
      for (const u of due) Object.assign(u, { invoice, cleared_at: now })
      return json(res, 200, { invoice_id: invoice, uses_cleared: due.length }), true
    }
    if ((m = /^\/v1\/synthetic\/workspaces\/([^/]+)\/marketplace\/bill\/([^/]+)\/refund$/.exec(path)) !== null) {
      const paid = this.uses.filter((u) => u.invoice === m?.[2] && u.buyer === m?.[1])
      if (paid.length === 0) return json(res, 404, { error: 'market: no paid bill of this test workspace has that id' }), true
      const refunded = paid.filter((u) => u.refunded_at === undefined)
      for (const u of refunded) Object.assign(u, { refunded_at: now, kept: this.broken('bill-refund-kept') })
      return json(res, 200, { invoice_id: m[2], uses_refunded: refunded.length }), true
    }
    if ((m = /^\/v1\/synthetic\/workspaces\/([^/]+)\/agents\/([^/]+)\/card\/authorizations$/.exec(path)) !== null && req.method === 'POST') {
      const a = this.agents.get(m[2])
      if (a === undefined || a.ws !== m[1] || !this.cards.has(a.id)) return json(res, 404, { error: 'economy: the agent has no card' }), true
      const b = await this.body<{ amount_minor?: number; currency?: string; merchant?: string; category?: string }>(req)
      const minor = b.amount_minor ?? 2000
      const usd = minor * USD_MICROS_PER_PENNY
      const cost = usd * ULXC_PER_USD_MICRO
      const refused = this.judge(a, cost, { payment: true, fingerprint: `card\0${a.id}\0${Date.now()}` })?.error
        ?? (cost > this.balance(`agent:${a.id}`) ? `the agent holds ${lxc(this.balance(`agent:${a.id}`))} LXC and this purchase costs ${lxc(cost)} LXC` : undefined)
      const auth: CardAuth = { id: id('cau_'), agent_id: a.id, authorization_id: id('iauth_synthetic_'), approved: refused === undefined,
        reason: refused ?? "within the agent's rules", amount_minor: minor, currency: (b.currency ?? 'gbp').toLowerCase(), merchant_name: b.merchant ?? 'Synthetic merchant',
        merchant_category: b.category ?? 'miscellaneous_general_merchandise', amount_usd_micros: usd, amount_ulxc: cost, created_at: now }
      this.cardAuths.unshift(auth)
      if (auth.approved && !this.broken('card-free')) {
        this.post(a.ws, 'card', [[`agent:${a.id}`, -cost, 'spend'], ['spend', cost, `agent:${a.id}`]], auth.authorization_id)
        this.d.credit(a.ws, -cost, 'agent_card', `card purchase at ${auth.merchant_name}`)
      }
      return json(res, 200, { authorization_id: auth.authorization_id, approved: auth.approved, reason: auth.reason, amount_ulxc: cost }), true
    }
    return false
  }

  /** /v1/admin/marketplace/…: the moderators' queue, behind a moderator key naming its operator (B20.13). */
  async moderatorRoute(req: IncomingMessage, res: ServerResponse, key: string, path: string): Promise<boolean> {
    if (!path.startsWith('/v1/admin/marketplace/')) return false
    const { json } = this.d
    if (this.d.moderatorKey === '' || key !== this.d.moderatorKey) return json(res, 401, { error: 'admin credentials required' }), true
    if (String(req.headers['x-talyvor-operator'] ?? '').trim() === '') {
      return json(res, 400, { error: 'a moderator key must name the operator it acts for in X-Talyvor-Operator' }), true
    }
    if (path === '/v1/admin/marketplace/review' && req.method === 'GET') {
      const open = (l: Listing) => this.reports.filter((r) => r.listing_id === l.id && !r.resolved)
      return json(res, 200, { listings: [...this.listings.values()].filter((l) => l.review_status === 'held' || (l.review_status !== 'taken_down' && open(l).length > 0))
        .map((l) => ({ listing: this.listingOut(l, l.workspace_id), open_reports: open(l).length, report_reasons: [...new Set(open(l).map((r) => r.reason))],
          report_details: open(l).map((r) => r.details) })) }), true
    }
    const m = /^\/v1\/admin\/marketplace\/listings\/([^/]+)\/(approve|takedown)$/.exec(path)
    if (m === null || req.method !== 'POST') return this.d.miss(req, res, path), true
    const l = this.listings.get(m[1])
    if (l === undefined) return json(res, 404, { error: 'market: no such listing' }), true
    if (m[2] === 'approve') {
      if (!this.broken('approve-noop')) l.review_status = 'approved'
      return json(res, 200, this.listingOut(l, l.workspace_id)), true
    }
    const { reason = '' } = await this.body<{ reason?: string }>(req)
    if (reason.trim() === '') return json(res, 400, { error: 'market: a takedown needs a reason of at most 500 characters' }), true
    l.review_status = 'taken_down'
    for (const r of this.reports) if (r.listing_id === l.id) r.resolved = true
    const now = new Date().toISOString()
    const refunds = this.broken('takedown-no-refund') ? [] : this.uses.filter((u) => u.listing_id === l.id && u.charge === 'billed' && u.refunded_at === undefined)
    for (const u of refunds) u.refunded_at = now
    return json(res, 200, { listing: this.listingOut(l, l.workspace_id), refunds: refunds.map((u) => ({ use_id: u.id, listing_id: l.id,
      buyer_workspace_id: u.buyer, seller_workspace_id: u.seller, price_ulxc: u.price_ulxc, refunded_at: now })) }), true
  }

  /** Writes a signed-in person makes outside their workspace: a report on a listing; and wallet lookups. */
  async publicWrite(req: IncomingMessage, res: ServerResponse, path: string, viewer: string): Promise<boolean> {
    const { json } = this.d
    if (path === '/v1/wallets/capabilities') {
      const b30 = this.broken('b30-capability-gone') ? B30_CAPABILITIES.filter((c) => c.capability !== 'fx') : B30_CAPABILITIES
      return json(res, 200, { capabilities: [...CAPABILITIES, ...b30] }), true
    }
    let m = /^\/v1\/wallets\/([^/]+)$/.exec(path)
    if (m !== null) {
      const a = this.wallet(decodeURIComponent(m[1]))
      return (a === undefined ? json(res, 404, { error: 'economy: no wallet has that ID or handle' }) : json(res, 200, { wallet_id: a.id, name: a.name })), true
    }
    m = /^\/v1\/marketplace\/listings\/([^/]+)\/reports$/.exec(path)
    if (m === null || req.method !== 'POST') return false
    const l = this.listings.get(m[1])
    if (l === undefined || !this.visible(l, viewer)) return json(res, 404, { error: 'market: no such listing' }), true
    const b = await this.body<{ reason?: string; details?: string }>(req)
    if (!b.reason) return json(res, 400, { error: 'market: a report needs its reason' }), true
    const r: Report = { id: id('rpt_'), listing_id: l.id, reporter: viewer, reason: b.reason, details: b.details ?? '', created_at: new Date().toISOString(), resolved: false }
    if (!this.broken('report-lost')) this.reports.push(r)
    const { reporter: _r, resolved: _x, ...out } = r
    return json(res, 201, out), true
  }

  /**
   * B25.8 — a seller's earnings in µUSD: the uses of their listings on a paid bill are payable at once (Lens
   * B25.7 pays a test bill a holdback ago), less what a refund reversed and what was paid out.
   */
  private earnings(ws: string): { lifetime: number; refunded: number; available: number; paid: number } {
    const cleared = this.uses.filter((u) => u.seller === ws && u.cleared_at !== undefined)
    const share = (us: Use[]) => us.reduce((s, u) => s + u.price_ulxc / ULXC_PER_USD_MICRO, 0)
    const reversed = cleared.filter((u) => u.refunded_at !== undefined && !u.kept)
    const paid = this.payouts.filter((p) => p.ws === ws).reduce((s, p) => s + p.gross_usd_micros, 0)
    return { lifetime: share(cleared), refunded: share(reversed), available: Math.max(share(cleared) - share(reversed) - paid, 0), paid }
  }

  /** Whether `viewer` may see listing `l`: held and taken-down listings are their owner's alone. */
  private visible(l: Listing, viewer: string): boolean {
    if (l.workspace_id === viewer) return true
    if (l.review_status === 'held') return this.broken('review-public')
    return l.review_status === 'approved' && l.visibility !== 'private'
  }

  /** The routes of money between owners (B22) under /v1/workspaces/{ws}; true when `rest` was one. */
  private async walletRoute(req: IncomingMessage, res: ServerResponse, ws: BankWorkspace, rest: string): Promise<boolean> {
    const { json } = this.d
    const method = req.method ?? 'GET'
    const now = new Date().toISOString()
    const answer = (x: object | { status: number; error: string }, ok = 200) => 'error' in x && 'status' in x ? json(res, x.status as number, { error: x.error }) : json(res, ok, x)
    let m: RegExpExecArray | null
    if (rest === '/credit-line') return json(res, 404, { error: 'economy: the workspace has no credit line' }), true
    if ((m = /^\/transfers\/([^/]+)\/refund$/.exec(rest)) !== null && method === 'POST') {
      const t = this.transfers.find((x) => x.id === m?.[1] && x.to_workspace_id === ws.id)
      if (t === undefined) return json(res, 404, { error: 'economy: no such transfer to this workspace' }), true
      if (this.transfers.some((x) => x.refund_of === t.id)) return json(res, 409, { error: 'economy: the transfer was already given back' }), true
      const from = this.agents.get(t.to_agent_id)
      const to = this.agents.get(t.from_agent_id)
      if (from === undefined || to === undefined) return json(res, 404, { error: 'economy: no such agent' }), true
      return answer(this.transfer(from, to, t.amount_ulxc, `refund: ${t.memo}`, { refund_of: t.id }, !this.broken('refund-kept'))), true
    }
    if (rest === '/money-requests' && method === 'GET') {
      return json(res, 200, { requests: this.requests.filter((r) => r.from_workspace_id === ws.id || r.to_workspace_id === ws.id) }), true
    }
    if ((m = /^\/money-requests\/([^/]+)\/(accept|decline)$/.exec(rest)) !== null && method === 'POST') {
      const r = this.requests.find((x) => x.id === m?.[1] && x.to_workspace_id === ws.id && x.status === 'pending')
      if (r === undefined) return json(res, 404, { error: 'economy: no such pending request to this workspace' }), true
      if (m[2] === 'accept' && !this.broken('request-unpaid')) {
        const payer = this.agents.get(r.to_agent_id)
        const payee = this.agents.get(r.from_agent_id)
        if (payer === undefined || payee === undefined) return json(res, 404, { error: 'economy: no such agent' }), true
        const t = this.transfer(payer, payee, r.amount_ulxc, r.memo, { request_id: r.id })
        if (!('id' in t)) return answer(t), true
        r.transfer_id = t.id
      }
      r.status = m[2] === 'accept' ? 'accepted' : 'declined'
      r.decided_at = now
      return json(res, 200, r), true
    }
    if (rest === '/loans' && method === 'GET') {
      return json(res, 200, { loans: this.loans.filter((l) => l.lender_workspace_id === ws.id || l.borrower_workspace_id === ws.id) }), true
    }
    if ((m = /^\/loans\/([^/]+)\/(accept|decline|withdraw)$/.exec(rest)) !== null && method === 'POST') {
      const l = this.loans.find((x) => x.id === m?.[1] && x.status === 'offered' && (m?.[2] === 'withdraw' ? x.lender_workspace_id : x.borrower_workspace_id) === ws.id)
      if (l === undefined) return json(res, 404, { error: 'economy: no such loan offered' }), true
      if (m[2] === 'accept') {
        const lender = this.agents.get(l.lender_agent_id)
        const borrower = this.agents.get(l.borrower_agent_id)
        if (lender === undefined || borrower === undefined) return json(res, 404, { error: 'economy: no such agent' }), true
        const t = this.transfer(lender, borrower, l.principal_ulxc, l.memo, { loan_id: l.id }, !this.broken('loan-no-payout'))
        if (!('id' in t)) return answer(t), true
        l.events.push({ kind: 'payout', transfer_id: t.id, at: now })
        l.next_due_at = new Date(Date.parse(now) + PERIOD_MS[l.every]).toISOString()
      }
      l.status = { accept: 'active', decline: 'declined', withdraw: 'withdrawn' }[m[2] as 'accept' | 'decline' | 'withdraw']
      l.decided_at = now
      return json(res, 200, l), true
    }
    if (rest === '/escrows' && method === 'GET') {
      return json(res, 200, { escrows: this.escrows.filter((e) => e.payer_workspace_id === ws.id || e.payee_workspace_id === ws.id) }), true
    }
    if ((m = /^\/escrows\/([^/]+)\/(confirm|dispute)$/.exec(rest)) !== null && method === 'POST') {
      const e = this.escrows.find((x) => x.id === m?.[1] && x.payer_workspace_id === ws.id && x.status === 'held')
      if (e === undefined) return json(res, 404, { error: 'economy: no such escrow held by this workspace' }), true
      const release = () => {
        this.post(e.payer_workspace_id, 'escrow', [[`escrow:${e.id}`, -e.amount_ulxc, `agent:${e.payee_agent_id}`]], e.id)
        if (!this.broken('escrow-release-lost')) this.post(e.payee_workspace_id, 'escrow', [[`agent:${e.payee_agent_id}`, e.amount_ulxc, `escrow:${e.id}`]], e.id)
      }
      if (m[2] === 'confirm') {
        release()
        e.status = 'released'
        e.events.push({ kind: 'released', actor: 'payer', at: now })
      } else {
        const { reason = '' } = await this.body<{ reason?: string }>(req)
        if (reason.trim() === '') return json(res, 400, { error: 'economy: a dispute needs its reason' }), true
        if (this.broken('escrow-dispute-pays')) release()
        e.status = 'disputed'
        e.events.push({ kind: 'disputed', actor: 'payer', detail: reason, at: now })
      }
      e.decided_at = now
      return json(res, 200, e), true
    }
    if (rest === '/cash-outs' && method === 'GET') return json(res, 200, { cash_outs: this.cashOuts.filter((c) => c.workspace_id === ws.id) }), true
    if ((m = /^\/agents\/schedules\/([^/]+)(\/runs)?$/.exec(rest)) !== null) {
      const sc = this.schedules.find((x) => x.id === m?.[1] && x.ws === ws.id)
      if (sc === undefined) return json(res, 404, { error: 'economy: no such schedule in this workspace' }), true
      if (m[2] === '/runs') return json(res, 200, { runs: sc.runs }), true
      if (method === 'DELETE') {
        sc.active = false
        return json(res, 200, { active: false }), true
      }
      return false
    }
    if (rest === '/agents/schedules' && method === 'GET') {
      return json(res, 200, { schedules: this.schedules.filter((x) => x.ws === ws.id && x.active).map(({ ws: _w, runs: _r, ...x }) => x) }), true
    }
    if ((m = /^\/agents\/([^/]+)\/pots\/([^/]+)\/(in|out)$/.exec(rest)) !== null && method === 'POST') {
      const a = this.agents.get(m[1])
      const pot = this.pots.find((x) => x.id === m?.[2] && x.agent_id === a?.id)
      if (a === undefined || a.ws !== ws.id || pot === undefined) return json(res, 404, { error: 'economy: no such pot' }), true
      const { amount_ulxc: n = 0 } = await this.body<{ amount_ulxc?: number }>(req)
      const have = this.balance(m[3] === 'in' ? `agent:${a.id}` : `pot:${pot.id}`)
      if (!(n > 0) || n > have) return json(res, 409, { error: `economy: there are only ${lxc(have)} LXC to move` }), true
      if (m[3] === 'in') this.post(ws.id, 'pot', [[`agent:${a.id}`, -n, `pot:${pot.id}`], [`pot:${pot.id}`, n, `agent:${a.id}`]], pot.id)
      else this.post(ws.id, 'pot', this.broken('pot-out-lost') ? [[`pot:${pot.id}`, -n, `agent:${a.id}`]] : [[`pot:${pot.id}`, -n, `agent:${a.id}`], [`agent:${a.id}`, n, `pot:${pot.id}`]], pot.id)
      return json(res, 200, { ...pot, balance_ulxc: this.balance(`pot:${pot.id}`) }), true
    }
    return false
  }

  /** An agent's own route of money between owners: send, request, transfers, loans, escrow, pots, schedules, cash-out, card. */
  private async agentWalletRoute(req: IncomingMessage, res: ServerResponse, ws: BankWorkspace, a: Agent, action: string): Promise<boolean> {
    const { json } = this.d
    const method = req.method ?? 'GET'
    const now = new Date().toISOString()
    const answer = (x: object | { status: number; error: string }, ok = 200) => 'error' in x && 'status' in x ? json(res, x.status as number, { error: x.error }) : json(res, ok, x)
    if (action === '/transfers' && method === 'GET') {
      // B28.299: what gave each back, and whether this agent may still give back one it received.
      return json(res, 200, { transfers: this.transfers.filter((t) => t.from_agent_id === a.id || t.to_agent_id === a.id).map((t) => {
        const refunded_by = this.transfers.find((x) => x.refund_of === t.id)?.id
        return { ...t, ...(refunded_by ? { refunded_by } : {}), ...(t.to_agent_id === a.id && !t.refund_of && !t.loan_id && !refunded_by ? { refundable: true } : {}) }
      }) }), true
    }
    if (action === '/send' && method === 'POST') {
      const b = await this.body<{ to?: string; amount_ulxc?: number; memo?: string }>(req)
      const to = this.wallet(b.to ?? '')
      if (to === undefined) return json(res, 404, { error: 'economy: no wallet has that ID or handle' }), true
      return answer(this.transfer(a, to, b.amount_ulxc ?? 0, b.memo ?? '', {}, !this.broken('send-one-side'))), true
    }
    if (action === '/requests' && method === 'POST') {
      const b = await this.body<{ from?: string; amount_ulxc?: number; memo?: string }>(req)
      const payer = this.wallet(b.from ?? '')
      if (payer === undefined) return json(res, 404, { error: 'economy: no wallet has that ID or handle' }), true
      if (!((b.amount_ulxc ?? 0) > 0)) return json(res, 400, { error: 'economy: the amount must be positive µLXC' }), true
      const r: MoneyReq = { id: id('mrq_'), from_workspace_id: ws.id, from_agent_id: a.id, to_workspace_id: payer.ws, to_agent_id: payer.id,
        amount_ulxc: b.amount_ulxc ?? 0, memo: b.memo ?? '', status: 'pending', created_at: now }
      this.requests.unshift(r)
      return json(res, 201, r), true
    }
    if (action === '/loans' && method === 'POST') {
      const b = await this.body<{ to?: string; principal_ulxc?: number; interest_bps?: number; instalments?: number; every?: string; late_fee_ulxc?: number; memo?: string }>(req)
      const borrower = this.wallet(b.to ?? '')
      if (borrower === undefined) return json(res, 404, { error: 'economy: no wallet has that ID or handle' }), true
      if (borrower.ws === ws.id) return json(res, 400, { error: 'economy: a loan is to another company\'s agent' }), true
      if (!((b.principal_ulxc ?? 0) > 0) || !((b.instalments ?? 0) >= 1) || !['day', 'week', 'month'].includes(b.every ?? '')) {
        return json(res, 400, { error: 'economy: a loan needs a principal, at least one instalment and every day, week or month' }), true
      }
      const l: Loan = { id: id('loan_'), lender_workspace_id: ws.id, lender_agent_id: a.id, borrower_workspace_id: borrower.ws, borrower_agent_id: borrower.id,
        principal_ulxc: b.principal_ulxc ?? 0, interest_bps: b.interest_bps ?? 0, instalments: b.instalments ?? 1, every: b.every ?? 'month',
        late_fee_ulxc: b.late_fee_ulxc ?? 0, memo: b.memo ?? '', status: 'offered', paid_instalments: 0, offered_at: now, events: [] }
      this.loans.unshift(l)
      return json(res, 201, l), true
    }
    if (action === '/escrows' && method === 'POST') {
      const b = await this.body<{ to?: string; amount_ulxc?: number; release_at?: string; memo?: string }>(req)
      const payee = this.wallet(b.to ?? '')
      const n = b.amount_ulxc ?? 0
      if (payee === undefined) return json(res, 404, { error: 'economy: no wallet has that ID or handle' }), true
      if (!(Date.parse(b.release_at ?? '') > Date.now())) return json(res, 400, { error: 'economy: the release date must be in the future' }), true
      const have = this.balance(`agent:${a.id}`)
      if (!(n > 0) || n > have) return json(res, 409, { error: `economy: the agent holds ${lxc(have)} LXC` }), true
      const e: Escrow = { id: id('esc_'), payer_workspace_id: ws.id, payer_agent_id: a.id, payee_workspace_id: payee.ws, payee_agent_id: payee.id, amount_ulxc: n,
        memo: b.memo ?? '', class: payee.ws === ws.id ? 'GREEN' : 'AMBER', test_funded_ulxc: n, release_at: new Date(Date.parse(b.release_at ?? '')).toISOString(),
        status: 'held', created_at: now, events: [{ kind: 'held', actor: 'payer', at: now }] }
      this.escrows.unshift(e)
      if (!this.broken('escrow-open-free')) this.post(ws.id, 'escrow', [[`agent:${a.id}`, -n, `escrow:${e.id}`], [`escrow:${e.id}`, n, `agent:${a.id}`]], e.id)
      return json(res, 201, e), true
    }
    if (action === '/pots' && method === 'GET') {
      return json(res, 200, { pots: this.pots.filter((p) => p.agent_id === a.id).map((p) => ({ ...p, balance_ulxc: this.balance(`pot:${p.id}`) })) }), true
    }
    if (action === '/pots' && method === 'POST') {
      const b = await this.body<{ name?: string; kind?: string; target_ulxc?: number; locked_until?: string | null }>(req)
      if (!b.name?.trim()) return json(res, 400, { error: 'economy: a pot needs a name' }), true
      const p: Pot = { id: id('pot_'), agent_id: a.id, name: b.name.trim(), kind: b.kind ?? 'goal', target_ulxc: b.target_ulxc || undefined,
        locked_until: b.locked_until ?? undefined, created_at: now }
      this.pots.push(p)
      return json(res, 201, { ...p, balance_ulxc: 0 }), true
    }
    if (action === '/schedules' && method === 'POST') {
      const b = await this.body<{ to_agent_id?: string; amount_ulxc?: number; memo?: string; every?: string; first_run_at?: string }>(req)
      const to = this.wallet(b.to_agent_id ?? '')
      if (to === undefined) return json(res, 404, { error: 'economy: no such agent' }), true
      if (!((b.amount_ulxc ?? 0) > 0) || PERIOD_MS[b.every ?? ''] === undefined) return json(res, 400, { error: 'economy: a schedule needs an amount and every hour, day, week or month' }), true
      const sc: Schedule = { id: id('sch_'), ws: ws.id, from_agent_id: a.id, to_agent_id: to.id, amount_ulxc: b.amount_ulxc ?? 0, memo: b.memo ?? '', every: b.every ?? 'month',
        next_run_at: b.first_run_at ?? now, active: true, created_at: now, runs: [] }
      this.schedules.push(sc)
      const { ws: _w, runs: _r, ...out } = sc
      return json(res, 201, out), true
    }
    if (action === '/cash-outs' && method === 'POST') {
      const b = await this.body<{ amount_ulxc?: number; destination?: string }>(req)
      const n = b.amount_ulxc ?? 0
      const have = this.balance(`agent:${a.id}`)
      if (!b.destination?.trim()) return json(res, 400, { error: 'economy: a cash-out needs where it is paid' }), true
      if (!(n > 0) || n > have) return json(res, 409, { error: `economy: the agent holds ${lxc(have)} LXC` }), true
      const c: CashOut = { id: id('cso_'), workspace_id: ws.id, agent_id: a.id, amount_ulxc: n, amount_uusd: n / 10, test_funded_ulxc: n,
        destination: b.destination.trim(), partner: 'test', status: 'held', created_at: now }
      this.cashOuts.unshift(c)
      if (!this.broken('cash-out-free')) this.post(ws.id, 'cash_out', [[`agent:${a.id}`, -n, `cash_out:${c.id}`], [`cash_out:${c.id}`, n, `agent:${a.id}`]], c.id)
      return json(res, 201, c), true
    }
    if (action === '/card' && method === 'GET') {
      const card = this.cards.get(a.id)
      const authorizations = this.cardAuths.filter((x) => x.agent_id === a.id)
      return (card === undefined ? json(res, 404, { error: 'economy: the agent has no card' }) : json(res, 200, { card, authorizations })), true
    }
    if (action === '/card' && method === 'POST') {
      const h = await this.body<Record<string, string>>(req)
      const missing = ['first_name', 'last_name', 'line1', 'city', 'postal_code'].filter((k) => !(h[k] ?? '').trim())
      if (missing.length > 0) return json(res, 400, { error: `agentcard: the cardholder needs ${missing.join(', ')}` }), true
      if (this.cards.has(a.id)) return json(res, 409, { error: 'economy: the agent already has a card' }), true
      const card = { id: id('ic_'), agent_id: a.id, last4: String(1000 + Math.floor(Math.random() * 9000)), exp_month: 12,
        exp_year: new Date().getUTCFullYear() + 3, currency: 'gbp', livemode: this.broken('card-live'), created_at: now }
      this.cards.set(a.id, card)
      return json(res, 201, card), true
    }
    return false
  }

  /** A route under /v1/workspaces/{ws}: answers true when it was one of the bank's or the marketplace's. */
  async workspaceRoute(req: IncomingMessage, res: ServerResponse, ws: BankWorkspace, rest: string, url: URL): Promise<boolean> {
    const { json } = this.d
    const method = req.method ?? 'GET'
    const now = new Date().toISOString()
    let m: RegExpExecArray | null
    if (rest === '/agents' && method === 'GET') return json(res, 200, this.book(ws)), true
    if (rest === '/agents' && method === 'POST') {
      const { name = '' } = await this.body<{ name?: string }>(req)
      if (name === '') return json(res, 400, { error: 'body must be {"name": "<agent name>"}' }), true
      const a: Agent = { id: id('agt_'), ws: ws.id, name, owner_user_id: ws.id, created_at: now, keys: [], rules: noRules() }
      this.agents.set(a.id, a)
      return json(res, 201, { ...a, rules: undefined, balance_ulxc: 0, spent_ulxc: 0 }), true
    }
    if (rest === '/agents/approvals') {
      return json(res, 200, { approvals: this.approvals.filter((a) => a.ws === ws.id).map(({ fingerprint: _f, ws: _w, ...a }) => a) }), true
    }
    if ((m = /^\/agents\/approvals\/([^/]+)\/(approve|deny)$/.exec(rest)) !== null && method === 'POST') {
      const a = this.approvals.find((x) => x.id === m?.[1] && x.ws === ws.id && x.status === 'pending')
      if (a === undefined) return json(res, 404, { error: 'economy: no such pending approval in this workspace' }), true
      a.status = m[2] === 'approve' ? 'approved' : 'denied'
      a.decided_at = now
      const { fingerprint: _f, ws: _w, ...out } = a
      return json(res, 200, out), true
    }
    if (rest === '/agents/statement' && method === 'GET') {
      const st = this.statement(ws.id, undefined, url)
      return json(res, typeof st === 'string' ? 400 : 200, typeof st === 'string' ? { error: st } : st), true
    }
    if (rest === '/agents/alerts') return json(res, 200, { alerts: [], rule: 'an alert when an agent\'s last hour reaches 5× its usual hourly rate' }), true
    if (rest === '/agents/forecast') {
      // Lens economy.AgentSpendForecast: every agent, its spend postings since the first of the UTC month
      // (agentSpendPostings: spend, hold, settle, release, card, and pay out), run on to the month's end.
      const d = new Date()
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
      const runOn = (spent: number) => (spent <= 0 ? Math.max(spent, 0) : Math.floor((spent * (end.getTime() - start.getTime())) / Math.max(1, d.getTime() - start.getTime())))
      const agents = [...this.agents.values()].filter((a) => a.ws === ws.id).map((a) => {
        const spent = this.postings.filter((p) => p.account === `agent:${a.id}` && p.at >= start.toISOString() &&
          (['spend', 'hold', 'settle', 'release', 'card'].includes(p.kind) || (p.kind === 'pay' && p.amount_ulxc < 0)))
          .reduce((s, p) => s - p.amount_ulxc, 0)
        return { agent_id: a.id, name: a.name, spent_ulxc: spent, forecast_ulxc: runOn(spent) }
      })
      const spent = agents.reduce((s, a) => s + a.spent_ulxc, 0)
      return json(res, 200, { at: now, month_start: start.toISOString(), month_end: end.toISOString(), spent_ulxc: spent, forecast_ulxc: runOn(spent), agents }), true
    }
    if (await this.walletRoute(req, res, ws, rest)) return true
    if (rest === '/agents/passkeys') return json(res, 200, { passkeys: [] }), true
    if (rest === '/agents/push/public-key') return json(res, 404, { error: 'economy: web push is not configured' }), true
    if (rest === '/agents/pause-all' || rest === '/agents/resume-all') {
      if (rest === '/agents/pause-all') this.allPaused.set(ws.id, { at: now, reason: (await this.body<{ reason?: string }>(req)).reason ?? '' })
      else this.allPaused.delete(ws.id)
      return json(res, 200, { all_paused: rest === '/agents/pause-all' }), true
    }
    // B28.31 — Lens B28.307's rules history, newest first, and a rollback that writes a version's rules back whole.
    if ((m = /^\/agents\/([^/]+)\/rules\/(history|rollback)$/.exec(rest)) !== null && (method === 'GET') === (m[2] === 'history')) {
      const a = this.agents.get(m[1])
      if (a === undefined || a.ws !== ws.id) return json(res, 404, { error: 'economy: no such agent in this workspace' }), true
      if (m[2] === 'history') return json(res, 200, { versions: a.versions ?? [] }), true
      const { version = 0 } = await this.body<{ version?: number }>(req)
      if (!(version > 0)) return json(res, 400, { error: 'body must be {"version": <the version to roll back to>}' }), true
      const back = (a.versions ?? []).find((v) => v.version === version)
      if (back === undefined) return json(res, 404, { error: 'economy: the agent has no such version of its rules' }), true
      a.rules = structuredClone(back.rules)
      this.recordRules(a, ws.id, `rollback to ${version}`)
      return json(res, 200, a.rules), true
    }
    // B28.32 — Lens B28.308's boosts: listed while in force, set over a limit the rules set, ended early by limit.
    if ((m = /^\/agents\/([^/]+)\/rules\/boosts(?:\/([^/]+))?$/.exec(rest)) !== null) {
      const a = this.agents.get(m[1])
      if (a === undefined || a.ws !== ws.id) return json(res, 404, { error: 'economy: no such agent in this workspace' }), true
      const inForce = (a.boosts ?? []).filter((b) => Date.parse(b.until) > Date.now()).sort((x, y) => x.until.localeCompare(y.until) || x.rule.localeCompare(y.rule))
      if (m[2] === undefined && method === 'GET') return json(res, 200, { boosts: inForce }), true
      if (m[2] !== undefined && method === 'DELETE') {
        if (!inForce.some((b) => b.rule === m?.[2])) return json(res, 404, { error: 'economy: the agent has no boost in force on that limit' }), true
        a.boosts = (a.boosts ?? []).filter((b) => b.rule !== m?.[2])
        return res.writeHead(204).end(), true
      }
      if (m[2] === undefined && method === 'POST') {
        const { rule = '', value = 0, until = '' } = await this.body<{ rule?: string; value?: number; until?: string }>(req)
        if (rule === '' || until === '') return json(res, 400, { error: 'body must be {"rule": <the limit, e.g. daily_limit_ulxc>, "value": <raised to>, "until": <RFC 3339 time>}' }), true
        const field = BOOSTABLE.find((f) => f === rule)
        if (field === undefined) return json(res, 400, { error: `economy: invalid agent rule: "${rule}" is not a limit a boost can raise` }), true
        if (!(Date.parse(until) > Date.now())) return json(res, 400, { error: 'economy: invalid agent rule: a boost needs a time in the future to last until' }), true
        const current = a.rules[field]
        if (current === 0) return json(res, 400, { error: 'economy: invalid agent rule: the agent has no such limit to raise; set it in the rules first' }), true
        if (!(value > current)) return json(res, 400, { error: 'economy: invalid agent rule: a boost must raise the limit above what it is' }), true
        const b: Boost = { rule: field, raised_from: current, value, until: new Date(until).toISOString(), created_by: `jwt:user:${ws.id}`, created_at: now }
        a.boosts = [...(a.boosts ?? []).filter((x) => x.rule !== field), b]
        return json(res, 201, b), true
      }
    }
    // B28.30 — Lens B28.306's simulator: the rules' judgement of a request, with nothing posted and no approval filed.
    if ((m = /^\/agents\/([^/]+)\/rules\/simulate$/.exec(rest)) !== null && method === 'POST') {
      const a = this.agents.get(m[1])
      if (a === undefined || a.ws !== ws.id) return json(res, 404, { error: 'economy: no such agent in this workspace' }), true
      const b = await this.body<{ amount_ulxc?: number; model?: string; payee?: { kind: string; id: string } }>(req)
      const n = b.amount_ulxc ?? 0
      if (n < 0) return json(res, 400, { error: 'economy: the simulated request cannot be judged: amount_ulxc cannot be negative' }), true
      const filed = this.approvals.length
      const fingerprint = `simulated\0${randomBytes(8).toString('hex')}`
      const refused = b.payee ? this.judge(a, n, { payment: true, payee: this.agents.get(b.payee.id), fingerprint }) : this.judge(a, n, { model: b.model, fingerprint })
      this.approvals.splice(0, this.approvals.length - filed) // judge() files an approval first in the list; a simulation keeps none
      const verdict = refused === undefined ? 'allowed' : /approval amount/.test(refused.error) ? 'approval_required' : 'refused'
      const reason = refused === undefined ? '' : refused.error.replace(/^(economy: )?the agent's spending rules refuse this request: /, '')
      return json(res, 200, { verdict, reason, amount_ulxc: n, at: now, balance_ulxc: this.balance(`agent:${a.id}`) }), true
    }
    if ((m = /^\/agents\/([^/]+)(\/[a-z-]+)?$/.exec(rest)) !== null) {
      const a = this.agents.get(m[1])
      if (a === undefined || a.ws !== ws.id) return json(res, 404, { error: 'economy: no such agent in this workspace' }), true
      const action = m[2] ?? ''
      // B28.21 — Lens B28.298's lifecycle: rename and describe; archive sweeps the balance in one withdraw and revokes the keys.
      if (action === '' && method === 'PATCH') {
        const b = await this.body<{ name?: string | null; description?: string | null }>(req)
        if (b.name != null && b.name.trim() === '') return json(res, 400, { error: "economy: invalid agent details: an agent's name cannot be blank" }), true
        if (b.name != null) a.name = b.name.trim()
        if (b.description != null) a.description = b.description.trim()
        return json(res, 200, (this.book(ws) as { agents: { id: string }[] }).agents.find((x) => x.id === a.id)), true
      }
      if (action === '/archive' && method === 'POST') {
        if (a.archived_at !== undefined) return json(res, 409, { error: 'economy: this agent is archived' }), true
        const swept = this.balance(`agent:${a.id}`)
        if (swept > 0) this.post(ws.id, 'withdraw', [[`agent:${a.id}`, -swept, 'workspace'], ['workspace', swept, `agent:${a.id}`]], `archive:${a.id}`)
        for (const [k, owner] of this.keys) if (owner === a) this.keys.delete(k)
        const revoked = a.keys
        a.keys = []
        a.archived_at = now
        return json(res, 200, { agent_id: a.id, swept_ulxc: swept, revoked_keys: revoked, archived_at: now }), true
      }
      if (action === '/keys' && method === 'POST') {
        const key = 'tlv_' + randomBytes(24).toString('hex')
        const keyID = id('key_')
        this.keys.set(key, a)
        a.keys.push(keyID)
        return json(res, 201, { agent_id: a.id, key, id: keyID, prefix: key.slice(0, 12), warning: 'Store this key securely. It will not be shown again.' }), true
      }
      if ((action === '/fund' || action === '/withdraw') && method === 'POST') {
        const { amount_ulxc: n = 0 } = await this.body<{ amount_ulxc?: number }>(req)
        if (!(n > 0)) return json(res, 400, { error: 'body must be {"amount_ulxc": <positive µLXC>}' }), true
        const have = action === '/fund' ? ws.balance - ((this.book(ws) as { allocated_ulxc: number }).allocated_ulxc) : this.balance(`agent:${a.id}`)
        if (n > have) return json(res, 409, { error: `economy: there are only ${lxc(have)} LXC to move` }), true
        const sign = action === '/fund' ? 1 : -1
        this.post(ws.id, action.slice(1), [['workspace', -sign * n, `agent:${a.id}`], [`agent:${a.id}`, sign * n, 'workspace']])
        return json(res, 200, { agent_id: a.id, balance_ulxc: this.balance(`agent:${a.id}`) }), true
      }
      if (action === '/rules' && method === 'GET') return json(res, 200, a.rules), true
      if (action === '/rules' && method === 'PUT') {
        const r = await this.body<Partial<Rules>>(req)
        const both = (r.allowed_payees ?? []).find((x) => (r.blocked_payees ?? []).includes(x))
        if (both !== undefined) return json(res, 400, { error: `"${both}" is both allowed and blocked; give it one` }), true
        a.rules = { ...noRules(), ...r, allowed_listings: r.allowed_listings ?? a.rules.allowed_listings,
          allowed_payees: r.allowed_payees ?? a.rules.allowed_payees, blocked_payees: r.blocked_payees ?? a.rules.blocked_payees,
          payee_daily_limits_ulxc: r.payee_daily_limits_ulxc == null ? a.rules.payee_daily_limits_ulxc
            : Object.fromEntries(Object.entries(r.payee_daily_limits_ulxc).filter(([, v]) => v > 0)),
          hourly_limit_ulxc: r.hourly_limit_ulxc ?? a.rules.hourly_limit_ulxc, weekly_limit_ulxc: r.weekly_limit_ulxc ?? a.rules.weekly_limit_ulxc,
          model_daily_limits_ulxc: r.model_daily_limits_ulxc == null ? a.rules.model_daily_limits_ulxc : modelCaps(r.model_daily_limits_ulxc),
          requests_per_minute: r.requests_per_minute ?? a.rules.requests_per_minute,
          allowed_models: r.allowed_models ?? [], allowed_providers: r.allowed_providers ?? [] }
        this.recordRules(a, ws.id, 'set')
        return json(res, 200, a.rules), true
      }
      if (action === '/statement' && method === 'GET') {
        if (['from', 'to', 'format'].some((k) => url.searchParams.has(k))) {
          const st = this.statement(ws.id, a.id, url)
          return json(res, typeof st === 'string' ? 400 : 200, typeof st === 'string' ? { error: st } : st), true
        }
        const own = this.postings.filter((p) => p.account === `agent:${a.id}`)
        let after = 0
        const lines = own.map((p) => ({ entry_id: p.entry_id, kind: p.kind, amount_ulxc: p.amount_ulxc, counterparty: p.counterparty, ref: p.ref,
          balance_after_ulxc: (after += p.amount_ulxc), at: p.at }))
        return json(res, 200, { agent_id: a.id, lines: lines.reverse() }), true
      }
      if (action === '/pay' && method === 'POST') {
        const b = await this.body<{ to_agent_id?: string; amount_ulxc?: number; memo?: string }>(req)
        return this.pay(res, ws, a, b.to_agent_id ?? '', b.amount_ulxc ?? 0, b.memo ?? ''), true
      }
      if ((action === '/pause' || action === '/resume') && method === 'POST') {
        if (action === '/pause') {
          a.paused_at = now
          a.paused_reason = (await this.body<{ reason?: string }>(req)).reason ?? ''
        } else {
          a.paused_at = undefined
          a.paused_reason = undefined
        }
        return json(res, 200, { agent_id: a.id, paused: action === '/pause' }), true
      }
      if (await this.agentWalletRoute(req, res, ws, a, action)) return true
      if (action === '/topup' && method === 'GET') return json(res, 404, { error: 'the agent has no automatic top-up' }), true
      if (action === '/claim' && method === 'POST') return json(res, 200, { agent_id: a.id, owner_user_id: a.owner_user_id }), true
      if (action === '/portfolios' && method === 'GET') {
        return json(res, 200, { notice: "Simulated: executed by Talyvor's simulator at the ECB reference rate. No order is ever sent to a market.", portfolios: [] }), true
      }
      return this.d.miss(req, res, `/v1/workspaces/${ws.id}${rest}`), true
    }

    // ── the marketplace ──
    if (rest === '/marketplace/listings' && method === 'POST') {
      const b = await this.body<Partial<Listing> & { artifact?: Record<string, unknown> }>(req)
      if (!b.title || b.artifact === undefined) return json(res, 400, { error: 'market: a listing needs a title and its artifact' }), true
      const l: Listing = { id: id('lst_'), workspace_id: ws.id, kind: b.kind ?? 'prompt', title: b.title, description: b.description ?? '',
        price_per_use_ulxc: b.price_per_use_ulxc ?? 0, visibility: b.visibility ?? 'public', latest_version: 1, created_at: now, updated_at: now,
        review_status: READS_AS_INJECTION.test(`${b.title} ${b.description ?? ''} ${JSON.stringify(b.artifact)}`) ? 'held' : 'approved',
        artifact: b.artifact, changelog: b.changelog ?? '' }
      this.listings.set(l.id, l)
      return json(res, 201, this.listingOut(l, ws.id)), true
    }
    if (rest === '/marketplace/listings' && method === 'GET') {
      return json(res, 200, { listings: [...this.listings.values()].filter((l) => l.workspace_id === ws.id).map((l) => this.listingOut(l, ws.id)) }), true
    }
    if ((m = /^\/marketplace\/listings\/([^/]+)\/use$/.exec(rest)) !== null && method === 'POST') {
      const l = this.listings.get(m[1])
      if (l === undefined || !this.visible(l, ws.id)) return json(res, 404, { error: 'market: no such listing' }), true
      if (l.review_status === 'taken_down') return json(res, 403, { error: 'market: the listing was taken down' }), true
      const b = await this.body<{ model?: string; variables?: Record<string, string> }>(req)
      const template = String(l.artifact.template ?? '')
      const missing = [...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((x) => x[1]).filter((v) => !(b.variables?.[v] ?? '').trim())
      if (missing.length > 0) return json(res, 400, { error: `market: the prompt needs ${missing.map((v) => `{{${v}}}`).join(', ')}` }), true
      const model = b.model || String(l.artifact.model ?? '')
      if (model === '') return json(res, 400, { error: 'market: this listing names no model, so the use must' }), true
      const ran = this.d.runModel(ws, model, template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, v: string) => b.variables?.[v] ?? ''))
      if ('error' in ran) return json(res, 400, { error: ran.error }), true
      const charge = l.workspace_id === ws.id ? 'own' : l.price_per_use_ulxc === 0 ? 'free' : 'billed'
      const use: Use = { id: id('use_'), listing_id: l.id, seller: l.workspace_id, buyer: ws.id, agent_id: '', price_ulxc: charge === 'billed' ? l.price_per_use_ulxc : 0,
        charge, used_at: now, payee_agent_id: '', memo: '' }
      this.uses.push(use)
      return json(res, 200, { id: use.id, listing_id: l.id, version: 1, kind: l.kind, model, charge, price_ulxc: use.price_ulxc, output: ran.answer, used_at: now }), true
    }
    if (rest === '/marketplace/earnings') {
      const pending = this.uses.filter((u) => u.seller === ws.id && u.charge === 'billed' && u.cleared_at === undefined && u.refunded_at === undefined)
      const gross = pending.reduce((s, u) => s + u.price_ulxc, 0)
      const e = this.earnings(ws.id)
      const earnings = this.uses.filter((u) => u.seller === ws.id && u.cleared_at !== undefined).map((u) => ({ use_id: u.id, listing_id: u.listing_id,
        gross_usd_micros: u.price_ulxc / ULXC_PER_USD_MICRO, share_usd_micros: u.price_ulxc / ULXC_PER_USD_MICRO, invoice_id: u.invoice, cleared_at: u.cleared_at,
        payable_at: u.cleared_at, refunded_at: u.kept ? undefined : u.refunded_at, payee_agent_id: u.payee_agent_id || undefined }))
      return json(res, 200, { pending_uses: pending.length, pending_usd_micros: Math.floor(gross / 10), payable_usd_micros: e.available, in_holdback_usd_micros: 0,
        available_usd_micros: e.available, paid_out_usd_micros: e.paid, owed_usd_micros: 0, lifetime_gross_usd_micros: e.lifetime, refunded_usd_micros: e.refunded, earnings }), true
    }
    if (rest === '/marketplace/bill') {
      const month = url.searchParams.get('month') ?? now.slice(0, 7)
      const lines = this.uses.filter((u) => u.buyer === ws.id && u.charge === 'billed' && u.used_at.startsWith(month)).map((u) => ({
        use_id: u.id, listing_id: u.listing_id,
        title: u.listing_id !== '' ? this.listings.get(u.listing_id)?.title ?? '' : `Payment to ${this.agents.get(u.payee_agent_id)?.name ?? ''}`,
        agent_id: u.agent_id || undefined, price_ulxc: u.price_ulxc, used_at: u.used_at, payee_agent_id: u.payee_agent_id || undefined, memo: u.memo || undefined,
        cleared_at: u.cleared_at, refunded_at: u.refunded_at,
      }))
      const total = lines.filter((l) => l.refunded_at === undefined).reduce((s, l) => s + l.price_ulxc, 0)
      const refunded = lines.filter((l) => l.refunded_at !== undefined).reduce((s, l) => s + l.price_ulxc, 0)
      return json(res, 200, { month, total_ulxc: total, total_usd_micros: Math.floor(total / 10), refunded_ulxc: refunded, lines }), true
    }
    if (rest === '/marketplace/payouts' && method === 'GET') {
      const e = this.earnings(ws.id)
      return json(res, 200, { account: this.accounts.get(ws.id) ?? null, in_holdback_usd_micros: 0, available_usd_micros: e.available, owed_usd_micros: 0,
        paid_out_usd_micros: e.paid, minimum_usd_micros: 10_000_000, paid_this_month: false,
        quote: { gross_usd_micros: e.available, account_fee_usd_micros: 0, payout_fee_usd_micros: 0, net_usd_micros: e.available },
        payouts: this.payouts.filter((p) => p.ws === ws.id).map(({ ws: _w, ...p }) => p) }), true
    }
    if (rest === '/marketplace/payouts/credits' && method === 'POST') {
      const gross = this.earnings(ws.id).available
      if (gross <= 0) return json(res, 409, { error: 'market: nothing is available to pay out yet' }), true
      const p: Payout = { id: id('mpo_'), ws: ws.id, method: 'credits', month: now.slice(0, 7), gross_usd_micros: gross, net_usd_micros: gross,
        credits_ulxc: gross * ULXC_PER_USD_MICRO, paid_at: now, created_at: now }
      this.payouts.unshift(p)
      if (!this.broken('payout-uncredited')) this.d.credit(ws.id, p.credits_ulxc, 'purchase', 'marketplace earnings taken as credits', { market_payout_id: p.id })
      const { ws: _w, ...out } = p
      return json(res, 201, out), true
    }
    if (rest === '/marketplace/payouts/connect' && method === 'POST') {
      const { country = '' } = await this.body<{ country?: string }>(req)
      const account = this.accounts.get(ws.id) ?? { stripe_account_id: id('acct_'), country: country || 'GB', details_submitted: false, payouts_enabled: false,
        currently_due: ['individual.first_name', 'individual.last_name', 'external_account'] }
      if (!this.broken('connect-none')) this.accounts.set(ws.id, account)
      return json(res, 200, { url: `${this.d.base}/stub-connect/${account.stripe_account_id}`, account }), true
    }
    return false
  }
}
