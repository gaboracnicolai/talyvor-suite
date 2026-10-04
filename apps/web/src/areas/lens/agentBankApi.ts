import { ApiError, getJSON } from '../../lib/api'
import { isSessionExpired } from '../../lib/productState'

// agentBankApi.ts — B19.4: the Agent Bank screen's reads and writes, through the BFF's /api/agents
// routes (apps/bff/agent_bank.go) to Lens's agent accounts (B19.1), rules and approvals (B19.2) and
// payments between one company's agents (B19.3). Every amount is an integer count of µLXC.
//
// A refusal carries Lens's own sentence — which rule, what the agent holds, which approval to
// approve — and the screen shows it, because that sentence is the answer to "why not?".

/** Lens economy.Agent. */
export interface Agent {
  id: string
  name: string
  balance_ulxc: number
  spent_ulxc: number
  keys: string[]
  created_at: string
  /** B19.6 — set while the agent is paused on its own: every movement is refused until it is resumed. */
  paused_at?: string
  paused_reason?: string
  /**
   * B19.11 — the person who owns the agent; "" when it has none, and Lens then refuses to give it a
   * balance until someone claims it. Absent only from a Lens older than B19.11, which refuses nothing.
   */
  owner_user_id?: string
  /** B19.11 — its owner's workspace is verified: a completed card purchase, or Talyvor's vouch. */
  verified?: boolean
  /** B22.3 — its address besides its id, once its owner picks one. */
  handle?: string
}

/** Lens economy.AgentBook: workspace = allocated + unallocated; spent is what the agents spent. */
export interface AgentBook {
  workspace_balance_ulxc: number
  allocated_ulxc: number
  unallocated_ulxc: number
  spent_ulxc: number
  agents: Agent[]
  /** B19.7 — set while every agent in the workspace is paused. */
  all_paused_at?: string
  all_paused_reason?: string
}

/** Lens economy.AgentSchedule (B19.8): pays another agent, or a marketplace listing (B19.17), every period. */
export interface AgentSchedule {
  id: string
  from_agent_id: string
  to_agent_id: string
  to_listing_id?: string
  /** to a listing: the most a tick pays, 0 for its price at the time */
  amount_ulxc: number
  memo?: string
  every: 'hour' | 'day' | 'week' | 'month'
  next_run_at: string
  active: boolean
  created_at: string
}

/** Lens economy.AgentScheduleRun: one tick, paid or refused (and why). */
export interface AgentScheduleRun {
  tick_at: string
  outcome: 'paid' | 'refused'
  entry_id?: string
  use_id?: string
  detail?: string
  created_at: string
}

/** Lens economy.AgentTopUp: below below_ulxc, the workspace tops the agent back up to to_ulxc. */
export interface AgentTopUp {
  agent_id: string
  below_ulxc: number
  to_ulxc: number
}

/** Lens economy.AgentSpendAlert (B19.6). */
export interface AgentSpendAlert {
  id: string
  agent_id: string
  last_hour_ulxc: number
  usual_per_hour_ulxc: number
  /** the alert paused the agent */
  paused: boolean
  created_at: string
}

/** Lens economy.SpendForecast (B19.6): this UTC month so far, run on to its end. */
export interface SpendForecast {
  at: string
  month_start: string
  month_end: string
  spent_ulxc: number
  forecast_ulxc: number
  agents: { agent_id: string; name: string; spent_ulxc: number; forecast_ulxc: number }[] | null
}

/** Lens economy.AgentRules. A zero limit and an empty list are "no rule". */
export interface AgentRules {
  max_per_request_ulxc: number
  daily_limit_ulxc: number
  monthly_limit_ulxc: number
  approval_above_ulxc: number
  allowed_models: string[] | null
  allowed_providers: string[] | null
  /** B19.14 — the marketplace listings it may use; empty or null allows any. */
  allowed_listings?: string[] | null
  active_from: string
  active_until: string
  timezone: string
  /** B19.6 — pause the agent on an unusual-spend alert. Carried back unchanged on a save. */
  pause_on_unusual_spend?: boolean
}

