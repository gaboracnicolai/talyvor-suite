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
//   secret-published    — B28.282: a listing carrying a secret is published like any other
//   self-use-billed     — B28.282: a seller's use of their own listing is billed, and earns them its price
//   b30-capability-gone — fx, one of B30.1's money-and-markets capabilities, is missing from the list (B30.115)
//   cross-company-live  — B28.290: money between two companies is real money: no test money on the transfer, its ledger rows funded live
//
// B25.8 adds what Lens (B25.7) brings due for a test workspace with the synthetic key: a loan's instalment
// (taken or missed by tick(), as Lens's minute tick does), a buyer's bill paid and refunded, a purchase on
// an agent's card; and a seller taking their earnings as credits. Its defects, one per scenario:
//   loan-repay-lost     — an instalment is taken from the borrower and never reaches the lender
//   loan-default-never  — a late loan missed again stays late, never in default
//   card-free           — an approved card purchase takes nothing from the agent
//   payout-uncredited   — taking earnings as credits records the payout and credits nothing
//   bill-refund-kept    — refunding a paid bill marks the buyer's use refunded and leaves the seller's earning
//
// B32.75 adds the seller's marketplace journal (Lens B32.17, GET …/marketplace/journal): a paid use's share waits in
// the journal's holdback, due at once, until tick() releases it to available, as Lens's release job does. Its defects:
//   journal-off           — a released share reads one µUSD short on the journal, though it still says it reconciles
//   journal-unreconciled  — the journal says it does not reconcile
//
// B32.76 adds a listing published with its offers, one active per kind and licence and each saying what its licence
// allows, its price per use following its per_use commercial offer (Lens B32.18). Its defects:
//   offers-duplicate      — a second commercial rent beside the first is accepted
//   offer-price-stale     — raising the per_use price leaves the next use billed at the old one
//   offer-price-backdated — the bill reads every use of a listing at the listing's price now
//
// B32.78 adds the uses a licence covers (Lens B32.19): while a rent, buy or subscription is active, a use of its listing
// is charged licensed at nothing and counted in its uses_covered; a personal licence never covers an agent's key. Its
// defects:
//   licence-replay-buys   — the same Idempotency-Key sent again buys a second licence, and a second line on the bill
//   licence-use-billed    — a use the licence covers is billed at the per-use price as if there were none
//   licence-covers-agent  — a personal licence covers an agent key's use too
//
// B32.80 adds an agent's licences judged by its rules (Lens B32.22): a licence taken with an agent's key is refused naming
// max_commitment_ulxc above the most one licence may commit it to, and naming may_subscribe for a subscription it may not
// take; above its approval amount an approval is filed, and once approved the licence goes through once. Its defects:
//   commitment-unjudged     — a licence above max_commitment_ulxc goes through
//   subscribe-unjudged      — a subscription goes through without may_subscribe
//   licence-refused-kept    — a refused licence answers 403, but the licence and its line on the bill are written anyway
//   approval-buys-twice     — an approved licence goes through, and the approval stays approved for the next
//
// B32.79 adds free trial uses (Lens B32.21): a per_use commercial offer's trial_uses (at most 5) makes each buyer's first
// uses of its listing trials — charged trial at nothing, answering trial with the trial uses left and what it would have
// cost, never on the bill and never an earning. Its defects:
//   trial-billed   — a trial answers as one, but the use is on the buyer's bill at the offer's price
//   trial-earns    — paying the bill pays the seller its share of each trial use too
//   trial-endless  — the trial uses never run out: the use after the last is a trial as well
//
// B28.360 adds freezing an agent's card (POST …/card/freeze and …/card/unfreeze, for Lens's B28.97): a purchase on a
// frozen card is declined and nothing leaves the agent. Its defect:
//   freeze-ignored      — a frozen card answers frozen, and a purchase on it is still approved
//
// B28.279 adds what Lens B17.26 does with a fund or withdraw's Idempotency-Key: it is the entry's ref, and a move whose
// key already posted answers the agent's balance and posts nothing. Its defects:
//   move-replay         — a move sent again under its key posts again
//   move-race           — a withdrawal that lands while another move of the same agent is in flight answers 200 and posts nothing
//
// B32.66 adds tax and weekly payouts (Lens B32.39–B32.42, stub-tax.ts): each billed use's tax on the bill, Talyvor's receipt
// for each paid bill, the seller's weekly statements, and the synthetic payout run of talyvor-lens B32.99, which withholds a
// seller with earnings and no tax details and pays one whose details are complete. Its defect, beside stub-tax.ts's two:
//   payout-hold-ignored — the payout run pays a seller who gave no tax details
//
// B32.89 adds the trust panel (Lens B32.49, stub-trust.ts): a paying buyer's review and the seller's reply, the trust read
// and market_listing's trust over MCP, and talyvor-lens B32.102's synthetic card link. Its defects are stub-trust.ts's.

import { createHash, randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { HOLD_REASON, TaxDesk } from './stub-tax.ts'
import { type Lineage, TrustDesk } from './stub-trust.ts'
import type { Judge, RoomAgent } from './stub-rooms.ts'

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
  /** B32.80 — the most one licence may commit it to, the licences it may hold, and whether it may subscribe (Lens B32.22); a save without them keeps them. */
  max_commitment_ulxc: number
  allowed_licences: string[]
  may_subscribe: boolean
}
interface Agent {
  id: string; ws: string; name: string; owner_user_id: string; created_at: string; keys: string[]; paused_at?: string; paused_reason?: string; rules: Rules; description?: string; archived_at?: string; versions?: RulesVersion[]; boosts?: Boost[]
  /** B34.4 — its address besides its wallet ID, and its automatic top-up */
  handle?: string; topup?: { below_ulxc: number; to_ulxc: number }
  /** B32.85 — room for a room's wallet (Lens B32.32): one key nobody holds, and not counted toward the plan's agents. */
  kind?: 'room'
}
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
  /** B34.4 — every version's artifact, how it is sold, and whether others may build on it */
  artifacts?: Record<number, Record<string, unknown>>; offers?: StubOffer[]; remix_policy?: string; remix_share_bps?: number
  /** B32.90 — what it can do, from MARKET_CAPABILITIES in their order */
  capabilities?: string[]
}
/** B32.90 — Lens market.Collection: a curator's list of listings, in its order; the operator features one. */
interface StubCollection { id: string; workspace_id: string; title: string; description: string; public: boolean; featured: boolean; featured_at?: string; listing_ids: string[]; created_at: string; updated_at: string }
/** B34.4 — Lens market.Offer, a listing's licence remix grant and lineage edge, a licence, and a simulated portfolio. */
interface StubOffer {
  id: string; kind: string; licence: string; price_usd_micros: number; period_days?: number; included_uses?: number; trial_uses?: number; terms?: string; created_at: string
}
interface Grant { ws: string; listing_id: string; version: number; share_bps: number; accepted_at: string }
interface Edge { child_listing_id: string; child_version: number; parent_listing_id: string; parent_version: number; share_bps: number; source: string; created_at: string }
interface StubLicence {
  id: string; ws: string; listing_id: string; title: string; offer_id: string; licence: string; kind: string; pinned_version: number | null; starts_at: string
  ends_at: string | null; auto_renew: boolean; status: string; use_id: string; charge: string; price_ulxc: number; created_at: string; key: string
  included_uses?: number
  /** B32.80 — the agent whose key took it */
  agent_id?: string
  /** B32.87 — prize: won as a room's prize */
  source?: string
}
interface SimOrder { id: string; portfolio_id: string; instrument: string; side: string; type: string; quantity_micros: number; limit_price_usd?: string; status: string; fill_price_usd?: string; cash_uusd: number; simulated: true; created_at: string }
interface Portfolio { id: string; agent_id: string; name: string; starting_cash_uusd: number; created_at: string; orders: SimOrder[] }
interface Use {
  id: string; listing_id: string; seller: string; buyer: string; agent_id: string; price_ulxc: number; charge: string; used_at: string; payee_agent_id: string; memo: string
  refunded_at?: string
  /** B25.8 — the bill it was paid on, when, and a refund that left the seller's share in place (bill-refund-kept) */
  invoice?: string; cleared_at?: string; kept?: boolean
  /** B32.75 — when tick() released its share from the seller's holdback on the journal */
  released_at?: string
  /** B32.78 — the licence that covered it (charge licensed) */
  licence_id?: string
  /** B32.79 — a trial use's would-be price */
  trial_ulxc?: number
}
/**
 * B32.8 — what the seller keeps of a use, in µUSD (Lens market.SellerShare): a listing's 85% (LENS_MARKET_TAKE_BPS=1500),
 * a payment to another company's agent 95% (LENS_SERVICES_TAKE_BPS=500), rounded down.
 */
function shareOf(u: Use): number {
  const gross = u.price_ulxc / ULXC_PER_USD_MICRO
  const keep = 10_000 - (u.listing_id === '' ? 500 : 1500)
  return Math.floor(gross / 10_000) * keep + Math.floor(((gross % 10_000) * keep) / 10_000)
}

interface Payout {
  id: string; ws: string; method: 'credits' | 'stripe'; month: string; gross_usd_micros: number; net_usd_micros: number; credits_ulxc: number; paid_at: string; created_at: string
  /** B32.66 — a weekly payout's ISO week, and Stripe's fees taken from it */
  period?: string; vat_usd_micros?: number; account_fee_usd_micros?: number; payout_fee_usd_micros?: number
}
/** B32.66 — the payout minimum (Lens market.PayoutMinimumUSDMicros), and Stripe's fees in cents (market.PayoutFees). */
const PAYOUT_MINIMUM_USD_MICROS = 25_000_000
const STRIPE_ACCOUNT_FEE_CENTS = 200
const STRIPE_PAYOUT_FIXED_CENTS = 25
const STRIPE_PAYOUT_BPS = 25