/** Lens economy.Payee. `name` is empty when the payee no longer exists. */
export interface ApprovalPayee {
  kind: 'agent' | 'listing' | 'company' | 'merchant'
  id: string
  name: string
}

/** Lens economy.AgentApproval. `model` is empty for a payment to another agent. */
export interface AgentApproval {
  id: string
  agent_id: string
  amount_ulxc: number
  model: string
  /** Why the agent asked (B19.9), when it asked through its own tools. */
  reason?: string
  /** Who a payment goes to (Lens B23.5); none for a request to a model. */
  payee?: ApprovalPayee
  /** The payment's memo. */
  memo?: string
  status: 'pending' | 'approved' | 'denied' | 'used'
  created_at: string
  decided_at?: string
}

/** Lens economy.AgentStatementLine. */
export interface StatementLine {
  entry_id: string
  kind: 'fund' | 'withdraw' | 'spend' | 'hold' | 'settle' | 'release' | 'pay'
  amount_ulxc: number
  counterparty: string
  ref?: string
  balance_after_ulxc: number
  at: string
}

/** Lens economy.AgentPayment. */
export interface AgentPayment {
  entry_id: string
  from_agent_id: string
  to_agent_id: string
  amount_ulxc: number
  from_balance_ulxc: number
  to_balance_ulxc: number
  memo?: string
}

/** The key Lens issues an agent — shown once. */
export interface AgentKey {
  agent_id: string
  key: string
  id: string
  prefix: string
}

/** Lens economy.AgentCard (B19.12): an agent's virtual card, Stripe Issuing in test mode. The number stays at Stripe. */
export interface AgentCard {
  id: string
  agent_id: string
  last4: string
  exp_month: number
  exp_year: number
  /** lower-case ISO code — gbp: Talyvor is a UK platform */
  currency: string
  livemode: boolean
  created_at: string
}

/** Lens economy.CardAuthorizationRecord: one purchase on the card, approved or declined by the agent's rules. */
export interface CardAuthorization {
  id: string
  authorization_id: string
  approved: boolean
  /** Lens's sentence: why it was declined, or what approved it */
  reason: string
  approval_id?: string
  /** in the card's currency, minor units (pence) */
  amount_minor: number
  currency: string
  merchant_name: string
  merchant_category: string
  /** the ECB reference day it was converted at, and the two figures the ECB published that day */
  rate_date?: string
  ecb_usd_per_eur?: string
  ecb_currency_per_eur?: string
  amount_usd_micros?: number
  amount_ulxc?: number
  created_at: string
}

/** Lens agentcard.Cardholder: the person the card is issued to, and the billing address a merchant may ask for. */
export interface Cardholder {
  first_name: string
  last_name: string
  email: string
  /** E.164, e.g. +447700900123; Lens falls back to an unallocated number in test mode when empty (B27.21) */
  phone_number: string
  line1: string
  line2: string
  city: string
  postal_code: string
  /** ISO 3166-1 alpha-2; Lens takes GB when empty */
  country: string
}

/** A refusal, with the sentence Lens gave for it. */
export class AgentBankError extends ApiError {
  constructor(
    status: number,
    path: string,
    readonly sentence: string,
  ) {
    super(status, path)
  }
}

async function send<T>(method: string, path: string, body: object = {}, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new AgentBankError(res.status, path, sentence)
  }
  return (await res.json()) as T
}

const e = encodeURIComponent

/** A fresh Idempotency-Key for one Fund or Take back, or one move into or out of a pot. */
export function newMoveKey(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2)
}

/**
 * B17.26 — whether a Fund or Take back (or, B17.33, a pot's Move in or Move out) met the seconds the app
 * or Lens restarts on a deploy (502, 503, 504, or no answer at all), so it is sent again under its
 * Idempotency-Key: Lens moves the LXC once however many times the key arrives. Sent again up to six times
 * over about fifteen seconds (the card's retryDelay); a refusal is final.
 */
export function retryMoveThroughRestart(failures: number, err: unknown): boolean {
  return failures < 6 && (err instanceof TypeError || (err instanceof AgentBankError && [502, 503, 504].includes(err.status)))
}