/** B32.66 — the ISO week `at` falls in, UTC (2026-W41), and its Monday and the next, as Lens's market.WeekBounds. */
function isoWeekOf(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const year = d.getUTCFullYear()
  return `${year}-W${String(Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400e3 + 1) / 7)).padStart(2, '0')}`
}
function weekBounds(period: string): [string, string] | undefined {
  const m = /^(\d{4})-W(\d{2})$/.exec(period)
  if (m === null) return undefined
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4))
  const from = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400e3 + (Number(m[2]) - 1) * 7 * 86_400e3)
  if (Number(m[2]) < 1 || isoWeekOf(from) !== period) return undefined
  return [from.toISOString(), new Date(from.getTime() + 7 * 86_400e3).toISOString()]
}
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
/** B28.282 — what Lens's publish scan refuses outright (market scan.go): a credential shape, never ordinary text. */
const SECRETS: [string, RegExp][] = [['aws_access_key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/], ['openai_key', /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/],
  ['stripe_key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/], ['talyvor_key', /\btlv_[A-Za-z0-9_-]{20,}/]]
/** What Lens's publish review holds for a person to judge (market B20.4): text that reads as a prompt injection. */
const READS_AS_INJECTION = /\b(you are now|pretend (you are|to be)|ignore (all )?(previous|prior) instructions)\b/i
/** The capabilities Agent Wallets asks after (Lens economy.Capabilities): each test money only. */
const CAPABILITIES = [
  ['pay_another_owner', 'Pay another owner'], ['loans_between_companies', 'Loans between companies'], ['escrow', 'Escrow'],
  ['rules_approvals_statements_pots', 'Rules, approvals, statements and pots'], ['cash_out', 'Cash out'], ['company_credit_line', 'Company credit line'],
].map(([capability, name]) => ({ capability, name, class: 'AMBER', real_money: false }))
/** B28.360 — an agent's card, RED in Lens (economy.CapabilityAgentCard): the card freeze in Chat says it is test money only. */
const CARD_CAPABILITY = { capability: 'agent_card', name: 'Cards', class: 'RED', real_money: false }
/** B30.115 — and the money-and-markets ones B30.1 added, in Lens's classes; `b30-capability-gone` drops fx. */
const B30_CAPABILITIES = [
  ['currency_accounts', 'RED'], ['account_details', 'RED'], ['payments_in', 'RED'], ['payments_out', 'RED'], ['pay_by_bank', 'AMBER'],
  ['fx', 'RED'], ['stablecoins', 'RED'], ['x402', 'RED'], ['merchant_acceptance', 'RED'], ['b2b_credit', 'AMBER'], ['seller_advances', 'AMBER'],
  ['lending_marketplace', 'AMBER'], ['trade_equities', 'RED'], ['trade_crypto', 'RED'], ['trade_prediction', 'RED'], ['treasury_sweep', 'RED'],
  ['price_lock', 'AMBER'], ['cover', 'RED'], ['payouts_to_people', 'RED'],
].map(([capability, cls]) => ({ capability, name: capability, class: cls, real_money: false }))

/** B34.4 — Lens's simulated market's quotes (B22.8): the ECB's reference rates, a few of them, fixed. */
export const SIM_QUOTES = [['EUR', '1.17'], ['GBP', '1.35'], ['JPY', '0.0068']].map(([instrument, price_usd]) => ({ instrument, price_usd, rate_date: '2026-10-02' }))
const SIM_NOTICE = "Simulated: executed by Talyvor's simulator at the ECB reference rate. No order is ever sent to a market."
/** B34.4 — two of Lens's rule templates (economy.RuleTemplates), each naming the rules it sets. */
const RULE_TEMPLATES: { id: string; name: string; summary: string; rules: Partial<Rules> }[] = [
  { id: 'support-bot', name: 'Support bot', summary: 'Answers customers: small requests, a daily limit, a person above 5 LXC.', rules: { max_per_request_ulxc: 500_000, daily_limit_ulxc: 20_000_000, approval_above_ulxc: 5_000_000 } },
  { id: 'research-agent', name: 'Research agent', summary: 'Reads and summarises: a monthly limit.', rules: { monthly_limit_ulxc: 200_000_000 } },
]

const noRules = (): Rules => ({ max_per_request_ulxc: 0, hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 0, model_daily_limits_ulxc: {}, requests_per_minute: 0, approval_above_ulxc: 0,
  allowed_models: [], allowed_providers: [], allowed_listings: [], allowed_payees: [], blocked_payees: [], payee_daily_limits_ulxc: {}, active_from: '', active_until: '', timezone: '', pause_on_unusual_spend: false,
  max_commitment_ulxc: 0, allowed_licences: [], may_subscribe: false })

const lxc = (ulxc: number): string => String(ulxc / 1e6)

/** The name a per-model cap knows a model by, as Lens's economy.modelCapKey: lower-case, no dated or -latest suffix. */
const modelCapKey = (model: string): string => model.trim().toLowerCase().replace(/-(\d{8}|\d{4}-\d{2}-\d{2}|latest)$/, '')

/** The caps a save names, by modelCapKey, the zeros (no cap) left out — as Lens stores them. */
const modelCaps = (caps: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(caps).filter(([, v]) => v > 0).map(([m, v]) => [modelCapKey(m), v]))
/** µLXC per µUSD (LXC is pegged at $0.10), and µUSD a penny buys, at the stub's fixed pound. */
const ULXC_PER_USD_MICRO = 10
/** B32.79 — the most trial uses one offer may give (Lens market.DefaultTrialMax, LENS_MARKET_TRIAL_MAX) */
const TRIAL_MAX = 5
/** B32.76 — what each licence allows (Lens market.LicenceTerms). */
const LICENCE_TERMS: Record<string, string> = {
  personal: 'One person. No agent keys, and not inside a product sold to others.',
  commercial: "The buying workspace's people and agents, inside its own products.",
  enterprise: "Commercial, for up to the offer's seats of people and all of the workspace's agents.",
}
const USD_MICROS_PER_PENNY = 12_700
const id = (prefix: string): string => prefix + randomBytes(8).toString('hex')
/** B32.90 — Lens's controlled list of what a listing can do (market_capabilities, migration 0219), in its order. */
const MARKET_CAPABILITIES = ['summarize', 'extract', 'translate', 'classify', 'code-review', 'sql', 'legal', 'finance', 'write', 'research', 'data-analysis', 'customer-support']

export class Bank {
  private readonly d: BankDeps
  /** B32.88 — the rooms' room_* tools on an agent's key (stub-rooms.ts roomAgentTool), as stub-lens.ts sets them. */
  roomTool?: (name: string, args: Record<string, unknown>, ws: string, agent: RoomAgent, judge: Judge) => { ok: true; body: unknown } | { ok: false; error: string }
  private readonly agents = new Map<string, Agent>()
  private readonly keys = new Map<string, Agent>()
  /** B28.359 — each agent key's id, to its key: Lens revokes an agent's key on the workspace's key route. */
  private readonly keyByID = new Map<string, string>()
  private readonly postings: Posting[] = []
  private readonly approvals: Approval[] = []
  private readonly allPaused = new Map<string, { at: string; reason: string }>()
  /** B28.26 — when each agent's admitted requests were held, as Lens counts its holds for the per-minute rule. */
  private readonly asked = new Map<string, number[]>()
  /** B28.279 — each agent's moves in flight, for move-race. */
  private readonly moving = new Map<string, number>()
  private readonly listings = new Map<string, Listing>()
  private readonly collections = new Map<string, StubCollection>()
  private readonly uses: Use[] = []
  private nextPosting = 1
  private readonly transfers: Transfer[] = []
  private readonly requests: MoneyReq[] = []
  private readonly loans: Loan[] = []
  private readonly escrows: Escrow[] = []
  private readonly pots: Pot[] = []
  private readonly schedules: Schedule[] = []
  private readonly cashOuts: CashOut[] = []
  private readonly cards = new Map<string, { frozen: boolean; frozen_at?: string } & Record<string, unknown>>()
  /** B28.84 — each workspace's passkeys (Lens B19.16): once it has one, a decision must carry an assertion. */
  private readonly passkeys = new Map<string, { credential_id: string; name: string; created_at: string }[]>()
  private readonly reports: Report[] = []
  private readonly accounts = new Map<string, ConnectAccount>()
  private readonly payouts: Payout[] = []
  private readonly cardAuths: CardAuth[] = []
  // B34.4
  private readonly grants: Grant[] = []
  private readonly lineage: Edge[] = []
  private readonly licences: StubLicence[] = []
  private readonly portfolios: Portfolio[] = []

  /** B32.66 — buyers' tax profiles, each billed use's tax, receipts and sellers' tax details (stub-tax.ts). */
  private readonly tax: TaxDesk
  /** B32.89 — reviews, the trust read and the synthetic card link (stub-trust.ts). */
  private readonly trustDesk: TrustDesk

  constructor(d: BankDeps) {
    this.d = d
    this.tax = new TaxDesk(d.json, (req) => this.body(req), (name) => this.broken(name))
    this.trustDesk = new TrustDesk({ json: d.json, body: (req) => this.body(req), broken: (name) => this.broken(name),
      listing: (id, viewer) => { const l = this.listings.get(id); return l !== undefined && this.visible(l, viewer) ? l : undefined },
      paid: (listing, buyer) => this.uses.some((u) => u.listing_id === listing && u.buyer === buyer && u.charge === 'billed' && u.refunded_at === undefined),
      payoutsEnabled: (ws) => this.accounts.get(ws)?.payouts_enabled === true,
      lineage: (id) => this.lineageOf(id) })
  }

  /** The workspace and agent an agent key belongs to. */
  agentOfKey(key: string): { ws: BankWorkspace; agent: Agent } | undefined {
    const a = this.keys.get(key)
    const ws = a === undefined ? undefined : this.d.workspace(a.ws)
    return a === undefined || ws === undefined ? undefined : { ws, agent: a }
  }

  /** B28.359 — revokes one of the workspace's agent keys by its id, as Lens's DELETE …/api-keys/{id} does; false: no such key. */
  revokeAgentKey(wsID: string, keyID: string): boolean {
    const key = this.keyByID.get(keyID)
    if (key === undefined || this.keys.get(key)?.ws !== wsID) return false
    this.keys.delete(key)
    this.keyByID.delete(keyID)
    return true
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
      spent_ulxc: this.postings.filter((p) => p.account === `agent:${a.id}` && (p.kind === 'spend' || p.kind === 'platform_fee')).reduce((s, p) => s - p.amount_ulxc, 0),
      keys: a.keys, created_at: a.created_at, paused_at: a.paused_at, paused_reason: a.paused_reason, owner_user_id: a.owner_user_id, verified: false,
      description: a.description ?? '', archived_at: a.archived_at, kind: a.kind ?? 'agent',
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
  judge(agent: Agent, amount: number, req: { model?: string; provider?: string; listing?: string; payment?: boolean; payee?: Agent; memo?: string; fingerprint: string }):
    { status: number; error: string; approval_id?: string } | undefined {
    const rule = (s: string) => ({ status: 403, error: `the agent's spending rules refuse this request: ${s}` })
    const all = this.allPaused.get(agent.ws)
    if (all !== undefined) return rule(`every agent in this workspace is paused (${all.reason || "paused by the workspace's owner"}) — the workspace's owner can resume them`)
    if (agent.paused_at !== undefined) return rule(`the agent is paused (${agent.paused_reason || "paused by the workspace's owner"}) — the workspace's owner can resume it`)
    const r = this.rulesInForce(agent)
    const what = req.payment ? 'payment' : 'request'
    // B28.281 — the agent's hours, read in its timezone; a window whose end is before its start crosses midnight.
    if (r.active_from && r.active_until) {
      const [h, min] = new Intl.DateTimeFormat('en-GB', { timeZone: r.timezone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .format(new Date()).split(':').map(Number)
      const at = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
      const m = h * 60 + min
      const from = at(r.active_from)
      const until = at(r.active_until)
      const inside = from <= until ? from <= m && m < until : m >= from || m < until
      if (!inside) return rule(`the agent may spend only between ${r.active_from} and ${r.active_until} (${r.timezone || 'UTC'})`)
    }
    if (r.allowed_models.length > 0 && !req.payment && !r.allowed_models.includes(req.model ?? '')) return rule(`the agent may not use the model "${req.model}"`)
    if (r.allowed_providers.length > 0 && !req.payment && !r.allowed_providers.includes(req.provider ?? '')) return rule(`the agent may not use the provider "${req.provider}"`)
    if (r.allowed_listings.length > 0 && req.listing !== undefined && !r.allowed_listings.includes(req.listing)) {
      return rule(`the agent may not use the marketplace listing "${req.listing}"`)
    }
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
    const spent = this.postings.filter((p) => p.account === `agent:${agent.id}` && (p.kind === 'spend' || p.kind === 'platform_fee' || (p.kind === 'pay' && p.amount_ulxc < 0)))
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
      return { status: 403, error: `economy: this request would cost up to ${lxc(amount)} LXC, above the agent's approval amount — approval ${a.id} must be approved by the workspace's owner before it is retried`,
        approval_id: a.id }
    }
    return undefined
  }

  /** An agent's proxied request, judged at its worst case before the model; undefined lets it through. */
  admit(agent: Agent, worst: number, model: string, prompt: string, provider: string): { status: number; error: string } | undefined {
    const refused = this.judge(agent, worst, { model, provider, fingerprint: createHash('sha256').update(`${agent.id}\0${model}\0${prompt}`).digest('hex') })
    if (refused !== undefined) return refused
    if (worst > this.balance(`agent:${agent.id}`)) return { status: 402, error: 'agent LXC sub-budget exceeded or insufficient balance' }
    this.asked.set(agent.id, [...(this.asked.get(agent.id) ?? []), Date.now()])
    return undefined
  }

  /** What a served request cost, posted from the agent to spend, naming its model — beside the workspace's ledger row —
   *  and B32.11's platform fee on it, its own posting. */
  spent(agent: Agent, charge: number, model: string, fee: number): string | undefined {
    const entry = charge > 0 ? this.post(agent.ws, 'spend', [[`agent:${agent.id}`, -charge, 'spend'], ['spend', charge, `agent:${agent.id}`]], undefined, modelCapKey(model)) : undefined
    if (fee > 0) this.post(agent.ws, 'platform_fee', [[`agent:${agent.id}`, -fee, 'spend'], ['spend', fee, `agent:${agent.id}`]], undefined, modelCapKey(model))
    // B28.377 — the spend line's entry: a scheduled prompt's run names the statement line it was charged on.
    return entry
  }

  /** B28.377 — one of the workspace's agents, by its id: a scheduled prompt runs as the agent that pays for it. */
  agentIn(wsID: string, agentID: string): Agent | undefined {
    const a = this.agents.get(agentID)
    return a?.ws === wsID && a.archived_at === undefined ? a : undefined
  }

  /** B32.12 — the workspace's agents a plan counts: every one not archived. B32.85 — a room's wallet is not counted. */
  activeAgents(ws: string): number {
    return [...this.agents.values()].filter((a) => a.ws === ws && a.archived_at === undefined && a.kind !== 'room').length
  }

  /** B32.85 — a room's wallet, opened with its room (Lens B32.32): an agent of kind room with one key whose plaintext nobody keeps. */
  openRoomWallet(ws: string, agentID: string, name: string): void {
    this.agents.set(agentID, { id: agentID, ws, name, owner_user_id: ws, created_at: new Date().toISOString(), keys: [id('key_')], rules: noRules(), kind: 'room' })
  }

  /** B32.85 — what one agent holds, as its postings sum. */
  agentBalance(agentID: string): number {
    return this.balance(`agent:${agentID}`)
  }

  /**
   * B32.86 — a run in a room (Lens B32.33): one use of a room's contribution on its buyer's bill — the room's owner, the
   * room's wallet its agent, or the member paying itself with no agent. The buyer's own listing is charged own.
   */
  roomUse(u: { listing_id: string; seller: string; buyer: string; agent_id: string; price_ulxc: number }): Use {
    const own = u.seller === u.buyer
    const use: Use = { id: id('use_'), ...u, price_ulxc: own ? 0 : u.price_ulxc, charge: own ? 'own' : u.price_ulxc > 0 ? 'billed' : 'free',
      used_at: new Date().toISOString(), payee_agent_id: '', memo: '' }
    this.uses.push(use)
    return use
  }

  /**
   * B32.87 — a room's prize awarded (Lens B32.35): the owner buys the winning contribution at the prize's amount — one
   * billed use of kind prize on its bill, the room's wallet its agent — and holds a perpetual commercial licence to it.
   */
  prizeUse(u: { listing_id: string; version: number; seller: string; buyer: string; agent_id: string; price_ulxc: number; title: string }): { use: Use; licence: { id: string } } {
    const now = new Date().toISOString()
    const lic: StubLicence = { id: id('lic_'), ws: u.buyer, listing_id: u.listing_id, title: u.title, offer_id: '', licence: 'commercial', kind: 'prize', source: 'prize',
      pinned_version: u.version, starts_at: now, ends_at: null, auto_renew: false, status: 'active', use_id: id('use_'), charge: 'billed', price_ulxc: u.price_ulxc,
      created_at: now, key: '', agent_id: u.agent_id }
    const use: Use = { id: lic.use_id, listing_id: u.listing_id, seller: u.seller, buyer: u.buyer, agent_id: u.agent_id, price_ulxc: u.price_ulxc, charge: 'billed',
      used_at: now, payee_agent_id: '', memo: '', licence_id: lic.id }
    this.uses.push(use)
    this.licences.unshift(lic)
    return { use, licence: { ...this.licenceOut(lic), id: lic.id } }
  }

  /** B32.86 — what an agent's billed uses cost this month, as its monthly limit counts them. */
  agentBilledThisMonth(agentID: string): number {
    const month = new Date().toISOString().slice(0, 7)
    return this.uses.filter((u) => u.agent_id === agentID && u.charge === 'billed' && u.used_at.startsWith(month)).reduce((s, u) => s + u.price_ulxc, 0)
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

  /**
   * B28.98 — a period statement as Lens writes it (cmd/lens writeStatement): JSON, or with ?format=csv a header, each
   * account's opening balance, every line, then each account's closing balance; times as Go's RFC 3339 with
   * nanoseconds, a memo a spreadsheet would run as a formula kept as text.
   */
  private answerStatement(res: ServerResponse, st: object | string, url: URL): void {
    if (typeof st === 'string') return this.d.json(res, 400, { error: st })
    if (url.searchParams.get('format') !== 'csv') return this.d.json(res, 200, st)
    const s = st as { from: string; to: string; accounts: { account: string; opening_ulxc: number; closing_ulxc: number }[];
      lines: { posting_id: number; entry_id: string; at: string; account: string; kind: string; amount_ulxc: number; counterparty: string; ref?: string; balance_after_ulxc: number }[] }
    const at = (t: string) => new Date(t).toISOString().replace(/\.(\d*?)0+Z$/, '.$1Z').replace(/\.Z$/, 'Z')
    const text = (v: string) => (v !== '' && '=+-@\t\r'.includes(v[0]) ? `'${v}` : v)
    const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
    const rows = [
      ['posting_id', 'entry_id', 'at', 'account', 'kind', 'amount_ulxc', 'counterparty', 'ref', 'balance_after_ulxc'],
      ...s.accounts.map((x) => ['', '', at(s.from), x.account, 'opening', '', '', '', String(x.opening_ulxc)]),
      ...s.lines.map((l) => [String(l.posting_id), l.entry_id, at(l.at), l.account, l.kind, String(l.amount_ulxc), l.counterparty, text(l.ref ?? ''), String(l.balance_after_ulxc)]),
      ...s.accounts.map((x) => ['', '', at(s.to), x.account, 'closing', '', '', '', String(x.closing_ulxc)]),
    ]
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="agent-statement-${s.from.slice(0, 10)}-${s.to.slice(0, 10)}.csv"`,
    })
    res.end(rows.map((r) => r.map(cell).join(',') + '\n').join(''))
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
    const spentKinds = new Set(['spend', 'platform_fee', 'settle', 'pay', 'transfer', 'card', 'escrow'])
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

  /** B32.92 — a workspace's tax profile on one of its agents' keys: refused, as Lens refuses all but its owner or an admin (stub-tax.ts). */
  async agentTaxProfile(req: IncomingMessage, res: ServerResponse, key: string, path: string): Promise<boolean> {
    const m = /^\/v1\/workspaces\/([^/]+)\/tax-profile$/.exec(path)
    const who = this.agentOfKey(key)
    if (m === null || who === undefined) return false
    if (who.ws.id !== m[1]) return this.d.json(res, 403, { error: 'forbidden' }), true
    return this.tax.route(req, res, who.ws.id, '/tax-profile', new Date().toISOString(), true)
  }

  /**
   * B28.281 — a marketplace use on an agent's own key, judged by its rules first as Lens's JudgeAgentPurchase judges it (a
   * payment naming the listing), then run as its workspace's use. B32.80: a licence on an agent's key, judged where it is
   * taken (judgeLicence).
   */
  async agentUse(req: IncomingMessage, res: ServerResponse, key: string, path: string): Promise<boolean> {
    const m = /^\/v1\/workspaces\/([^/]+)(\/marketplace\/listings\/([^/]+)\/(use|licences))$/.exec(path)
    const who = this.agentOfKey(key)
    if (m === null || who === undefined || req.method !== 'POST') return false
    if (who.ws.id !== m[1]) return this.d.json(res, 403, { error: "an agent's key may use listings only for its own workspace" }), true
    const l = this.listings.get(m[3])
    if (l !== undefined && m[4] === 'use') {
      const price = l.workspace_id === who.ws.id ? 0 : l.price_per_use_ulxc
      const refused = this.judge(who.agent, price, { payment: true, listing: l.id, fingerprint: `market\0${who.agent.id}\0${l.id}\0${price}` })
      if (refused !== undefined) return this.d.json(res, refused.status, { error: refused.error }), true
    }
    return this.workspaceRoute(req, res, who.ws, m[2], new URL(path, this.d.base), who.agent)
  }

  /**
   * B32.81 — Lens's market_* tools on an agent's own key (talyvor-lens B32.23 internal/mcp/market_tools.go): search, a
   * listing's offers, a licence and a use, each run as the marketplace's route runs on that key, so its rules judge it;
   * a refusal is a tool result marked isError that says why.
   */
  async agentMCP(req: IncomingMessage, res: ServerResponse, key: string, path: string): Promise<boolean> {
    const who = this.agentOfKey(key)
    if (path !== '/mcp' || req.method !== 'POST' || who === undefined) return false
    const rpc = await this.body<{ id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }>(req)
    const name = rpc.method === 'tools/call' ? rpc.params?.name ?? '' : ''
    const a = rpc.params?.arguments ?? {}
    const reply = (result: object) => this.d.json(res, 200, { jsonrpc: '2.0', id: rpc.id ?? null, result })
    const text = (body: unknown) => reply({ content: [{ type: 'text', text: JSON.stringify(body) }] })
    // A marketplace route on the agent's key, run in-process: its status and its JSON answer.
    const route = async (method: string, rest: string, body?: object, headers: Record<string, string> = {}): Promise<{ status: number; body: { error?: string } }> => {
      const fake = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), { method, headers }) as unknown as IncomingMessage
      const out = { status: 0, text: '' }
      const sink = { writeHead: (s: number) => { out.status = s; return sink }, setHeader: () => sink, end: (t?: string) => { out.text = t ?? '' } } as unknown as ServerResponse
      const p = `/v1/workspaces/${who.ws.id}${rest}`
      if (!(method === 'POST' ? await this.agentUse(fake, sink, key, p) : await this.workspaceRoute(fake, sink, who.ws, rest, new URL(p, this.d.base), who.agent))) {
        return { status: 404, body: { error: 'market: no such route' } }
      }
      return { status: out.status, body: JSON.parse(out.text || '{}') as { error?: string } }
    }
    const answer = (r: { status: number; body: { error?: string } }) =>
      r.status < 300 ? text(r.body) : reply({ content: [{ type: 'text', text: r.body.error ?? `refused: ${r.status}` }], isError: true })
    // B32.88 — the room_* tools, on the agent's key as its owner's member; a price it pays itself judged by its rules.
    if (name.startsWith('room_') && this.roomTool !== undefined) {
      const out = this.roomTool(name, a, who.ws.id, { id: who.agent.id, name: who.agent.name }, (amount, listing) =>
        this.judge(who.agent, amount, { payment: true, listing, fingerprint: `room\0${who.agent.id}\0${listing}\0${amount}` })?.error)
      return (out.ok ? text(out.body) : reply({ content: [{ type: 'text', text: out.error }], isError: true })), true
    }
    const listing = String(a.listing_id ?? '')
    switch (name) {
      case 'market_search': {
        const words = String(a.text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '')
        const max = typeof a.max_price_usd_micros === 'number' ? a.max_price_usd_micros : undefined
        const found = [...this.listings.values()].filter((l) => l.visibility === 'public' && l.review_status === 'approved' &&
          words.every((w) => `${l.title} ${l.description}`.toLowerCase().includes(w)) && (a.kind === undefined || l.kind === a.kind) &&
          (a.licence === undefined || (l.offers ?? []).some((o) => o.licence === a.licence)) && (max === undefined || ((this.perUse(l) ?? Infinity) <= max)))
        return text({ listings: found.map((l) => { const { artifact: _a, changelog: _c, ...rest } = l; return { ...rest, offers: l.offers ?? [] } }) }), true
      }
      case 'market_listing': {
        const l = this.listings.get(listing)
        if (l === undefined || !this.visible(l, who.ws.id)) return reply({ content: [{ type: 'text', text: 'market: no such listing' }], isError: true }), true
        // B32.89 — and its trust panel, as the trust read gives it.
        return text({ ...this.listingOut(l, who.ws.id), offers: l.offers ?? [], trust: this.trustDesk.trust(who.ws.id, l.id, true) }), true
      }
      case 'market_license':
        return answer(await route('POST', `/marketplace/listings/${listing}/licences`, { offer_id: a.offer_id, version: a.version },
          { 'idempotency-key': String(a.idempotency_key ?? '') })), true
      case 'market_use':
        return answer(await route('POST', `/marketplace/listings/${listing}/use`, { variables: a.variables, model: a.model, input: a.input,
          max_price_usd_micros: a.max_price_usd_micros })), true
    }
    return this.d.json(res, 200, { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: `unknown tool: ${name || rpc.method}` } }), true
  }

  /** B34.4 — a simulated portfolio as Lens answers it: its cash after its filled orders, and what they bought. */
  private portfolioOut(pf: Portfolio): object {
    const filled = pf.orders.filter((o) => o.status === 'filled')
    const held = new Map<string, number>()
    for (const o of filled) held.set(o.instrument, (held.get(o.instrument) ?? 0) + o.quantity_micros)
    const { orders, ...rest } = pf
    return { ...rest, simulated: true, notice: SIM_NOTICE, cash_uusd: pf.starting_cash_uusd + filled.reduce((s, o) => s + o.cash_uusd, 0),
      positions: [...held].map(([instrument, quantity_micros]) => ({ instrument, quantity_micros })), orders }
  }

  /**
   * B32.76 — `offers` made the listing's active set, as Lens's ReplaceOffers does: refused (why) unless each is a kind and
   * licence Lens sells, at a price of 0 or more, and one per kind and licence. Its price per use follows its per_use
   * commercial offer.
   */
  private setOffers(l: Listing, offers: Omit<StubOffer, 'id' | 'created_at'>[], now: string): string | undefined {
    if (offers.some((o) => !['per_use', 'buy', 'rent', 'subscribe'].includes(o.kind) || LICENCE_TERMS[o.licence] === undefined || !(o.price_usd_micros >= 0))) return 'market: invalid offer'
    if (offers.some((o) => o.trial_uses !== undefined && (o.trial_uses < 0 || o.trial_uses > TRIAL_MAX || (o.trial_uses > 0 && o.kind !== 'per_use')))) {
      return `market: invalid listing: only a per_use offer gives trial uses, at most ${TRIAL_MAX}`
    }
    const twice = offers.find((o, i) => offers.findIndex((x) => x.kind === o.kind && x.licence === o.licence) !== i)
    if (twice !== undefined && !this.broken('offers-duplicate')) return `market: invalid listing: a listing has one active ${twice.licence} ${twice.kind} offer at a time`
    const stale = this.broken('offer-price-stale') && l.offers !== undefined
    l.offers = offers.map((o) => ({ ...o, id: id('off_'), terms: LICENCE_TERMS[o.licence], created_at: now }))
    const perUse = offers.find((o) => o.kind === 'per_use' && o.licence === 'commercial')
    if (!stale) l.price_per_use_ulxc = (perUse?.price_usd_micros ?? 0) * ULXC_PER_USD_MICRO
    return undefined
  }

  /**
   * B32.78 — the active licence of `buyer` to `listing` that covers a use by `agent` (none: a person), as Lens's licenceFor
   * finds it: not past its end nor its included uses, and a personal one never an agent's key.
   */
  private coveringLicence(buyer: string, listing: string, agent: Agent | undefined, now: string): StubLicence | undefined {
    if (this.broken('licence-use-billed')) return undefined
    return this.licences.find((x) => x.ws === buyer && x.listing_id === listing && x.status === 'active' && (x.ends_at === null || x.ends_at > now) &&
      (agent === undefined || x.licence !== 'personal' || this.broken('licence-covers-agent')) &&
      (!x.included_uses || this.uses.filter((u) => u.licence_id === x.id).length < x.included_uses))
  }

  /**
   * B32.80 — a licence taken with `agent`'s key, judged by its rules as Lens's JudgeAgentPurchase judges it (B32.22): the
   * licences it may hold, whether it may subscribe, the most one licence may commit it to, then the rest of its rules —
   * the approval amount among them, whose approval lets this licence through once.
   */
  private judgeLicence(agent: Agent, listing: string, o: StubOffer): { status: number; error: string; approval_id?: string } | undefined {
    const price = o.price_usd_micros * ULXC_PER_USD_MICRO
    const r = this.rulesInForce(agent)
    const rule = (s: string) => ({ status: 403, error: `the agent's spending rules refuse this request: ${s}` })
    if (o.licence === 'personal') return { status: 400, error: 'market: invalid listing: a personal licence is for one person, never an agent key' }
    if (r.allowed_licences.length > 0 && !r.allowed_licences.includes(o.licence)) {
      return rule(`the agent may hold only ${r.allowed_licences.join(' and ')} licences (allowed_licences), and this ${o.kind} is ${o.licence}`)
    }
    if (o.kind === 'subscribe' && !r.may_subscribe && !this.broken('subscribe-unjudged')) return rule("the agent's rules do not let it subscribe (may_subscribe)")
    if (r.max_commitment_ulxc > 0 && price > r.max_commitment_ulxc && !this.broken('commitment-unjudged')) {
      return rule(`this ${o.kind} would commit the agent to ${lxc(price)} LXC; the most one licence may commit it to is ${lxc(r.max_commitment_ulxc)} LXC (max_commitment_ulxc)`)
    }
    const fingerprint = `licence\0${agent.id}\0${listing}\0${o.id}\0${price}`
    const approved = this.approvals.find((a) => a.agent_id === agent.id && a.fingerprint === fingerprint && a.status === 'approved')
    const refused = this.judge(agent, price, { payment: true, listing, fingerprint })
    if (approved !== undefined && this.broken('approval-buys-twice')) approved.status = 'approved'
    return refused
  }

  /** B32.78 — a licence as Lens answers it: its uses covered, never the key that bought it. */
  private licenceOut(x: StubLicence): object {
    const { key: _k, ...out } = x
    return { ...out, terms: LICENCE_TERMS[x.licence], uses_covered: this.uses.filter((u) => u.licence_id === x.id).length }
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
    if (this.discoveryRoute(res, path, url, viewer)) return true
    if (path === '/v1/marketplace/listings') {
      const kind = url.searchParams.get('kind') ?? ''
      json(res, 200, { listings: [...this.listings.values()].filter((l) => l.visibility === 'public' && this.visible(l, viewer) && (kind === '' || l.kind === kind))
        .map((l) => { const { artifact: _a, changelog: _c, ...rest } = l; return rest }) })
      return true
    }
    // B34.4 — a listing's ancestors, nearest first, with each edge's share, and how many listings build on it.
    const ln = /^\/v1\/marketplace\/listings\/([^/]+)\/lineage$/.exec(path)
    if (ln !== null) {
      const l = this.listings.get(ln[1])
      if (l === undefined || !this.visible(l, viewer)) return json(res, 404, { error: 'market: no such listing' }), true
      json(res, 200, { listing_id: l.id, version: l.latest_version, remix_policy: l.remix_policy ?? 'none', remix_share_bps: l.remix_share_bps ?? 0, ...this.lineageOf(l.id), max_depth: 5 })
      return true
    }
    // B32.89 — a listing's trust panel (stub-trust.ts).
    if (this.trustDesk.publicRoute(res, path, viewer)) return true
    const m = /^\/v1\/marketplace\/listings\/([^/]+)$/.exec(path)
    if (m === null) return false
    const l = this.listings.get(m[1])
    if (l === undefined || !this.visible(l, viewer)) json(res, 404, { error: 'market: no such listing' })
    else json(res, 200, this.listingOut(l, viewer))
    return true
  }

  /** B34.4 — a listing's ancestors, nearest first, with each edge's share, and how many listings build on it. */
  private lineageOf(id: string): Lineage {
    const ancestors: Edge[] = []
    for (let at = [id], depth = 0; at.length > 0 && depth < 5; depth++) {
      const up = this.lineage.filter((e) => at.includes(e.child_listing_id))
      ancestors.push(...up)
      at = up.map((e) => e.parent_listing_id)
    }
    const below = (of: string): number => this.lineage.filter((e) => e.parent_listing_id === of).reduce((n, e) => n + 1 + below(e.child_listing_id), 0)
    return { ancestors: ancestors.map((e) => ({ listing_id: e.parent_listing_id, version: e.parent_version, child_listing_id: e.child_listing_id, child_version: e.child_version,
      share_bps: e.share_bps, source: e.source })), descendants: below(id) }
  }

  /**
   * B32.90 — Lens's discovery reads (B32.50): search the approved public listings by capability, kind and the most one use
   * is billed, newest or by price (nobody buys here, so trending is everyone's 0), the controlled list, and the public
   * collections, the featured first. STUB_BREAK=search-price ignores max_price_per_use, search-capability the capability,
   * featured-last lists the featured collections after the others.
   */
  private discoveryRoute(res: ServerResponse, path: string, url: URL, viewer: string): boolean {
    const { json } = this.d
    const q = url.searchParams
    if (path === '/v1/marketplace/capabilities') return json(res, 200, { capabilities: MARKET_CAPABILITIES.map((slug) => ({ slug, label: slug })) }), true
    if (path === '/v1/marketplace/search') {
      const sort = q.get('sort') || (q.get('q') ? 'relevance' : 'trending')
      const cap = q.get('capability') ?? ''
      const max = q.get('max_price_per_use')
      if (cap !== '' && !MARKET_CAPABILITIES.includes(cap)) return json(res, 400, { error: `market: invalid listing: "${cap}" is not a capability` }), true
      const page = Number(q.get('page') || 1)
      const hits = [...this.listings.values()]
        .filter((l) => l.visibility === 'public' && l.review_status === 'approved' && ((q.get('kind') ?? '') === '' || l.kind === q.get('kind')))
        .filter((l) => cap === '' || this.broken('search-capability') || (l.capabilities ?? []).includes(cap))
        .map((l) => ({ l, price: this.perUse(l) }))
        .filter(({ price }) => max === null || this.broken('search-price') || (price !== null && price <= Number(max)))
        .sort((a, b) => sort === 'price' ? (a.price ?? Infinity) - (b.price ?? Infinity) : b.l.created_at.localeCompare(a.l.created_at))
      const at = hits.slice((page - 1) * 50, page * 50).map(({ l, price }) => {
        const { artifact: _a, changelog: _c, ...rest } = l
        return { ...rest, capabilities: l.capabilities ?? [], offers: l.offers ?? [], price_per_use_usd_micros: price, distinct_buyers_7d: 0, trending_score: 0 }
      })
      return json(res, 200, { listings: at, sort, page, page_size: 50, total: hits.length, has_more: page * 50 < hits.length }), true
    }
    if (path === '/v1/marketplace/collections') {
      const featured = this.broken('featured-last') ? -1 : 1
      const list = [...this.collections.values()].filter((c) => c.public)
        .sort((a, b) => featured * (Number(b.featured) - Number(a.featured)) || (b.featured_at ?? '').localeCompare(a.featured_at ?? '') || b.updated_at.localeCompare(a.updated_at))
      return json(res, 200, { collections: list.map((c) => this.collectionOut(c, false)) }), true
    }
    const m = /^\/v1\/marketplace\/collections\/([^/]+)$/.exec(path)
    if (m === null) return false
    const c = this.collections.get(m[1])
    if (c === undefined || (!c.public && c.workspace_id !== viewer)) return json(res, 404, { error: 'market: not found: no such collection' }), true
    return json(res, 200, this.collectionOut(c, true)), true
  }

  /** B32.90 — what one use of `l` is billed in µUSD (Lens market.Discover): 0 with no offers, its commercial per-use offer, else null. */
  private perUse(l: Listing): number | null {
    if ((l.offers ?? []).length === 0) return 0
    return l.offers?.find((o) => o.kind === 'per_use' && o.licence === 'commercial')?.price_usd_micros ?? null
  }

  /** B32.90 — a collection as Lens reads it: the listings anyone may see counted, and listed in its order on a read of it alone. */
  private collectionOut(c: StubCollection, withListings: boolean): object {
    const shown = c.listing_ids.map((x) => this.listings.get(x)).filter((l): l is Listing => l !== undefined && l.visibility === 'public' && l.review_status === 'approved')
    const { listing_ids: _ids, ...rest } = c
    return { ...rest, listing_count: shown.length, ...(withListings ? { listings: shown.map((l) => { const { artifact: _a, changelog: _c, ...out } = l; return out }) } : {}) }
  }

  /** B32.90 — `caps` on the controlled list, in its order; or Lens's refusal. */
  private checkCapabilities(caps: unknown): string[] | string {
    if (caps === undefined || caps === null) return []
    if (!Array.isArray(caps)) return 'body must be {capabilities: [...]}'
    const bad = caps.find((c) => !MARKET_CAPABILITIES.includes(c))
    if (bad !== undefined) return `market: invalid listing: "${String(bad)}" is not a capability; the capabilities are ${MARKET_CAPABILITIES.join(', ')}`
    return MARKET_CAPABILITIES.filter((c) => caps.includes(c))
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
    const live = from.ws !== to.ws && this.broken('cross-company-live')
    const t: Transfer = { id: id('xfr_'), from_workspace_id: from.ws, from_agent_id: from.id, to_workspace_id: to.ws, to_agent_id: to.id, amount_ulxc: amount,
      memo, class: from.ws === to.ws ? 'GREEN' : 'AMBER', test_funded_ulxc: live ? 0 : amount, created_at: new Date().toISOString(), ...links }
    this.transfers.unshift(t)
    this.post(from.ws, 'transfer', [[`agent:${from.id}`, -amount, `agent:${to.id}`]], t.id)
    if (credit) this.post(to.ws, 'transfer', [[`agent:${to.id}`, amount, `agent:${from.id}`]], t.id)
    // B28.290 — as Lens's moveLXC: between two workspaces the credits leave one's LXC balance and reach the other's, a ledger
    // row on each naming the transfer and its class.
    if (from.ws !== to.ws) {
      const tags = (other: Agent) => ({ transfer_id: t.id, counterparty_agent_id: other.id, counterparty_workspace_id: other.ws, class: t.class, ...(live ? { funding: 'live' } : {}) })
      this.d.credit(from.ws, -amount, 'agent_transfer', 'credits sent to another agent', tags(to))
      if (credit) this.d.credit(to.ws, amount, 'agent_transfer', 'credits received from another agent', tags(from))
    }
    return t
  }

  /** An agent by its wallet ID, or by its @handle (B34.4). */
  private wallet(address: string): Agent | undefined {
    const a = address.trim()
    if (a.startsWith('@')) return [...this.agents.values()].find((x) => x.handle === a.slice(1).toLowerCase())
    return this.agents.get(a)
  }

  /** Lens's minute tick (cmd/lens): every recurring transfer due, every loan instalment due, then every cash-out's next step. */
  tick(now = Date.now()): void {
    // B32.75 — every paid use's share, due at once (a test bill is paid a holdback ago), released from the journal's holdback.
    for (const u of this.uses) if (u.cleared_at !== undefined && u.released_at === undefined) u.released_at = new Date(now).toISOString()
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
    // B34.4 — an agent below its top-up level is filled to it from the workspace's free credits.
    for (const a of this.agents.values()) {
      const ws = a.topup === undefined || a.archived_at !== undefined ? undefined : this.d.workspace(a.ws)
      const have = this.balance(`agent:${a.id}`)
      if (ws === undefined || a.topup === undefined || have >= a.topup.below_ulxc) continue
      const n = a.topup.to_ulxc - have
      if (n <= ws.balance - (this.book(ws) as { allocated_ulxc: number }).allocated_ulxc) this.post(ws.id, 'fund', [['workspace', -n, `agent:${a.id}`], [`agent:${a.id}`, n, 'workspace']], 'topup')
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
      // B32.66 — the paid bill's receipt, in the test series (Lens B32.40).
      this.tax.issueReceipt(m[1], invoice, due.map((u) => ({ id: u.id, title: this.listings.get(u.listing_id)?.title ?? '', net_usd_micros: u.price_ulxc / ULXC_PER_USD_MICRO })), now)
      if (this.broken('trial-earns')) {
        for (const u of this.uses) if (u.buyer === m[1] && u.charge === 'trial' && u.cleared_at === undefined) Object.assign(u, { invoice, cleared_at: now, price_ulxc: u.trial_ulxc })
      }
      return json(res, 200, { invoice_id: invoice, uses_cleared: due.length }), true
    }
    // B32.89 — one card recorded on two test workspaces (talyvor-lens B32.102); every stub workspace is a test one.
    if (await this.trustDesk.syntheticRoute(req, res, path, (ws) => this.d.workspace(ws) !== undefined)) return true
    if ((m = /^\/v1\/synthetic\/workspaces\/([^/]+)\/marketplace\/payouts\/run$/.exec(path)) !== null && req.method === 'POST') {
      return json(res, 200, this.payOutWeekly(m[1], now)), true
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
      const frozen = this.cards.get(a.id)?.frozen === true && !this.broken('freeze-ignored')
      const refused = (frozen ? 'the card is frozen: every purchase on it is refused until it is unfrozen' : undefined)
        ?? this.judge(a, cost, { payment: true, fingerprint: `card\0${a.id}\0${Date.now()}` })?.error
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
    const f = /^\/v1\/admin\/marketplace\/collections\/([^/]+)\/feature$/.exec(path)
    if (f !== null && req.method === 'POST') {
      const c = this.collections.get(f[1])
      if (c === undefined) return json(res, 404, { error: 'market: not found: no such collection' }), true
      const { featured = true } = await this.body<{ featured?: boolean }>(req)
      if (featured && !c.public) return json(res, 400, { error: 'market: invalid listing: only a public collection may be featured' }), true
      Object.assign(c, { featured, featured_at: featured ? new Date().toISOString() : undefined })
      return json(res, 200, this.collectionOut(c, false)), true
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
      return json(res, 200, { capabilities: [...CAPABILITIES, CARD_CAPABILITY, ...b30] }), true
    }
    let m = /^\/v1\/wallets\/([^/]+)$/.exec(path)
    if (m !== null) {
      const a = this.wallet(decodeURIComponent(m[1]))
      return (a === undefined ? json(res, 404, { error: 'economy: no wallet has that ID or handle' }) : json(res, 200, { wallet_id: a.id, ...(a.handle ? { handle: a.handle } : {}), name: a.name })), true
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

  /** B32.66 — what the journal holds available to a seller: their released shares less what was paid out. */
  private released(ws: string): number {
    const held = this.uses.filter((u) => u.seller === ws && u.cleared_at !== undefined && u.released_at === undefined && (u.refunded_at === undefined || u.kept))
      .reduce((s, u) => s + shareOf(u), 0)
    return this.earnings(ws).available - held
  }

  /**
   * B32.66 — the weekly payout run for one test seller now (talyvor-lens B32.99): a seller with earnings and incomplete tax
   * details is withheld (their reminders brought due); otherwise what the journal holds available is paid, in whole cents,
   * once an ISO week and once it reaches the minimum, Stripe's account fee on the month's first payout and its payout fee
   * on every one.
   */
  private payOutWeekly(ws: string, now: string): object {
    const available = this.released(ws)
    if (available > 0 && this.tax.incomplete(ws) && !this.broken('payout-hold-ignored')) this.tax.withhold(ws, now)
    if (this.tax.withheld(ws)) return { withheld: true, hold: HOLD_REASON, payout: null }
    const period = isoWeekOf(new Date(now))
    const mine = this.payouts.filter((p) => p.ws === ws && p.method === 'stripe')
    if (available < PAYOUT_MINIMUM_USD_MICROS || mine.some((p) => p.period === period)) return { withheld: false, payout: null }
    const grossCents = Math.floor(available / 10_000)
    const accountCents = mine.some((p) => p.month === now.slice(0, 7)) ? 0 : STRIPE_ACCOUNT_FEE_CENTS
    const netCents = Math.max(Math.floor(((grossCents - accountCents - STRIPE_PAYOUT_FIXED_CENTS) * 10_000) / (10_000 + STRIPE_PAYOUT_BPS)), 0)
    const p: Payout = { id: id('mpo_'), ws, method: 'stripe', month: now.slice(0, 7), period, gross_usd_micros: grossCents * 10_000, vat_usd_micros: 0,
      account_fee_usd_micros: accountCents * 10_000, payout_fee_usd_micros: (grossCents - accountCents - netCents) * 10_000, net_usd_micros: netCents * 10_000,
      credits_ulxc: 0, paid_at: now, created_at: now }
    this.payouts.unshift(p)
    const { ws: _w, ...out } = p
    return { withheld: false, payout: out }
  }

  /** B32.66 — a seller's statement of one ISO week (Lens market.SellerStatement): its lines sum to its payout's net, 0 without one. */
  private weekStatement(ws: string, period: string): object | undefined {
    const bounds = weekBounds(period)
    if (bounds === undefined) return undefined
    const [from, to] = bounds
    const live = (u: Use) => u.seller === ws && u.released_at !== undefined && (u.refunded_at === undefined || u.kept)
    const earlier = this.uses.filter((u) => live(u) && (u.released_at ?? '') < from).reduce((s, u) => s + shareOf(u), 0) -
      this.payouts.filter((p) => p.ws === ws && p.created_at < from).reduce((s, p) => s + p.gross_usd_micros, 0)
    const week = this.uses.filter((u) => live(u) && (u.released_at ?? '') >= from && (u.released_at ?? '') < to)
    const gross = week.reduce((s, u) => s + u.price_ulxc / ULXC_PER_USD_MICRO, 0)
    const kept = week.reduce((s, u) => s + shareOf(u), 0)
    const inWeek = this.payouts.filter((p) => p.ws === ws && p.created_at >= from && p.created_at < to)
    const credits = inWeek.filter((p) => p.method === 'credits').reduce((s, p) => s + p.gross_usd_micros, 0)
    const stripe = inWeek.filter((p) => p.method === 'stripe')
    const paid = stripe.reduce((s, p) => s + p.gross_usd_micros, 0)
    const fees = stripe.reduce((s, p) => s + (p.account_fee_usd_micros ?? 0) + (p.payout_fee_usd_micros ?? 0), 0)
    const lines = [['brought_forward', 'Brought forward from earlier weeks', earlier], ['sales', 'Sales', gross], ['talyvor_fee', "Talyvor's fee", -(gross - kept)],
      ['royalties_paid', 'Royalties paid to the originals your listings build on', 0], ['royalties_received', 'Royalties and split shares received', 0],
      ['refunds', 'Refunds and chargebacks', 0], ['credits', 'Taken as Talyvor credits', -credits],
      ['carried_forward', 'Carried forward to next week', -(earlier + kept - paid - credits)], ['stripe_fees', "Stripe's fees, at cost", -fees]] as const
    const payout = this.payouts.find((p) => p.ws === ws && p.method === 'stripe' && p.period === period)
    return { period, from, to, payout: payout === undefined ? null : (({ ws: _w, ...p }) => p)(payout), sales: week.length,
      lines: lines.map(([kind, label, amount_usd_micros]) => ({ kind, label, amount_usd_micros })), net_usd_micros: lines.reduce((s, l) => s + l[2], 0),
      vat_collected_usd_micros: week.reduce((s, u) => s + this.tax.taxOf(u.buyer, u.id, u.price_ulxc / ULXC_PER_USD_MICRO).tax_usd_micros, 0), self_billed_invoice: null }
  }

  /**
   * B25.8 — a seller's earnings in µUSD: the uses of their listings on a paid bill are payable at once (Lens
   * B25.7 pays a test bill a holdback ago), less what a refund reversed and what was paid out.
   */
  private earnings(ws: string): { lifetime: number; refunded: number; available: number; paid: number } {
    const cleared = this.uses.filter((u) => u.seller === ws && u.cleared_at !== undefined)
    const share = (us: Use[]) => us.reduce((s, u) => s + shareOf(u), 0)
    const reversed = cleared.filter((u) => u.refunded_at !== undefined && !u.kept)
    const paid = this.payouts.filter((p) => p.ws === ws).reduce((s, p) => s + p.gross_usd_micros, 0)
    return { lifetime: cleared.reduce((s, u) => s + u.price_ulxc / ULXC_PER_USD_MICRO, 0), refunded: share(reversed),
      available: Math.max(share(cleared) - share(reversed) - paid, 0), paid }
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
    // B34.4 — one loan or escrow, as either side reads it.
    if ((m = /^\/loans\/([^/]+)$/.exec(rest)) !== null && method === 'GET') {
      const l = this.loans.find((x) => x.id === m?.[1] && (x.lender_workspace_id === ws.id || x.borrower_workspace_id === ws.id))
      return (l === undefined ? json(res, 404, { error: 'economy: no such loan' }) : json(res, 200, l)), true
    }
    if ((m = /^\/escrows\/([^/]+)$/.exec(rest)) !== null && method === 'GET') {
      const e = this.escrows.find((x) => x.id === m?.[1] && (x.payer_workspace_id === ws.id || x.payee_workspace_id === ws.id))
      return (e === undefined ? json(res, 404, { error: 'economy: no such escrow' }) : json(res, 200, e)), true
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
      return json(res, 200, { schedules: this.schedules.filter((x) => x.ws === ws.id).map(({ ws: _w, runs: _r, ...x }) => x) }), true
    }
    if ((m = /^\/agents\/([^/]+)\/pots\/([^/]+)\/(in|out)$/.exec(rest)) !== null && method === 'POST') {
      const a = this.agents.get(m[1])
      const pot = this.pots.find((x) => x.id === m?.[2] && x.agent_id === a?.id)
      if (a === undefined || a.ws !== ws.id || pot === undefined) return json(res, 404, { error: 'economy: no such pot' }), true
      const { amount_ulxc: n = 0 } = await this.body<{ amount_ulxc?: number }>(req)
      // B34.4 — a locked pot keeps what it holds until its lock has passed.
      if (m[3] === 'out' && pot.locked_until !== undefined && Date.parse(pot.locked_until) > Date.now() && !this.broken('pot-lock-ignored')) {
        return json(res, 409, { error: `economy: this pot is locked until ${pot.locked_until}` }), true
      }
      const have = this.balance(m[3] === 'in' ? `agent:${a.id}` : `pot:${pot.id}`)
      if (!(n > 0) || n > have) return json(res, 409, { error: `economy: there are only ${lxc(have)} LXC to move` }), true
      if (m[3] === 'in') this.post(ws.id, 'pot', [[`agent:${a.id}`, -n, `pot:${pot.id}`], [`pot:${pot.id}`, n, `agent:${a.id}`]], pot.id)
      else this.post(ws.id, 'pot', this.broken('pot-out-lost') ? [[`pot:${pot.id}`, -n, `agent:${a.id}`]] : [[`pot:${pot.id}`, -n, `agent:${a.id}`], [`agent:${a.id}`, n, `pot:${pot.id}`]], pot.id)
      return json(res, 200, { ...pot, balance_ulxc: this.balance(`pot:${pot.id}`) }), true
    }
    if ((m = /^\/agents\/([^/]+)\/pots\/([^/]+)\/lock$/.exec(rest)) !== null && method === 'PUT') {
      const a = this.agents.get(m[1])
      const pot = this.pots.find((x) => x.id === m?.[2] && x.agent_id === a?.id)
      if (a === undefined || a.ws !== ws.id || pot === undefined) return json(res, 404, { error: 'economy: no such pot' }), true
      const { locked_until = null } = await this.body<{ locked_until?: string | null }>(req)
      const inForce = pot.locked_until !== undefined && Date.parse(pot.locked_until) > Date.now()
      if (inForce && (locked_until === null || Date.parse(locked_until) < Date.parse(pot.locked_until ?? ''))) {
        return json(res, 409, { error: `economy: this pot is locked until ${pot.locked_until}: a lock in force can only be made longer` }), true
      }
      pot.locked_until = locked_until === null ? undefined : new Date(locked_until).toISOString()
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
      if (!this.broken('cash-out-free')) {
        this.post(ws.id, 'cash_out', [[`agent:${a.id}`, -n, `cash_out:${c.id}`], [`cash_out:${c.id}`, n, `agent:${a.id}`]], c.id)
        // B28.290 — as Lens's moveCashOutLXC: the held credits leave the workspace's LXC balance, a RED row naming the cash-out and its partner.
        this.d.credit(ws.id, -n, 'agent_cash_out', 'credits held to be cashed out', { cash_out_id: c.id, agent_id: a.id, partner: c.partner, class: 'RED' })
      }
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
        exp_year: new Date().getUTCFullYear() + 3, currency: 'gbp', livemode: this.broken('card-live'), created_at: now, frozen: false }
      this.cards.set(a.id, card)
      return json(res, 201, card), true
    }
    // B28.360 — the card frozen or unfrozen: Lens answers the card.
    if ((action === '/card/freeze' || action === '/card/unfreeze') && method === 'POST') {
      const card = this.cards.get(a.id)
      if (card === undefined) return json(res, 404, { error: 'economy: the agent has no card' }), true
      card.frozen = action === '/card/freeze'
      if (card.frozen) card.frozen_at = now
      else delete card.frozen_at
      return json(res, 200, card), true
    }
    return false
  }

  /** A route under /v1/workspaces/{ws}: answers true when it was one of the bank's or the marketplace's. */
  async workspaceRoute(req: IncomingMessage, res: ServerResponse, ws: BankWorkspace, rest: string, url: URL, agent?: Agent): Promise<boolean> {
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
      // The stub checks the assertion names one of the workspace's passkeys; Lens verifies its signature too.
      const keys = this.passkeys.get(ws.id) ?? []
      const signedWith = (await this.body<{ assertion?: { credential_id?: string } }>(req)).assertion?.credential_id
      if (keys.length > 0 && !keys.some((k) => k.credential_id === signedWith)) {
        return json(res, 403, { error: 'economy: approvals in this workspace are signed: approve with a registered passkey' }), true
      }
      a.status = m[2] === 'approve' ? 'approved' : 'denied'
      a.decided_at = now
      // B34.4 — approval-deny-pays: a denied send is made anyway (its payee is in the fingerprint the send filed it under).
      const [what, from, to] = a.fingerprint.split('\0')
      if (m[2] === 'deny' && what === 'send' && this.broken('approval-deny-pays')) {
        const payee = this.agents.get(to)
        if (payee !== undefined) {
          this.post(ws.id, 'transfer', [[`agent:${from}`, -a.amount_ulxc, `agent:${to}`]], a.id)
          this.post(payee.ws, 'transfer', [[`agent:${to}`, a.amount_ulxc, `agent:${from}`]], a.id)
        }
      }
      const { fingerprint: _f, ws: _w, ...out } = a
      return json(res, 200, out), true
    }
    if (rest === '/agents/statement' && method === 'GET') {
      return this.answerStatement(res, this.statement(ws.id, undefined, url), url), true
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
          (['spend', 'platform_fee', 'hold', 'settle', 'release', 'card'].includes(p.kind) || (p.kind === 'pay' && p.amount_ulxc < 0)))
          .reduce((s, p) => s - p.amount_ulxc, 0)
        // B28.357 — B28.94's contract: what the agent holds, and when that runs out at the month's pace so far
        // (balance × elapsed ÷ spent from now); null when it has spent nothing, so does not run out at that pace.
        const balance = this.balance(`agent:${a.id}`)
        const left = spent <= 0 ? null : (Math.max(balance, 0) * Math.max(1, d.getTime() - start.getTime())) / spent
        return { agent_id: a.id, name: a.name, spent_ulxc: spent, forecast_ulxc: runOn(spent), balance_ulxc: balance, runs_out_at: left === null ? null : new Date(d.getTime() + left).toISOString() }
      })
      const spent = agents.reduce((s, a) => s + a.spent_ulxc, 0)
      return json(res, 200, { at: now, month_start: start.toISOString(), month_end: end.toISOString(), spent_ulxc: spent, forecast_ulxc: runOn(spent), agents }), true
    }
    if (await this.walletRoute(req, res, ws, rest)) return true
    // B28.84 — registering a passkey and the challenge each approval is signed over (Lens B19.16).
    const challenge = () => randomBytes(32).toString('base64url')
    if (rest === '/agents/passkeys/challenge' && method === 'POST') {
      return json(res, 200, { challenge: challenge(), rp_id: new URL(process.env.STUB_APP_URL ?? 'http://localhost').hostname }), true
    }
    if (rest === '/agents/passkeys' && method === 'POST') {
      const { credential_id = '', name = '' } = await this.body<{ credential_id?: string; name?: string }>(req)
      if (credential_id === '') return json(res, 400, { error: 'economy: a passkey needs its credential id' }), true
      const k = { credential_id, name, created_at: now }
      this.passkeys.set(ws.id, [...(this.passkeys.get(ws.id) ?? []), k])
      return json(res, 201, k), true
    }
    if ((m = /^\/agents\/approvals\/([^/]+)\/challenge$/.exec(rest)) !== null && method === 'POST') {
      return json(res, 200, { challenge: challenge(), allow_credentials: (this.passkeys.get(ws.id) ?? []).map((k) => k.credential_id) }), true
    }
    if (rest === '/agents/passkeys') return json(res, 200, { passkeys: this.passkeys.get(ws.id) ?? [] }), true
    if (rest === '/agents/push/public-key') return json(res, 404, { error: 'economy: web push is not configured' }), true
    if (rest === '/agents/push/subscriptions' && (method === 'POST' || method === 'DELETE')) return json(res, 404, { error: 'economy: web push is not configured' }), true
    // B34.4 — Lens's rule templates, and one applied over an agent's rules whole.
    if (rest === '/agents/rule-templates' && method === 'GET') return json(res, 200, { templates: RULE_TEMPLATES }), true
    if ((m = /^\/agents\/([^/]+)\/rules\/template$/.exec(rest)) !== null && method === 'POST') {
      const a = this.agents.get(m[1])
      if (a === undefined || a.ws !== ws.id) return json(res, 404, { error: 'economy: no such agent in this workspace' }), true
      const { template = '' } = await this.body<{ template?: string }>(req)
      const t = RULE_TEMPLATES.find((x) => x.id === template)
      if (t === undefined) return json(res, 400, { error: `economy: no rule template "${template}"` }), true
      a.rules = { ...noRules(), ...t.rules }
      this.recordRules(a, ws.id, `template ${t.id}`)
      return json(res, 200, a.rules), true
    }
    // B34.4 — Lens's simulated portfolios (B22.8): a market order fills at the quote, a limit order under it waits.
    if ((m = /^\/agents\/([^/]+)\/portfolios\/([^/]+)(\/orders(?:\/([^/]+)\/cancel)?)?$/.exec(rest)) !== null) {
      const a = this.agents.get(m[1])
      const pf = this.portfolios.find((x) => x.id === m?.[2] && x.agent_id === a?.id)
      if (a === undefined || a.ws !== ws.id || pf === undefined) return json(res, 404, { error: 'economy: no such portfolio' }), true
      if (m[3] === undefined && method === 'GET') return json(res, 200, this.portfolioOut(pf)), true
      if (m[4] !== undefined && method === 'POST') {
        const o = pf.orders.find((x) => x.id === m?.[4] && x.status === 'open')
        if (o === undefined) return json(res, 404, { error: 'economy: no such open order' }), true
        o.status = 'cancelled'
        return json(res, 200, o), true
      }
      if (m[3] === '/orders' && method === 'POST') {
        const b = await this.body<{ instrument?: string; side?: string; type?: string; quantity_micros?: number; limit_price_usd?: string }>(req)
        const price = Number(SIM_QUOTES.find((q) => q.instrument === b.instrument)?.price_usd)
        if (!(price > 0)) return json(res, 400, { error: `economy: no quote for "${b.instrument}"` }), true
        if (b.side !== 'buy' || !(b.quantity_micros && b.quantity_micros > 0)) return json(res, 400, { error: 'economy: the stub buys a positive quantity only' }), true
        const fill = b.type === 'market' || Number(b.limit_price_usd) >= price
        const cost = Math.round(b.quantity_micros * price)
        const o: SimOrder = { id: id('ord_'), portfolio_id: pf.id, instrument: b.instrument ?? '', side: 'buy', type: b.type ?? 'market', quantity_micros: b.quantity_micros,
          ...(b.limit_price_usd ? { limit_price_usd: b.limit_price_usd } : {}), status: fill ? 'filled' : 'open', ...(fill ? { fill_price_usd: String(price) } : {}),
          cash_uusd: fill ? -(this.broken('sim-fill-free') ? 0 : cost) : 0, simulated: true, created_at: now }
        pf.orders.unshift(o)
        return json(res, 201, o), true
      }
    }
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
    if ((m = /^\/agents\/([^/]+)(\/card\/(?:un)?freeze|\/[a-z-]+)?$/.exec(rest)) !== null) {
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
        this.keyByID.set(keyID, key)
        a.keys.push(keyID)
        return json(res, 201, { agent_id: a.id, key, id: keyID, prefix: key.slice(0, 12), warning: 'Store this key securely. It will not be shown again.' }), true
      }
      if ((action === '/fund' || action === '/withdraw') && method === 'POST') {
        const kind = action.slice(1)
        const key = String(req.headers['idempotency-key'] ?? '')
        this.moving.set(a.id, (this.moving.get(a.id) ?? 0) + 1)
        let crowded = false
        let n = 0
        try {
          n = (await this.body<{ amount_ulxc?: number }>(req)).amount_ulxc ?? 0
          // move-race: slow enough to overlap the next move, as a read-modify-write without the agent's lock is.
          if (this.broken('move-race')) await new Promise((r) => setTimeout(r, 25))
          crowded = (this.moving.get(a.id) ?? 0) > 1
        } finally {
          this.moving.set(a.id, (this.moving.get(a.id) ?? 1) - 1)
        }
        if (!(n > 0)) return json(res, 400, { error: 'body must be {"amount_ulxc": <positive µLXC>}' }), true
        // Lens B17.26: the key is the entry's ref; a key already posted is a retry of a move that landed.
        if (key !== '' && !this.broken('move-replay') && this.postings.some((p) => p.account === `agent:${a.id}` && p.kind === kind && p.ref === key)) {
          return json(res, 200, { agent_id: a.id, balance_ulxc: this.balance(`agent:${a.id}`) }), true
        }
        const have = action === '/fund' ? ws.balance - ((this.book(ws) as { allocated_ulxc: number }).allocated_ulxc) : this.balance(`agent:${a.id}`)
        if (n > have) return json(res, 409, { error: `economy: there are only ${lxc(have)} LXC to move` }), true
        const sign = action === '/fund' ? 1 : -1
        if (!(kind === 'withdraw' && crowded && this.broken('move-race'))) {
          this.post(ws.id, kind, [['workspace', -sign * n, `agent:${a.id}`], [`agent:${a.id}`, sign * n, 'workspace']], key === '' ? undefined : key)
        }
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
          max_commitment_ulxc: r.max_commitment_ulxc ?? a.rules.max_commitment_ulxc, allowed_licences: r.allowed_licences ?? a.rules.allowed_licences,
          may_subscribe: r.may_subscribe ?? a.rules.may_subscribe,
          allowed_models: r.allowed_models ?? [], allowed_providers: r.allowed_providers ?? [] }
        this.recordRules(a, ws.id, 'set')
        return json(res, 200, a.rules), true
      }
      if (action === '/statement' && method === 'GET') {
        if (['from', 'to', 'format'].some((k) => url.searchParams.has(k))) {
          return this.answerStatement(res, this.statement(ws.id, a.id, url), url), true
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
      // B34.4 — an automatic top-up (tick() fills it), a handle, a simulated portfolio.
      if (action === '/topup' && method === 'GET') return (a.topup === undefined ? json(res, 404, { error: 'the agent has no automatic top-up' }) : json(res, 200, { agent_id: a.id, ...a.topup })), true
      if (action === '/topup' && method === 'PUT') {
        const { below_ulxc = 0, to_ulxc = 0 } = await this.body<{ below_ulxc?: number; to_ulxc?: number }>(req)
        if (!(below_ulxc > 0) || !(to_ulxc > below_ulxc)) return json(res, 400, { error: 'economy: invalid agent rule: a top-up needs 0 < below_ulxc < to_ulxc' }), true
        a.topup = { below_ulxc, to_ulxc }
        return json(res, 200, { agent_id: a.id, ...a.topup }), true
      }
      if (action === '/topup' && method === 'DELETE') {
        if (!this.broken('topup-kept')) a.topup = undefined
        return json(res, 200, { agent_id: a.id, topup: null }), true
      }
      if (action === '/handle' && method === 'PUT') {
        const handle = ((await this.body<{ handle?: string }>(req)).handle ?? '').trim().replace(/^@/, '').toLowerCase()
        if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(handle)) return json(res, 400, { error: 'economy: a handle is 3–32 of a–z, 0–9, . _ -' }), true
        if ([...this.agents.values()].some((x) => x.handle === handle && x.id !== a.id)) return json(res, 409, { error: 'economy: that handle is taken' }), true
        a.handle = handle
        return json(res, 200, { wallet_id: a.id, handle, name: a.name }), true
      }
      if (action === '/portfolios' && method === 'POST') {
        const { name = '', cash_uusd = 0 } = await this.body<{ name?: string; cash_uusd?: number }>(req)
        if (name.trim() === '' || !(cash_uusd > 0)) return json(res, 400, { error: 'economy: a portfolio needs a name and simulated cash' }), true
        const pf: Portfolio = { id: id('pf_'), agent_id: a.id, name: name.trim(), starting_cash_uusd: cash_uusd, created_at: now, orders: [] }
        this.portfolios.push(pf)
        return json(res, 201, this.portfolioOut(pf)), true
      }
      if (action === '/claim' && method === 'POST') return json(res, 200, { agent_id: a.id, owner_user_id: a.owner_user_id }), true
      if (action === '/portfolios' && method === 'GET') {
        return json(res, 200, { notice: SIM_NOTICE, portfolios: this.portfolios.filter((x) => x.agent_id === a.id).map((x) => this.portfolioOut(x)) }), true
      }
      return this.d.miss(req, res, `/v1/workspaces/${ws.id}${rest}`), true
    }

    // ── the marketplace ──
    if (rest === '/marketplace/listings' && method === 'POST') {
      const b = await this.body<Partial<Listing> & { artifact?: Record<string, unknown>; parents?: { listing_id: string; version: number }[] }>(req)
      if (!b.title || b.artifact === undefined) return json(res, 400, { error: 'market: a listing needs a title and its artifact' }), true
      // B34.4 — a parent someone else owns needs a remix grant on that version.
      const parents = (b.parents ?? []).map((p) => ({ p, l: this.listings.get(p.listing_id), g: this.grants.find((g) => g.ws === ws.id && g.listing_id === p.listing_id && g.version === p.version) }))
      const unfit = parents.find((x) => x.l === undefined || (x.l.workspace_id !== ws.id && x.g === undefined))
      if (unfit !== undefined) return json(res, 400, { error: `market: invalid listing: ${unfit.p.listing_id} version ${unfit.p.version} is not yours to build on; remix it first` }), true
      const secret = SECRETS.find(([, re]) => re.test(`${b.title} ${b.description ?? ''} ${JSON.stringify(b.artifact)}`))
      if (secret !== undefined && !this.broken('secret-published')) {
        return json(res, 422, { error: `market: the listing cannot be published: it contains a secret (${secret[0]}) — remove it and publish again`,
          scan: { secrets: [secret[0]], injection_risk: 0, refused: `it contains a secret (${secret[0]}) — remove it and publish again` } }), true
      }
      const caps = this.checkCapabilities(b.capabilities)
      if (typeof caps === 'string') return json(res, 400, { error: caps }), true
      const l: Listing = { id: id('lst_'), workspace_id: ws.id, kind: b.kind ?? 'prompt', title: b.title, description: b.description ?? '', capabilities: caps,
        price_per_use_ulxc: b.price_per_use_ulxc ?? 0, visibility: b.visibility ?? 'public', latest_version: 1, created_at: now, updated_at: now,
        review_status: READS_AS_INJECTION.test(`${b.title} ${b.description ?? ''} ${JSON.stringify(b.artifact)}`) ? 'held' : 'approved',
        artifact: b.artifact, changelog: b.changelog ?? '' }
      const priced = (b.offers ?? []).length > 0 ? this.setOffers(l, b.offers ?? [], now) : undefined
      if (priced !== undefined) return json(res, 400, { error: priced }), true
      this.listings.set(l.id, l)
      for (const { p, l: parent, g } of parents) {
        this.lineage.push({ child_listing_id: l.id, child_version: 1, parent_listing_id: p.listing_id, parent_version: p.version,
          share_bps: g?.share_bps ?? parent?.remix_share_bps ?? 0, source: 'declared', created_at: now })
      }
      return json(res, 201, this.listingOut(l, ws.id)), true
    }
    if (rest === '/marketplace/listings' && method === 'GET') {
      return json(res, 200, { listings: [...this.listings.values()].filter((l) => l.workspace_id === ws.id).map((l) => this.listingOut(l, ws.id)) }), true
    }
    // B34.4 — a listing's owner gives it a version, its offers and its remix terms; anyone may remix one that allows it.
    // B32.90 — the collections a workspace curates: made, replaced and deleted; a collection lists public, approved listings.
    if ((m = /^\/marketplace\/collections(?:\/([^/]+))?$/.exec(rest)) !== null) {
      const c = m[1] === undefined ? undefined : this.collections.get(m[1])
      if (m[1] !== undefined && c?.workspace_id !== ws.id) return json(res, 404, { error: 'market: not found: no such collection' }), true
      if (method === 'GET' && c === undefined) return json(res, 200, { collections: [...this.collections.values()].filter((x) => x.workspace_id === ws.id).map((x) => this.collectionOut(x, false)) }), true
      if (method === 'DELETE' && c !== undefined) return this.collections.delete(c.id), json(res, 200, { id: c.id, deleted: true }), true
      if ((method === 'POST' && c === undefined) || (method === 'PUT' && c !== undefined)) {
        const b = await this.body<{ title?: string; description?: string; public?: boolean; listing_ids?: string[] }>(req)
        const ids = b.listing_ids ?? []
        if ((b.title ?? '').trim() === '') return json(res, 400, { error: 'market: invalid listing: a collection needs a title of at most 120 characters' }), true
        const unfit = ids.find((x) => { const l = this.listings.get(x); return l === undefined || l.visibility !== 'public' || l.review_status !== 'approved' })
        if (unfit !== undefined) return json(res, 400, { error: `market: invalid listing: listing ${unfit} is not a public listing anyone may find` }), true
        const at: StubCollection = c ?? { id: id('col_'), workspace_id: ws.id, title: '', description: '', public: false, featured: false, listing_ids: [], created_at: now, updated_at: now }
        Object.assign(at, { title: b.title, description: b.description ?? '', public: b.public === true, listing_ids: ids, updated_at: now })
        if (!at.public) Object.assign(at, { featured: false, featured_at: undefined })
        this.collections.set(at.id, at)
        return json(res, c === undefined ? 201 : 200, this.collectionOut(at, true)), true
      }
      return this.d.miss(req, res, `/v1/workspaces/${ws.id}${rest}`), true
    }
    if ((m = /^\/marketplace\/listings\/([^/]+)\/(versions|offers|remix-terms|remix|licences|capabilities)$/.exec(rest)) !== null) {
      const l = this.listings.get(m[1])
      const own = l !== undefined && l.workspace_id === ws.id
      if (l === undefined || !this.visible(l, ws.id)) return json(res, 404, { error: 'market: no such listing' }), true
      if (['versions', 'offers', 'remix-terms', 'capabilities'].includes(m[2]) && !own) return json(res, 404, { error: 'market: no such listing' }), true
      if (m[2] === 'capabilities' && method === 'PUT') {
        const caps = this.checkCapabilities((await this.body<{ capabilities?: unknown }>(req)).capabilities ?? null)
        if (typeof caps === 'string') return json(res, 400, { error: caps }), true
        l.capabilities = caps
        return json(res, 200, { capabilities: caps }), true
      }
      if (m[2] === 'versions' && method === 'POST') {
        const b = await this.body<{ artifact?: Record<string, unknown>; changelog?: string }>(req)
        if (b.artifact === undefined) return json(res, 400, { error: 'body must be {artifact, changelog, parents}' }), true
        l.artifacts = { ...(l.artifacts ?? { 1: l.artifact }), [l.latest_version + 1]: b.artifact }
        l.latest_version++
        l.artifact = b.artifact
        l.changelog = b.changelog ?? ''
        return json(res, 201, { version: l.latest_version, changelog: l.changelog, created_at: now }), true
      }
      if (m[2] === 'offers' && method === 'PUT') {
        const { offers = [] } = await this.body<{ offers?: Omit<StubOffer, 'id' | 'created_at'>[] }>(req)
        const refused = this.setOffers(l, offers, now)
        if (refused !== undefined) return json(res, 400, { error: refused }), true
        return json(res, 200, { offers: l.offers }), true
      }
      if (m[2] === 'remix-terms' && method === 'PUT') {
        const { remix_policy = 'none', remix_share_bps = 0 } = await this.body<{ remix_policy?: string; remix_share_bps?: number }>(req)
        if (!['none', 'free', 'royalty'].includes(remix_policy) || (remix_policy === 'royalty' && !(remix_share_bps >= 1 && remix_share_bps <= 3000))) {
          return json(res, 400, { error: 'market: invalid remix terms' }), true
        }
        l.remix_policy = remix_policy
        l.remix_share_bps = remix_policy === 'royalty' ? remix_share_bps : 0
        return json(res, 200, { remix_policy: l.remix_policy, remix_share_bps: l.remix_share_bps }), true
      }
      if (m[2] === 'remix' && method === 'POST') {
        const { version = 0 } = await this.body<{ version?: number }>(req)
        const v = version || l.latest_version
        if ((l.remix_policy ?? 'none') === 'none' && !own) return json(res, 403, { error: 'market: this listing may not be remixed' }), true
        const artifact = (l.artifacts ?? { 1: l.artifact })[v]
        if (artifact === undefined) return json(res, 404, { error: 'market: no such version' }), true
        let g = this.grants.find((x) => x.ws === ws.id && x.listing_id === l.id && x.version === v)
        if (g === undefined && !own) {
          g = { ws: ws.id, listing_id: l.id, version: v, share_bps: this.broken('remix-share-lost') ? 0 : l.remix_share_bps ?? 0, accepted_at: now }
          this.grants.push(g)
        }
        return json(res, 200, { listing_id: l.id, version: v, kind: l.kind, title: l.title, licence: 'docs/terms/remix.md',
          ...(g === undefined ? {} : { grant: { listing_id: g.listing_id, version: g.version, share_bps: g.share_bps, accepted_at: g.accepted_at } }), artifact }), true
      }
      if (m[2] === 'licences' && method === 'POST') {
        const key = String(req.headers['idempotency-key'] ?? '')
        if (key.length < 1 || key.length > 128) return json(res, 400, { error: 'market: invalid listing: licensing takes an Idempotency-Key of 1 to 128 characters, so a retry never buys twice' }), true
        const again = this.licences.find((x) => x.ws === ws.id && x.key === key)
        if (again !== undefined && !this.broken('licence-replay-buys')) return json(res, 200, this.licenceOut(again)), true
        const { offer_id = '', version = 0 } = await this.body<{ offer_id?: string; version?: number }>(req)
        const o = (l.offers ?? []).find((x) => x.id === offer_id)
        if (o === undefined || o.kind === 'per_use') return json(res, 400, { error: 'market: invalid listing: that offer is not one a licence is bought on' }), true
        const refused = agent === undefined ? undefined : this.judgeLicence(agent, l.id, o)
        const use: Use = { id: id('use_'), listing_id: l.id, seller: l.workspace_id, buyer: ws.id, agent_id: agent?.id ?? '', price_ulxc: o.price_usd_micros * ULXC_PER_USD_MICRO,
          charge: o.price_usd_micros === 0 ? 'free' : 'billed', used_at: now, payee_agent_id: '', memo: '' }
        const days = o.kind === 'buy' ? undefined : o.period_days ?? 30
        const lic: StubLicence = { id: id('lic_'), ws: ws.id, listing_id: l.id, title: l.title, offer_id: o.id, licence: o.licence, kind: o.kind, pinned_version: version || null,
          starts_at: now, ends_at: days === undefined ? null : new Date(Date.now() + days * 86_400e3).toISOString(), auto_renew: o.kind === 'subscribe', status: 'active',
          use_id: use.id, charge: use.charge, price_ulxc: use.price_ulxc, created_at: now, key, included_uses: o.included_uses, agent_id: agent?.id }
        if (refused === undefined || this.broken('licence-refused-kept')) {
          if (!this.broken('licence-unbilled')) this.uses.push(use)
          this.licences.unshift(lic)
        }
        if (refused !== undefined) return json(res, refused.status, { error: refused.error, ...(refused.approval_id === undefined ? {} : { approval_id: refused.approval_id }) }), true
        return json(res, 201, this.licenceOut(lic)), true
      }
    }
    if ((m = /^\/marketplace\/licences(?:\/([^/]+)\/cancel)?$/.exec(rest)) !== null) {
      if (m[1] === undefined && method === 'GET') {
        for (const x of this.licences) if (x.status === 'active' && x.ends_at !== null && x.ends_at <= now && !x.auto_renew) x.status = 'expired'
        return json(res, 200, { licences: this.licences.filter((x) => x.ws === ws.id).map((x) => this.licenceOut(x)) }), true
      }
      const lic = this.licences.find((x) => x.id === m?.[1] && x.ws === ws.id)
      if (m[1] !== undefined && method === 'POST') {
        if (lic === undefined) return json(res, 404, { error: 'market: no such licence' }), true
        if (!this.broken('licence-renews')) lic.auto_renew = false
        return json(res, 200, this.licenceOut(lic)), true
      }
    }
    if ((m = /^\/marketplace\/listings\/([^/]+)\/use$/.exec(rest)) !== null && method === 'POST') {
      const l = this.listings.get(m[1])
      if (l === undefined || !this.visible(l, ws.id)) return json(res, 404, { error: 'market: no such listing' }), true
      if (l.review_status === 'taken_down') return json(res, 403, { error: 'market: the listing was taken down' }), true
      const b = await this.body<{ model?: string; variables?: Record<string, string>; max_price_usd_micros?: number }>(req)
      const template = String(l.artifact.template ?? '')
      const missing = [...template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((x) => x[1]).filter((v) => !(b.variables?.[v] ?? '').trim())
      if (missing.length > 0) return json(res, 400, { error: `market: the prompt needs ${missing.map((v) => `{{${v}}}`).join(', ')}` }), true
      const model = b.model || String(l.artifact.model ?? '')
      if (model === '') return json(res, 400, { error: 'market: this listing names no model, so the use must' }), true
      const covered = l.workspace_id === ws.id ? undefined : this.coveringLicence(ws.id, l.id, agent, now)
      let charge = l.workspace_id === ws.id && !this.broken('self-use-billed') ? 'own' : covered !== undefined ? 'licensed' : l.price_per_use_ulxc === 0 ? 'free' : 'billed'
      // B32.79 — a billed use is a trial while the buyer has one of the listing's trial uses left.
      const given = (l.offers ?? []).find((o) => o.kind === 'per_use' && o.licence === 'commercial')?.trial_uses ?? 0
      const had = this.uses.filter((u) => u.buyer === ws.id && u.listing_id === l.id && u.trial_ulxc !== undefined).length
      const trial = charge === 'billed' && given > 0 && (had < given || this.broken('trial-endless'))
      if (trial) charge = 'trial'
      const stored = trial && this.broken('trial-billed') ? 'billed' : charge
      const use: Use = { id: id('use_'), listing_id: l.id, seller: l.workspace_id, buyer: ws.id, agent_id: agent?.id ?? '', price_ulxc: stored === 'billed' ? l.price_per_use_ulxc : 0,
        charge: stored, used_at: now, payee_agent_id: '', memo: '', licence_id: covered?.id, trial_ulxc: trial ? l.price_per_use_ulxc : undefined }
      // B32.81 — the most this use may cost (Lens B32.23): above it, nothing runs and nothing is charged.
      // STUB_BREAK=max-price-ignored runs it anyway; max-price-kept refuses it but bills it.
      const cost = charge === 'billed' ? l.price_per_use_ulxc / ULXC_PER_USD_MICRO : 0
      if (b.max_price_usd_micros !== undefined && cost > b.max_price_usd_micros && !this.broken('max-price-ignored')) {
        if (this.broken('max-price-kept')) this.uses.push(use)
        return json(res, 409, { error: `market: this use costs more than its max_price_usd_micros: it costs ${cost} µUSD now, above your ${b.max_price_usd_micros} — nothing ran and nothing was charged` }), true
      }
      const ran = this.d.runModel(ws, model, template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, v: string) => b.variables?.[v] ?? ''))
      if ('error' in ran) return json(res, 400, { error: ran.error }), true
      this.uses.push(use)
      const told = trial ? { trial: true, trial_uses_left: Math.max(given - had - 1, 0), would_have_cost_usd_micros: l.price_per_use_ulxc / ULXC_PER_USD_MICRO } : {}
      return json(res, 200, { id: use.id, listing_id: l.id, version: 1, kind: l.kind, model, charge, price_ulxc: charge === 'billed' ? use.price_ulxc : 0, output: ran.answer, used_at: now, ...told }), true
    }
    if (rest === '/marketplace/earnings') {
      const pending = this.uses.filter((u) => u.seller === ws.id && u.charge === 'billed' && u.cleared_at === undefined && u.refunded_at === undefined)
      const e = this.earnings(ws.id)
      const earnings = this.uses.filter((u) => u.seller === ws.id && u.cleared_at !== undefined).map((u) => ({ use_id: u.id, listing_id: u.listing_id,
        gross_usd_micros: u.price_ulxc / ULXC_PER_USD_MICRO, share_usd_micros: shareOf(u), fee_usd_micros: u.price_ulxc / ULXC_PER_USD_MICRO - shareOf(u),
        invoice_id: u.invoice, cleared_at: u.cleared_at,
        payable_at: u.cleared_at, refunded_at: u.kept ? undefined : u.refunded_at, payee_agent_id: u.payee_agent_id || undefined }))
      return json(res, 200, { pending_uses: pending.length, pending_usd_micros: pending.reduce((s, u) => s + shareOf(u), 0), payable_usd_micros: e.available, in_holdback_usd_micros: 0,
        available_usd_micros: e.available, paid_out_usd_micros: e.paid, owed_usd_micros: 0, lifetime_gross_usd_micros: e.lifetime, refunded_usd_micros: e.refunded, earnings }), true
    }
    if (rest === '/marketplace/journal') {
      // What the seller is owed: a paid use's share in holdback until tick() releases it, then available less what was paid out.
      const e = this.earnings(ws.id)
      const held = this.uses.filter((u) => u.seller === ws.id && u.cleared_at !== undefined && u.released_at === undefined && (u.refunded_at === undefined || u.kept))
        .reduce((s, u) => s + shareOf(u), 0)
      const released = this.uses.some((u) => u.seller === ws.id && u.released_at !== undefined)
      return json(res, 200, { holdback_usd_micros: held, available_usd_micros: e.available - held - (released && this.broken('journal-off') ? 1 : 0),
        due_for_release_usd_micros: held, reconciled: !this.broken('journal-unreconciled') }), true
    }
    if (rest === '/marketplace/bill') {
      const month = url.searchParams.get('month') ?? now.slice(0, 7)
      const lines = this.uses.filter((u) => u.buyer === ws.id && u.charge === 'billed' && u.used_at.startsWith(month)).map((u) => ({
        use_id: u.id, listing_id: u.listing_id,
        title: u.listing_id !== '' ? this.listings.get(u.listing_id)?.title ?? '' : `Payment to ${this.agents.get(u.payee_agent_id)?.name ?? ''}`,
        agent_id: u.agent_id || undefined, used_at: u.used_at,
        price_ulxc: this.broken('offer-price-backdated') && u.listing_id !== '' ? this.listings.get(u.listing_id)?.price_per_use_ulxc ?? u.price_ulxc : u.price_ulxc, payee_agent_id: u.payee_agent_id || undefined, memo: u.memo || undefined,
        cleared_at: u.cleared_at, refunded_at: u.refunded_at,
        // B32.66 — its buyer's tax (Lens B32.39), worked out once.
        ...this.tax.taxOf(u.buyer, u.id, u.price_ulxc / ULXC_PER_USD_MICRO),
      }))
      const total = lines.filter((l) => l.refunded_at === undefined).reduce((s, l) => s + l.price_ulxc, 0)
      const refunded = lines.filter((l) => l.refunded_at !== undefined).reduce((s, l) => s + l.price_ulxc, 0)
      const tax = lines.filter((l) => l.refunded_at === undefined).reduce((s, l) => s + l.tax_usd_micros, 0)
      return json(res, 200, { month, total_ulxc: total, total_usd_micros: Math.floor(total / 10), refunded_ulxc: refunded,
        net_usd_micros: total / ULXC_PER_USD_MICRO, tax_usd_micros: tax, gross_usd_micros: total / ULXC_PER_USD_MICRO + tax, lines }), true
    }
    // B32.66 — tax profiles, receipts and sellers' tax details (stub-tax.ts); a seller's weekly statements.
    if (await this.tax.route(req, res, ws.id, rest, now)) return true
    // B32.89 — a paying buyer's review of a listing, and its seller's reply (stub-trust.ts).
    if (await this.trustDesk.route(req, res, ws.id, rest, now)) return true
    if (rest === '/marketplace/statements' && method === 'GET') {
      const period = url.searchParams.get('period')
      if (period === null) {
        return json(res, 200, { statements: this.payouts.filter((p) => p.ws === ws.id && p.method === 'stripe').sort((a, b) => (b.period ?? '').localeCompare(a.period ?? ''))
          .map((p) => ({ period: p.period, payout_id: p.id, net_usd_micros: p.net_usd_micros, paid_at: p.paid_at })) }), true
      }
      const st = this.weekStatement(ws.id, period)
      return st === undefined ? json(res, 400, { error: 'market: invalid: period must be an ISO week, such as 2026-W41' }) : json(res, 200, st), true
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