/**
 * B19.22 — a statement for the period [from, to) (YYYY-MM-DD, midnight UTC) as the file Lens writes:
 * one agent's account, or with no agent every account in the bank. A refusal carries Lens's sentence.
 */
async function statementFile(agentID: string | null, from: string, to: string, format: 'csv' | 'json'): Promise<Blob> {
  const query = new URLSearchParams({ from, to, format })
  const path = agentID ? `/api/agents/${e(agentID)}/statement?${query}` : `/api/agents/statement?${query}`
  const res = await fetch(path, { headers: { Accept: format === 'csv' ? 'text/csv' : 'application/json' } })
  if (!res.ok) {
    let sentence = ''
    try {
      sentence = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      // a body that is not JSON carries no sentence
    }
    throw new AgentBankError(res.status, path, sentence)
  }
  return res.blob()
}

export const agentBankApi = {
  book: () => getJSON<AgentBook>('/api/agents', {
      workspace_balance_ulxc: 'number',
      allocated_ulxc: 'number',
      unallocated_ulxc: 'number',
      spent_ulxc: 'number',
      agents: 'array',
    }),
  create: (name: string) => send<Agent>('POST', '/api/agents', { name }),
  fund: (id: string, amount_ulxc: number, key: string) =>
    send<{ balance_ulxc: number }>('POST', `/api/agents/${e(id)}/fund`, { amount_ulxc }, { 'Idempotency-Key': key }),
  withdraw: (id: string, amount_ulxc: number, key: string) =>
    send<{ balance_ulxc: number }>('POST', `/api/agents/${e(id)}/withdraw`, { amount_ulxc }, { 'Idempotency-Key': key }),
  issueKey: (id: string, name: string) => send<AgentKey>('POST', `/api/agents/${e(id)}/keys`, { name }),
  rules: (id: string) => getJSON<AgentRules>(`/api/agents/${e(id)}/rules`, {
      max_per_request_ulxc: 'number',
      daily_limit_ulxc: 'number',
      monthly_limit_ulxc: 'number',
      approval_above_ulxc: 'number',
    }),
  setRules: (id: string, rules: AgentRules) => send<AgentRules>('PUT', `/api/agents/${e(id)}/rules`, rules),
  statement: (id: string) => getJSON<{ lines: StatementLine[] | null }>(`/api/agents/${e(id)}/statement`, { lines: 'list' }),
  statementFile,
  /** B19.24 — the agent's test-mode card and every purchase on it; null when it has none (Lens answers 404). */
  card: async (id: string): Promise<{ card: AgentCard; authorizations: CardAuthorization[] | null } | null> => {
    try {
      return await getJSON<{ card: AgentCard; authorizations: CardAuthorization[] | null }>(`/api/agents/${e(id)}/card`, {
        card: 'object',
        authorizations: 'list',
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  issueCard: (id: string, holder: Cardholder) => send<AgentCard>('POST', `/api/agents/${e(id)}/card`, holder),
  /** B19.23 — the signed-in person becomes the owner of an agent that has none. */
  claim: (id: string) => send<{ agent_id: string; owner_user_id: string }>('POST', `/api/agents/${e(id)}/claim`),
  pay: (id: string, to_agent_id: string, amount_ulxc: number, memo: string) =>
    send<AgentPayment>('POST', `/api/agents/${e(id)}/pay`, { to_agent_id, amount_ulxc, memo }),
  approvals: () => getJSON<{ approvals: AgentApproval[] | null }>('/api/agents/approvals', { approvals: 'list' }),
  // B19.21 — scheduled payments and automatic top-ups.
  schedules: () => getJSON<{ schedules: AgentSchedule[] | null }>('/api/agents/schedules', { schedules: 'list' }),
  schedule: (id: string, body: { to_agent_id: string; to_listing_id: string; amount_ulxc: number; memo: string; every: AgentSchedule['every'] }) =>
    send<AgentSchedule>('POST', `/api/agents/${e(id)}/schedules`, body),
  scheduleRuns: (sid: string) => getJSON<{ runs: AgentScheduleRun[] | null }>(`/api/agents/schedules/${e(sid)}/runs`, { runs: 'list' }),
  stopSchedule: (sid: string) => send<{ active: boolean }>('POST', `/api/agents/schedules/${e(sid)}/stop`),
  /** Null when the agent has none (Lens answers 404). */
  topUp: async (id: string): Promise<AgentTopUp | null> => {
    try {
      return await getJSON<AgentTopUp>(`/api/agents/${e(id)}/topup`, { below_ulxc: 'number', to_ulxc: 'number' })
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  setTopUp: (id: string, below_ulxc: number, to_ulxc: number) =>
    send<AgentTopUp>('PUT', `/api/agents/${e(id)}/topup`, { below_ulxc, to_ulxc }),
  removeTopUp: (id: string) => send<unknown>('DELETE', `/api/agents/${e(id)}/topup`),
  // B19.20 — stop every agent or one, and what they are spending.
  alerts: () => getJSON<{ alerts: AgentSpendAlert[] | null; rule: string }>('/api/agents/alerts', { alerts: 'list' }),
  forecast: () => getJSON<SpendForecast>('/api/agents/forecast', { spent_ulxc: 'number', forecast_ulxc: 'number', agents: 'list' }),
  pauseAll: (reason: string) => send<{ all_paused: boolean }>('POST', '/api/agents/pause-all', { reason }),
  resumeAll: () => send<{ all_paused: boolean }>('POST', '/api/agents/resume-all'),
  pause: (id: string, reason: string) => send<{ paused: boolean }>('POST', `/api/agents/${e(id)}/pause`, { reason }),
  resume: (id: string) => send<{ paused: boolean }>('POST', `/api/agents/${e(id)}/resume`),
  /** B19.10: once the workspace has a passkey, a decision carries an assertion over the approval's challenge. */
  decide: (approvalID: string, decision: 'approve' | 'deny', assertion?: PasskeyAssertion) =>
    decision === 'approve'
      ? send<AgentApproval>('POST', `/api/agents/approvals/${e(approvalID)}/approve`, assertion ? { assertion } : {})
      : send<AgentApproval>('POST', `/api/agents/approvals/${e(approvalID)}/deny`, assertion ? { assertion } : {}),
  // B19.10 — passkeys and push, kept by Lens (B19.16).
  passkeys: () => getJSON<{ passkeys: Passkey[] | null }>('/api/agents/passkeys', { passkeys: 'list' }),
  passkeyChallenge: () => send<{ challenge: string; rp_id: string }>('POST', '/api/agents/passkeys/challenge'),
  registerPasskey: (body: PasskeyRegistration) => send<Passkey>('POST', '/api/agents/passkeys', body),
  approvalChallenge: (approvalID: string) =>
    send<{ challenge: string; allow_credentials: string[] | null }>('POST', `/api/agents/approvals/${e(approvalID)}/challenge`),
  pushPublicKey: () => getJSON<{ public_key: string }>('/api/agents/push/public-key', { public_key: 'string' }),
  subscribePush: (sub: PushSubscriptionBody) => send<{ endpoint: string }>('POST', '/api/agents/push/subscriptions', sub),
  // B22.10 — money between owners (Lens B22.1, B22.3, B22.4, B22.5).
  capabilities: () => getJSON<{ capabilities: WalletCapability[] | null }>('/api/wallets/capabilities', { capabilities: 'list' }),
  address: (address: string) => getJSON<WalletAddress>(`/api/wallets/address/${e(address)}`, { wallet_id: 'string', name: 'string' }),
  setHandle: (id: string, handle: string) => send<WalletAddress>('PUT', `/api/agents/${e(id)}/handle`, { handle }),
  send: (id: string, to: string, amount_ulxc: number, memo: string) =>
    send<AgentTransfer>('POST', `/api/agents/${e(id)}/send`, { to, amount_ulxc, memo }),
  request: (id: string, from: string, amount_ulxc: number, memo: string) =>
    send<MoneyRequest>('POST', `/api/agents/${e(id)}/requests`, { from, amount_ulxc, memo }),
  transfers: (id: string) => getJSON<{ transfers: AgentTransfer[] | null }>(`/api/agents/${e(id)}/transfers`, { transfers: 'list' }),
  moneyRequests: () => getJSON<{ requests: MoneyRequest[] | null }>('/api/wallets/requests', { requests: 'list' }),
  answerRequest: (rid: string, accept: boolean) =>
    send<MoneyRequest>('POST', `/api/wallets/requests/${e(rid)}/${accept ? 'accept' : 'decline'}`),
  creditLine: async (): Promise<CreditLine | null> => {
    try {
      return await getJSON<CreditLine>('/api/wallets/credit-line', {
        limit_ulxc: 'number',
        used_ulxc: 'number',
        available_ulxc: 'number',
        invoices: 'array',
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  loans: () => getJSON<{ loans: Loan[] | null }>('/api/wallets/loans', { loans: 'list' }),
  offerLoan: (id: string, body: LoanOffer) => send<Loan>('POST', `/api/agents/${e(id)}/loans`, body),
  acceptLoan: (lid: string) => send<Loan>('POST', `/api/wallets/loans/${e(lid)}/accept`),
  declineLoan: (lid: string) => send<Loan>('POST', `/api/wallets/loans/${e(lid)}/decline`),
  withdrawLoan: (lid: string) => send<{ status: string }>('POST', `/api/wallets/loans/${e(lid)}/withdraw`),
  // B22.12 — escrow, pots, simulated investing and cash-out (Lens B22.6, B22.7, B22.8, B22.9).
  escrows: () => getJSON<{ escrows: Escrow[] | null }>('/api/wallets/escrows', { escrows: 'list' }),
  payIntoEscrow: (id: string, body: { to: string; amount_ulxc: number; release_at: string; memo: string }) =>
    send<Escrow>('POST', `/api/agents/${e(id)}/escrows`, body),
  confirmEscrow: (eid: string) => send<Escrow>('POST', `/api/wallets/escrows/${e(eid)}/confirm`),
  disputeEscrow: (eid: string, reason: string) => send<Escrow>('POST', `/api/wallets/escrows/${e(eid)}/dispute`, { reason }),
  pots: (id: string) => getJSON<{ pots: Pot[] | null }>(`/api/agents/${e(id)}/pots`, { pots: 'list' }),
  createPot: (id: string, body: { name: string; kind: Pot['kind']; target_ulxc: number; locked_until: string | null }) =>
    send<Pot>('POST', `/api/agents/${e(id)}/pots`, body),
  movePot: (id: string, pid: string, dir: 'in' | 'out', amount_ulxc: number, key: string) =>
    dir === 'in'
      ? send<Pot>('POST', `/api/agents/${e(id)}/pots/${e(pid)}/in`, { amount_ulxc }, { 'Idempotency-Key': key })
      : send<Pot>('POST', `/api/agents/${e(id)}/pots/${e(pid)}/out`, { amount_ulxc }, { 'Idempotency-Key': key }),
  lockPot: (id: string, pid: string, locked_until: string | null) => send<Pot>('PUT', `/api/agents/${e(id)}/pots/${e(pid)}/lock`, { locked_until }),
  quotes: () => getJSON<SimQuotes>('/api/wallets/quotes', { quotes: 'list' }),
  portfolios: (id: string) => getJSON<{ portfolios: Portfolio[] | null; notice: string }>(`/api/agents/${e(id)}/portfolios`, {
      portfolios: 'list',
    }),
  openPortfolio: (id: string, name: string, cash_uusd: number) => send<Portfolio>('POST', `/api/agents/${e(id)}/portfolios`, { name, cash_uusd }),
  placeOrder: (id: string, pfid: string, body: SimOrderInput) => send<SimOrder>('POST', `/api/agents/${e(id)}/portfolios/${e(pfid)}/orders`, body),
  cancelOrder: (id: string, pfid: string, oid: string) =>
    send<SimOrder>('POST', `/api/agents/${e(id)}/portfolios/${e(pfid)}/orders/${e(oid)}/cancel`),
  cashOuts: () => getJSON<{ cash_outs: CashOut[] | null }>('/api/wallets/cash-outs', { cash_outs: 'list' }),
  requestCashOut: (id: string, amount_ulxc: number, destination: string) =>
    send<CashOut>('POST', `/api/agents/${e(id)}/cash-outs`, { amount_ulxc, destination }),
}

/** Lens economy.Escrow (B22.6): credits held between a paying and a paid agent. */
export interface Escrow {
  id: string
  payer_workspace_id: string
  payer_agent_id: string
  payee_workspace_id: string
  payee_agent_id: string
  amount_ulxc: number
  memo?: string
  class: 'GREEN' | 'AMBER'
  test_funded_ulxc: number
  release_at: string
  status: 'held' | 'disputed' | 'released' | 'returned'
  created_at: string
  decided_at?: string
  events: { kind: 'held' | 'disputed' | 'released' | 'returned'; actor: 'payer' | 'deadline' | 'operator'; operator?: string; detail?: string; at: string }[]
}

/** Lens economy.Pot (B22.7): credits an agent set aside. */
export interface Pot {
  id: string
  agent_id: string
  name: string
  kind: 'goal' | 'budget' | 'reserve'
  target_ulxc?: number
  locked_until?: string
  balance_ulxc: number
  created_at: string
}

/** Lens economy.Quotes (B22.8): every instrument the simulator trades, in US dollars per unit. */
export interface SimQuotes {
  simulated: boolean
  market_data: string
  rate_date?: string
  quotes: { instrument: string; price_usd: string; rate_date: string }[] | null
}

/** What an order asks for (Lens economy.SimOrderInput). Never a mode: every order here is simulated. */
export interface SimOrderInput {
  instrument: string
  side: 'buy' | 'sell'
  type: 'market' | 'limit'
  quantity_micros: number
  limit_price_usd?: string
}

/** Lens economy.SimOrder (B22.8). */
export interface SimOrder extends SimOrderInput {
  id: string
  portfolio_id: string
  status: 'open' | 'filled' | 'cancelled' | 'rejected'
  fill_price_usd?: string
  fill_rate_date?: string
  cash_uusd: number
  reason?: string
  simulated: boolean
  created_at: string
  decided_at?: string
}

/** Lens economy.Portfolio (B22.8): simulated US dollars and positions, valued at the quotes. */
export interface Portfolio {
  id: string
  agent_id: string
  name: string
  simulated: boolean
  notice: string
  market_data: string
  rate_date?: string
  starting_cash_uusd: number
  cash_uusd: number
  positions: { instrument: string; quantity_micros: number; price_usd: string; value_uusd: number }[] | null
  value_uusd: number
  orders: SimOrder[] | null
  created_at: string
}

/** Lens economy.CashOut (B22.9): credits turned into money through a partner. */
export interface CashOut {
  id: string
  workspace_id: string
  agent_id: string
  amount_ulxc: number
  amount_uusd: number
  test_funded_ulxc: number
  destination: string
  partner: string
  partner_ref?: string
  status: 'held' | 'submitted' | 'paid' | 'failed'
  detail?: string
  created_at: string
  decided_at?: string
}

/** Lens economy.CapabilityStatus (B22.1): what a wallet can do, its class, and whether it takes real money now. */
export interface WalletCapability {
  capability: string
  name: string
  class: 'GREEN' | 'AMBER' | 'RED'
  real_money: boolean
  clearance?: { by: string; reference: string; at: string }
}

/** Lens economy.WalletAddress (B22.3): what a wallet ID or @handle is. */
export interface WalletAddress {
  wallet_id: string
  handle?: string
  name: string
}

/** Lens economy.AgentTransfer (B22.3): credits moved between two agents, of one owner (GREEN) or two (AMBER). */
export interface AgentTransfer {
  id: string
  from_workspace_id: string
  from_agent_id: string
  to_workspace_id: string
  to_agent_id: string
  amount_ulxc: number
  memo?: string
  class: 'GREEN' | 'AMBER'
  test_funded_ulxc: number
  request_id?: string
  schedule_id?: string
  refund_of?: string
  loan_id?: string
  created_at: string
}

/** Lens economy.MoneyRequest (B22.3): from_* asked to_* for credits. */
export interface MoneyRequest {
  id: string
  from_workspace_id: string
  from_agent_id: string
  to_workspace_id: string
  to_agent_id: string
  amount_ulxc: number
  memo?: string
  status: 'pending' | 'accepted' | 'declined'
  transfer_id?: string
  created_at: string
  decided_at?: string
}

/** Lens economy.CreditLine (B22.4): a company's credit line. */
export interface CreditLine {
  workspace_id: string
  limit_ulxc: number
  used_ulxc: number
  available_ulxc: number
  paused: boolean
  paused_reason?: string
  invoices: {
    id: string
    period_end: string
    amount_ulxc: number
    amount_cents: number
    due_at: string
    paid_at?: string
    late: boolean
  }[]
}

/** What a lender offers (Lens B22.5). interest_bps is on the principal over the whole term: 1000 is 10%. */
export interface LoanOffer {
  to: string
  principal_ulxc: number
  interest_bps: number
  instalments: number
  every: 'day' | 'week' | 'month'
  late_fee_ulxc: number
  memo: string
}

/** Lens economy.Loan (B22.5). */
export interface Loan {
  id: string
  lender_workspace_id: string
  lender_agent_id: string
  borrower_workspace_id: string
  borrower_agent_id: string
  principal_ulxc: number
  interest_bps: number
  instalments: number
  every: 'day' | 'week' | 'month'
  late_fee_ulxc: number
  memo?: string
  status: 'offered' | 'declined' | 'withdrawn' | 'active' | 'late' | 'defaulted' | 'repaid'
  paid_instalments: number
  next_due_at?: string
  offered_at: string
  decided_at?: string
  events: {
    kind: 'payout' | 'instalment' | 'missed' | 'late' | 'defaulted'
    instalment?: number
    principal_ulxc?: number
    interest_ulxc?: number
    late_fee_ulxc?: number
    transfer_id?: string
    detail?: string
    at: string
  }[]
}

/** A passkey the workspace's owner registered (B19.16). */
export interface Passkey {
  credential_id: string
  name: string
  created_at: string
  last_used_at?: string
}

/** A new passkey, as the browser's ceremony gives it — all base64url. */
export interface PasskeyRegistration {
  credential_id: string
  name: string
  public_key: string
  client_data_json: string
  authenticator_data: string
}

/** A passkey's signature over an approval's challenge — all base64url. */
export interface PasskeyAssertion {
  credential_id: string
  client_data_json: string
  authenticator_data: string
  signature: string
}

/** A device's push subscription, as PushSubscription.toJSON() gives it. */
export interface PushSubscriptionBody {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** `12.5` → 12,500,000 µLXC. Null for anything that is not a positive amount with at most six decimals. */
export function parseLXC(text: string): number | null {
  const m = /^\s*(\d+)(?:\.(\d{1,6}))?\s*$/.exec(text)
  if (!m) return null
  const micros = Number(m[1]) * 1_000_000 + Number((m[2] ?? '').padEnd(6, '0'))
  return Number.isSafeInteger(micros) && micros > 0 ? micros : null
}

/** 12,500,000 µLXC → `12.5 LXC`: every µLXC shown, no trailing zeros. */
export function formatULXC(micros: number): string {
  return `${(micros / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 6 })} LXC`
}

/** A limit field's text: empty for "no limit". */
export function limitText(micros: number): string {
  return micros > 0 ? String(micros / 1_000_000) : ''
}

/** The approval a payment filed, named in Lens's refusal: "… approval apr_… must be approved …". */
export function approvalNamedIn(err: unknown): string | null {
  return err instanceof AgentBankError ? (/approval (apr_[\w-]+)/.exec(err.sentence)?.[1] ?? null) : null
}

/** Why a write did not happen, in Lens's words where Lens gave some. */
export function refusalText(err: unknown): string {
  if (isSessionExpired(err)) return 'Nothing changed — sign in again.'
  if (err instanceof AgentBankError && err.status < 500 && err.sentence) {
    const s = err.sentence.replace(/^economy: /, '')
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return 'Nothing changed. You can try again.'
}
