// B17.3 — the harness's own calls to Lens: create and reset the synthetic users (B17.1), read each
// one's ledger back, and ask the judge. Every call a synthetic user makes uses that user's own token.

import { randomUUID } from 'node:crypto'
import type { Recorder, Tag } from './coverage.ts'
import type { CatalogModel } from './oracles.ts'
import type { Plan } from './pricing.ts'

export interface SyntheticUser {
  index: number
  workspaceID: string
  token: string
  expiresAt: string
  /** B35.7 — the plan Lens created it on (talyvor-lens B35.1); Free when none was asked for. */
  plan?: Plan
}

/** One row of the workspace's LXC ledger (GET /v1/workspaces/{id}/lxc/history). */
export interface LedgerRow {
  id: string
  amount_ulxc: number
  balance_after_ulxc: number
  type: string
  description: string
  /** What Lens tagged the row with — a credits payout's row names its market_payout_id. */
  metadata?: Record<string, unknown>
  created_at: string
}

export interface JudgeReply {
  text: string
  inputTokens: number
  outputTokens: number
  /** Lens replayed an earlier answer (X-Talyvor-Cache-Replay): it cost nothing and wrote no ledger row. */
  replayed: boolean
  /** Lens served another workspace's answer from the pool and charged this (X-Talyvor-Pool-Charged-ULXC). */
  pooledULXC: number | undefined
}

/** B17.6 — an answer Lens may refuse: what it answered, or its status and sentence. */
export type Answered<T> = { ok: true; status: number; value: T } | { ok: false; status: number; error: string }

/** Lens economy.Agent, as much of it as the bank scenarios read. */
export interface Agent {
  id: string
  name: string
  balance_ulxc: number
  spent_ulxc: number
  owner_user_id?: string
  /** B25.4 — what its pots hold, beside its balance */
  pots_ulxc?: number
  /** B28.21 — what it is for, and when it was archived (swept to zero, its keys revoked) */
  description?: string
  archived_at?: string
  /** B19.6 — set while it is paused on its own */
  paused_at?: string
  /** B28.359 — the ids of every key it was issued, revoked ones too */
  keys?: string[]
}

/** B25.4 — Lens economy.AgentTransfer (B22.3): credits moved between two agents, of one owner or two. */
export interface AgentTransfer {
  id: string
  from_workspace_id: string
  from_agent_id: string
  to_workspace_id: string
  to_agent_id: string
  amount_ulxc: number
  memo?: string
  request_id?: string
  schedule_id?: string
  refund_of?: string
  loan_id?: string
  created_at: string
  /** B28.299: the refund that gave it back */
  refunded_by?: string
  /** B28.299: the reading agent received it and may still give it back */
  refundable?: boolean
}

/** B25.4 — Lens economy.MoneyRequest: from_* asked to_* for credits. */
export interface MoneyRequest {
  id: string
  from_agent_id: string
  to_agent_id: string
  amount_ulxc: number
  status: 'pending' | 'accepted' | 'declined'
  transfer_id?: string
}

/** B25.4 — Lens economy.Loan (B22.5). */
export interface Loan {
  id: string
  lender_agent_id: string
  borrower_agent_id: string
  principal_ulxc: number
  interest_bps: number
  instalments: number
  every: string
  status: string
  paid_instalments: number
  next_due_at?: string
  decided_at?: string
  events: { kind: string; transfer_id?: string; at: string }[] | null
}

/** B25.4 — Lens economy.Escrow (B22.6). */
export interface Escrow {
  id: string
  payer_agent_id: string
  payee_agent_id: string
  amount_ulxc: number
  memo?: string
  status: 'held' | 'disputed' | 'released' | 'returned'
  release_at: string
}

/** B25.4 — Lens economy.Pot (B22.7). */
export interface Pot {
  id: string
  agent_id: string
  name: string
  balance_ulxc: number
}

/** B25.4 — Lens economy.AgentSchedule and one of its runs (B19.21, B22.3). */
export interface AgentSchedule {
  id: string
  from_agent_id: string
  to_agent_id: string
  amount_ulxc: number
  every: string
  next_run_at: string
  active: boolean
}
export interface ScheduleRun {
  tick_at: string
  outcome: 'paid' | 'refused'
  entry_id?: string
  detail?: string
}

/** B25.4 — Lens economy.CashOut (B22.9). */
export interface CashOut {
  id: string
  agent_id: string
  amount_ulxc: number
  destination: string
  partner: string
  status: 'held' | 'submitted' | 'paid' | 'failed'
  detail?: string
}

/** B25.4 — Lens economy.AgentCard (B19.24): an agent's Stripe Issuing card. */
export interface AgentCard {
  id: string
  agent_id: string
  last4: string
  currency: string
  livemode: boolean
  /** B28.360 — Lens declines every purchase on a frozen card */
  frozen?: boolean
}

/** B25.4 — a marketplace listing as Lens lists it (market.Listing). */
export interface Listing {
  id: string
  workspace_id: string
  title: string
  price_per_use_ulxc: number
  review_status: string
}

/** B25.8 — one payout (market.Payout): money through Stripe, or the balance taken as credits. */
export interface Payout {
  id: string
  method: 'stripe' | 'credits'
  gross_usd_micros: number
  credits_ulxc?: number
  paid_at?: string
}

/** B25.4 — the seller's payout page (market.Payouts): account is null until they connect Stripe. */
export interface Payouts {
  account: { stripe_account_id: string; country: string; details_submitted: boolean; payouts_enabled: boolean } | null
  in_holdback_usd_micros: number
  available_usd_micros: number
  paid_out_usd_micros?: number
  payouts: Payout[] | null
}

/** B25.8 — one purchase on an agent's card (economy.CardAuthorizationRecord), approved or declined by its rules. */
export interface CardAuthorization {
  authorization_id: string
  approved: boolean
  reason: string
  amount_minor: number
  currency: string
  merchant_name: string
  amount_ulxc?: number
}

/** B25.8 — what a synthetic-key route that brings a test user's slow money due answers (Lens B25.7). */
export interface PaidTestBill {
  invoice_id: string
  uses_cleared: number
}
export interface CardPurchase {
  authorization_id: string
  approved: boolean
  reason: string
  amount_ulxc: number
}

/** B25.4 — one listing in the moderators' review queue (market.QueueItem). */
export interface QueueItem {
  listing: Listing
  open_reports: number
  report_reasons: string[] | null
}

/** B30.115 — one wallet capability as Lens lists it (economy.CapabilityStatus). */
export interface CapabilityStatus {
  capability: string
  name: string
  class: string
  real_money: boolean
  clearance?: unknown
}

/** Lens economy.AgentBook: workspace = allocated + unallocated. */
export interface AgentBook {
  workspace_balance_ulxc: number
  allocated_ulxc: number
  unallocated_ulxc: number
  spent_ulxc: number
  agents: Agent[]
  all_paused_at?: string
}

/**
 * Lens economy.SpendForecast (B19.6): each agent's spend this UTC month and where it is heading. B28.94 adds, per agent,
 * what it holds and when that runs out at its pace so far (RFC 3339 in the agent's time zone; null: it does not).
 */
export interface SpendForecastRead {
  at: string
  month_start: string
  month_end: string
  agents: { agent_id: string; name: string; spent_ulxc: number; forecast_ulxc: number; balance_ulxc?: number; runs_out_at?: string | null }[] | null
}

/** Lens economy.AgentApproval. A payment names who it pays and why (Lens B23.5). */
export interface AgentApproval {
  id: string
  agent_id: string
  amount_ulxc: number
  payee?: { kind: string; id: string; name: string }
  memo?: string
  status: 'pending' | 'approved' | 'denied' | 'used'
}

/** Lens economy.AgentStatementLine: one posting on an agent's account. */
export interface AgentLine {
  entry_id: string
  kind: string
  amount_ulxc: number
  counterparty: string
  /** A payment's memo, or the request a call's lines paid for. */
  ref?: string
  balance_after_ulxc: number
  at: string
  /** B28.93 — on a call's lines: the model it asked, and where it came from. */
  model?: string
  source?: string
}

/** B28.31 — Lens economy.AgentRulesVersion: the rules as one change left them, who changed them (the credential) and how. */
export interface AgentRulesVersion {
  version: number
  rules: AgentRulesRead
  changed_by: string
  change: string
  created_at: string
}

/** B28.32 — Lens economy.AgentRuleBoost: one of an agent's limits raised from the rules' value until a time. */
export interface AgentRuleBoost {
  rule: string
  raised_from: number
  value: number
  until: string
  created_by: string
  created_at: string
}

/** Lens economy.AgentRules as its rules read answers them, in µLXC; a zero, an empty list or an empty window is no rule. */
export interface AgentRulesRead {
  max_per_request_ulxc: number
  hourly_limit_ulxc?: number
  daily_limit_ulxc: number
  weekly_limit_ulxc?: number
  monthly_limit_ulxc: number
  approval_above_ulxc: number
  model_daily_limits_ulxc?: Record<string, number>
  /** B28.26 — the requests the agent may make in any sixty seconds; zero is no cap. */
  requests_per_minute?: number
  allowed_models: string[] | null
  allowed_providers: string[] | null
  allowed_listings?: string[] | null
  /** B28.27 — who the agent may pay and who it may not, by payee id. */
  allowed_payees?: string[] | null
  blocked_payees?: string[] | null
  /** B28.28 — what the agent may pay one payee in a day, in µLXC, by the payee's id. */
  payee_daily_limits_ulxc?: Record<string, number> | null
  active_from: string
  active_until: string
  timezone: string
  pause_on_unusual_spend?: boolean
}

/** Lens economy.AgentPayment. `via` is "marketplace" for a payment to another company's agent (B19.15). */
export interface AgentPayment {
  entry_id: string
  amount_ulxc: number
  from_balance_ulxc: number
  to_balance_ulxc: number
  to_workspace_id?: string
  via?: string
}

/** Lens market.BillLine. */
export interface BillLine {
  use_id: string
  listing_id: string
  title: string
  agent_id?: string
  price_ulxc: number
  cleared_at?: string
  /** B25.4 — credited back: the listing was taken down */
  refunded_at?: string
  payee_agent_id?: string
}

/** Lens market.Bill: a buyer's billed uses in one month. */
export interface MarketBill {
  month: string
  total_ulxc: number
  refunded_ulxc?: number
  lines: BillLine[] | null
}

/** Lens market.Earnings, in µUSD. */
export interface MarketEarnings {
  pending_uses: number
  pending_usd_micros: number
  payable_usd_micros: number
  in_holdback_usd_micros: number
  available_usd_micros: number
  lifetime_gross_usd_micros: number
  /** B25.8 — paid out, in money or credits; reversed by refunds; and each cleared use's share */
  paid_out_usd_micros?: number
  refunded_usd_micros?: number
  /** B32.15 — and the sale it is a share of, and Talyvor's take of it: gross − share */
  earnings?: { use_id: string; share_usd_micros: number; payable_at: string; refunded_at?: string; gross_usd_micros?: number; fee_usd_micros?: number }[] | null
}

/** B32.15 — the plan Lens holds a workspace to, as GET …/plan answers it (B32.12). */
export interface WorkspacePlan {
  plan: string
  gated_as: string
  byok_add_on: boolean
  own_provider_keys_allowed: boolean
  agents_used: number
  /** B34.1 — what the plan unlocks: the agents it holds, -1 for unlimited (LENS_PLAN_GATES). B35.7 — and whether it offers Slack and Teams approvals. */
  gates: { agents: number; slack_teams_approvals?: boolean }
}

/** B35.7 — every fee Talyvor charges, as Lens's public read states it (GET /v1/public/fees): basis points, 100 = 1%. */
export interface Fees {
  /** Talyvor's take of a listing sale; the seller keeps the rest. */
  market_take_bps: number
  /** Talyvor's take of a payment to another company's agent, a service; the payee keeps the rest. */
  services_take_bps: number
  /** The platform fee on AI spend charged to credits, by plan. */
  platform_fee_bps: Record<string, number>
}

/** B32.15 — Lens's refusal of what a plan does not unlock (402): its sentence names LENS_PLAN_GATES and both plans. */
export interface PlanRefusal {
  error: string
  plan?: string
  gate?: string
  limit?: number
  allows?: string
}

/** B32.15 — one question through Lens's proxy, answered or refused, and whether Lens sent it on the workspace's own provider key. */
export interface Proxied {
  status: number
  /** X-Talyvor-BYOK: own-key */
  ownKey: boolean
  reply?: JudgeReply
  error?: string
}

/** B17.10 — one period of a plan, as Lens granted it (billing.Allowance). */
export interface PlanAllowance {
  granted_ulxc: number
  consumed_ulxc: number
  remaining_ulxc: number
  fee_usd_cents: number
}

/** B28.5 — one plan as Lens's public plans read states it: its price, and the µLXC it includes this month. */
export interface PricedPlan {
  id: string
  usd_cents: number
  included_ulxc: number
}

/** B26.17 — Lens's read of the workspace's plan: does it renew or end, and when (GET …/billing/subscription). */
export interface SubscriptionState {
  subscribed: boolean
  current_period_end?: string
  cancel_at_period_end: boolean
}

/** B17.10 — one row of the workspace's earnings ledger (GET /v1/workspaces/{id}/tokens/history), in µLENS. */
export interface EarningsRow {
  id: string
  amount_ulens: number
  type: string
  description: string
  created_at: string
}

/** Lens's sentence in a refusal body — {"error": "…"} or {"error": {"message": "…"}} — or the body itself. */
export function refusalOf(raw: string): string {
  try {
    const e = (JSON.parse(raw) as { error?: string | { message?: string } }).error
    if (typeof e === 'string') return e
    if (e?.message !== undefined) return e.message
  } catch {
    // not JSON: the body is the sentence
  }
  return raw.slice(0, 300)
}

/** An error as one line, with what fetch hides behind "fetch failed" (ECONNREFUSED, a DNS failure, …). */
export function describe(e: unknown): string {
  if (!(e instanceof Error)) return String(e)
  // A refused connection to a name with two addresses is an AggregateError with no message, only a code.
  const cause = e.cause instanceof Error ? e.cause.message || (e.cause as { code?: string }).code : undefined
  return cause === undefined || e.message.includes(cause) ? e.message : `${e.message} (${cause})`
}

const SYNTHETIC_KEY_HEADER = 'X-Talyvor-Synthetic-Key'
/** How long a reset whose answer was lost is waited for: Lens logged each one done 45–70s after it began. */
const RESET_RUNS_ON_MS = 90_000
/** B17.32 — how long a ledger read waits out a Lens that answers 502, 503 or 504, or not at all, while it restarts. */
const LEDGER_RESTART_MS = 60_000
/** B17.34 — how long a publish is sent again, under its Idempotency-Key, while Lens restarts. */
const PUBLISH_RESTART_MS = 60_000
/** B34.1 — how often a request Lens's rate limiter turned away is made again, and the longest it waits for each. */
const RATE_LIMIT_RETRIES = 3
const RATE_LIMIT_WAIT_MAX_S = 60

export class LensClient {
  readonly baseURL: string
  private readonly key: string
  private readonly sessionKeys: Map<string, Promise<string>>
  private readonly recorder: Recorder | undefined
  private readonly tag: Tag
  /** B25.4 — a moderator key (lens moderator-keys create): the review queue's approve and take down. */
  private readonly moderatorKey: string

  constructor(baseURL: string, syntheticKey: string, recorder?: Recorder, tag: Tag = { scenario: 'harness', user: -1 },
    sessionKeys = new Map<string, Promise<string>>(), moderatorKey = '') {
    this.baseURL = baseURL
    this.key = syntheticKey
    this.recorder = recorder
    this.tag = tag
    this.sessionKeys = sessionKeys
    this.moderatorKey = moderatorKey
  }

  /** B25.5 — the same client, its calls recorded as `tag`'s for the coverage map. */
  tagged(tag: Tag): LensClient {
    return new LensClient(this.baseURL, this.key, this.recorder, tag, this.sessionKeys, this.moderatorKey)
  }

  /**
   * Every request to Lens goes through here, so the coverage map sees each one with its time. B34.1 — Lens's rate
   * limiter (a workspace's requests a minute) answers 429 with Retry-After before any handler has run, so the request
   * is made again when it says; an agent rule's own 429 ("requests a minute") is an answer, and is returned.
   */
  private async send(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const t0 = Date.now()
    let status = 0
    try {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(this.baseURL + path, { ...init, method })
        status = res.status
        if (res.status !== 429 || attempt >= RATE_LIMIT_RETRIES || !(await res.clone().text()).includes('"limit_type"')) return res
        await res.body?.cancel()
        const wait = Math.min(Number(res.headers.get('Retry-After')) || 1, RATE_LIMIT_WAIT_MAX_S)
        await new Promise((r) => setTimeout(r, wait * 1000))
      }
    } finally {
      this.recorder?.hit(this.tag, { kind: 'lens', method, path: path.split('?')[0], status, ms: Date.now() - t0 })
    }
  }

  /**
   * B25.5 — one read of the Lens API as this user's key makes it, for the every-read scenario: its
   * status and how long it took, or status 0 when it did not answer within `timeoutMs`.
   */
  async read(user: SyntheticUser, path: string, timeoutMs: number): Promise<{ status: number; ms: number; body: string }> {
    const t0 = Date.now()
    try {
      const res = await this.send('GET', path, { headers: { ...this.bearer(user.token), Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
      return { status: res.status, ms: Date.now() - t0, body: (await res.text()).slice(0, 300) }
    } catch (e) {
      return { status: 0, ms: Date.now() - t0, body: e instanceof Error ? e.message : String(e) }
    }
  }

  /** B29.29 — the workspace's executive ROI report, as the HTML Lens renders it for this user's own token. */
  async roiReportHTML(user: SyntheticUser): Promise<Answered<string>> {
    const res = await this.send('GET', `/v1/workspaces/${user.workspaceID}/roi/report?format=html`,
      { headers: { ...this.bearer(user.token), Accept: 'text/html' } })
    const body = await res.text()
    return res.ok ? { ok: true, status: res.status, value: body } : { ok: false, status: res.status, error: body.slice(0, 300) }
  }

  /**
   * B26.18 — undefined while Lens answers at all (any status will do), else why it does not: asked three
   * times, two seconds apart, so one dropped connection does not end a run.
   */
  async unreachable(): Promise<string | undefined> {
    let why = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2_000))
      try {
        await (await fetch(this.baseURL + '/healthz', { signal: AbortSignal.timeout(10_000) })).body?.cancel()
        return undefined
      } catch (e) {
        why = describe(e)
      }
    }
    return why
  }

  /**
   * Clears the named synthetic workspaces' stored answers and restores their credits. B27.16 — only
   * these: a reset naming nobody resets every synthetic workspace, another run's users too.
   */
  async reset(workspaces: string[]): Promise<number | undefined> {
    if (workspaces.length === 0) return 0
    // B25.8 — with 1671 synthetic workspaces Lens resets for longer than a request may last (45s), and the
    // answer is lost though the reset runs on to the end (FOUND.md): then this waits it out, and answers
    // undefined.
    const res = await this.send('POST', '/v1/synthetic/workspaces/reset', {
      headers: { [SYNTHETIC_KEY_HEADER]: this.key, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaces }),
    }).catch(() => undefined)
    if (res === undefined || res.status === 502 || res.status === 504) {
      await new Promise((r) => setTimeout(r, RESET_RUNS_ON_MS))
      return undefined
    }
    const raw = await res.text()
    if (!res.ok) throw new Error(`POST /v1/synthetic/workspaces/reset: Lens answered ${res.status}: ${raw.slice(0, 200)}`)
    return Number((JSON.parse(raw) as { reset?: number }).reset ?? 0)
  }

  /** Creates `count` synthetic workspaces, each with test credits and a token; B35.7 — on `plan` when one is named. */
  async createUsers(count: number, plan?: Plan): Promise<SyntheticUser[]> {
    const body = (await this.call('POST', '/v1/synthetic/workspaces', { [SYNTHETIC_KEY_HEADER]: this.key },
      plan === undefined ? { count } : { count, plan })) as {
      plan?: string
      workspaces?: { workspace_id: string; token: string; expires_at: string }[]
    }
    const list = body.workspaces ?? []
    if (list.length !== count) throw new Error(`asked Lens for ${count} synthetic users, got ${list.length}`)
    if (plan !== undefined && body.plan !== plan) throw new Error(`asked Lens for ${count} synthetic users on ${plan}, and it made them on ${body.plan ?? 'no plan it names'}`)
    return list.map((w, index) => ({ index, workspaceID: w.workspace_id, token: w.token, expiresAt: w.expires_at, plan: plan ?? 'free' }))
  }

  async catalog(user: SyntheticUser): Promise<CatalogModel[]> {
    const body = await this.call('GET', '/v1/catalog/models', this.bearer(user.token))
    return Array.isArray(body) ? (body as CatalogModel[]) : []
  }

  /**
   * Dollars per LXC as Lens states it. When its economy routes are off, the fixed peg every charge is
   * debited at ($0.10, talyvor-lens economy.LXCUSDValue).
   */
  async usdPerLXC(): Promise<number> {
    try {
      const body = (await this.call('GET', '/v1/economy/conversion-rate', {})) as { usd_per_lxc?: number }
      if (typeof body.usd_per_lxc === 'number' && body.usd_per_lxc > 0) return body.usd_per_lxc
    } catch {
      // fall through to the peg
    }
    return 0.1
  }

  /**
   * The workspace's ledger, newest first — every row, however many pages. B17.32: a page Lens cannot answer
   * while it restarts is asked again, so a charged answer whose read-back meets a restart is still booked.
   */
  async ledger(user: SyntheticUser, restartMs = LEDGER_RESTART_MS): Promise<LedgerRow[]> {
    const rows: LedgerRow[] = []
    for (let offset = 0; ; offset += 200) {
      const page = (await this.callThroughRestart(`/v1/workspaces/${user.workspaceID}/lxc/history?limit=200&offset=${offset}`,
        this.bearer(user.token), restartMs)) as LedgerRow[] | null
      if (!Array.isArray(page) || page.length === 0) return rows
      rows.push(...page)
      if (page.length < 200) return rows
    }
  }

  /**
   * Asks the judge model, through Lens's proxy, on this user's account — so its cost lands on the
   * same ledger the harness reads back.
   */
  async judge(user: SyntheticUser, provider: string, model: string, prompt: string): Promise<JudgeReply> {
    return this.complete(user, provider, model, prompt, 5, 'judge')
  }

  /**
   * One question to a model through Lens's proxy on this user's account (the Messages API), answered
   * with the text and what Lens charged for it. The judge and the explorers (B17.5) both ask this way.
   */
  async complete(user: SyntheticUser, provider: string, model: string, prompt: string, maxTokens: number, who = 'model'): Promise<JudgeReply> {
    const key = await this.sessionKey(user)
    const res = await this.send('POST', `/v1/proxy/${provider}/v1/messages`, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`${who}: Lens answered ${res.status}: ${raw.slice(0, 200)}`)
    const body = JSON.parse(raw) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
    return {
      text: (body.content ?? []).map((c) => c.text ?? '').join(''),
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      replayed: res.headers.get('X-Talyvor-Cache-Replay') === 'true',
      pooledULXC: res.headers.has('X-Talyvor-Pool-Charged-ULXC') ? Number(res.headers.get('X-Talyvor-Pool-Charged-ULXC')) : undefined,
    }
  }

  /**
   * B17.6 — one question on an agent's own key, as the agent sends it: the reply, or Lens's refusal
   * (its status and sentence) — a refusal is what the bank scenarios look for, so it is not thrown.
   */
  async askAsAgent(key: string, provider: string, model: string, prompt: string, maxTokens: number): Promise<Answered<JudgeReply>> {
    const res = await this.send('POST', `/v1/proxy/${provider}/v1/messages`, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    })
    const raw = await res.text()
    if (!res.ok) return { ok: false, status: res.status, error: refusalOf(raw) }
    const body = JSON.parse(raw) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
    return {
      ok: true,
      status: res.status,
      value: {
        text: (body.content ?? []).map((c) => c.text ?? '').join(''),
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        replayed: res.headers.get('X-Talyvor-Cache-Replay') === 'true',
        pooledULXC: res.headers.has('X-Talyvor-Pool-Charged-ULXC') ? Number(res.headers.get('X-Talyvor-Pool-Charged-ULXC')) : undefined,
      },
    }
  }

  /** B30.115 — every wallet capability, its class and whether it takes real money now (Lens B22.1, B30.1). */
  async walletCapabilities(user: SyntheticUser): Promise<CapabilityStatus[]> {
    const body = (await this.call('GET', '/v1/wallets/capabilities', this.bearer(user.token))) as { capabilities?: CapabilityStatus[] | null }
    return body.capabilities ?? []
  }

  /** B17.6 — the workspace's agents and their balances, reconciled with the workspace (Lens B19.1). */
  async agentBook(user: SyntheticUser): Promise<AgentBook> {
    return (await this.call('GET', `/v1/workspaces/${user.workspaceID}/agents`, this.bearer(user.token))) as AgentBook
  }

  /** B17.6 — creates an agent as the workspace's owner: another company's agent, for a payment to reach. */
  async createAgent(user: SyntheticUser, name: string): Promise<{ id: string; name: string }> {
    return (await this.call('POST', `/v1/workspaces/${user.workspaceID}/agents`, this.bearer(user.token), { name })) as { id: string; name: string }
  }

  /** B17.6 — the agents' approvals, newest first. */
  async agentApprovals(user: SyntheticUser): Promise<AgentApproval[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/agents/approvals`, this.bearer(user.token))) as { approvals?: AgentApproval[] | null }
    return body.approvals ?? []
  }

  /**
   * B28.8 — one agent's rules as Lens stored them: its limits and its approval amount, in µLXC; B28.22 — and
   * its models; B28.25 — and each model's daily cap; B28.305 — and every other rule.
   */
  async agentRules(user: SyntheticUser, agentID: string): Promise<AgentRulesRead> {
    return (await this.call('GET', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/rules`, this.bearer(user.token))) as AgentRulesRead
  }

  /** B28.31 — every version of one agent's rules, newest first (Lens B28.307): the rules each change left, by whom and how. */
  async agentRulesHistory(user: SyntheticUser, agentID: string): Promise<AgentRulesVersion[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/rules/history`, this.bearer(user.token))) as { versions?: AgentRulesVersion[] | null }
    return body.versions ?? []
  }

  /** B28.32 — one agent's limits raised for now, the soonest to end first (Lens B28.308); a boost past its time is not listed. */
  async agentBoosts(user: SyntheticUser, agentID: string): Promise<AgentRuleBoost[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/rules/boosts`, this.bearer(user.token))) as { boosts?: AgentRuleBoost[] | null }
    return body.boosts ?? []
  }

  /** B28.357 — the workspace's month-end forecast as of now, every agent in it (Lens B19.6). */
  async agentForecast(user: SyntheticUser): Promise<SpendForecastRead> {
    return (await this.call('GET', `/v1/workspaces/${user.workspaceID}/agents/forecast`, this.bearer(user.token))) as SpendForecastRead
  }

  /** B17.6 — one agent's account, newest first (Lens B19.3). */
  async agentLines(user: SyntheticUser, agentID: string): Promise<AgentLine[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/statement`, this.bearer(user.token))) as { lines?: AgentLine[] | null }
    return body.lines ?? []
  }

  /** B28.359 — the workspace's API keys, agents' keys among them (a revoked key is gone from the list). */
  async apiKeys(user: SyntheticUser): Promise<{ id: string; name: string }[]> {
    return ((await this.call('GET', `/v1/workspaces/${user.workspaceID}/api-keys`, this.bearer(user.token))) as { id: string; name: string }[] | null) ?? []
  }

  /** B17.6 — an agent pays another agent with its own key; Lens's answer or its refusal. */
  async payAsAgent(key: string, workspaceID: string, fromAgentID: string, toAgentID: string, amountULXC: number, memo: string): Promise<Answered<AgentPayment>> {
    const res = await this.send('POST', `/v1/workspaces/${workspaceID}/agents/${fromAgentID}/pay`, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to_agent_id: toAgentID, amount_ulxc: amountULXC, memo }),
    })
    const raw = await res.text()
    return res.ok ? { ok: true, status: res.status, value: JSON.parse(raw) as AgentPayment } : { ok: false, status: res.status, error: refusalOf(raw) }
  }

  /** B17.6 — the buyer's marketplace bill for this month (Lens B20.2). */
  async marketBill(user: SyntheticUser): Promise<MarketBill> {
    return (await this.call('GET', `/v1/workspaces/${user.workspaceID}/marketplace/bill`, this.bearer(user.token))) as MarketBill
  }

  /** B17.6 — the seller's earnings: pending, payable, in holdback, available (µUSD). */
  async marketEarnings(user: SyntheticUser): Promise<MarketEarnings> {
    return (await this.call('GET', `/v1/workspaces/${user.workspaceID}/marketplace/earnings`, this.bearer(user.token))) as MarketEarnings
  }

  /** B28.104 — the workspace's prepaid balance, as Lens's GET …/lxc/balance states it. */
  async lxcBalance(user: SyntheticUser): Promise<number> {
    return ((await this.call('GET', `/v1/workspaces/${user.workspaceID}/lxc/balance`, this.bearer(user.token))) as { balance_ulxc: number }).balance_ulxc
  }

  /**
   * B17.10 — the plan's allowance this period: null when the workspace has no plan, or Lens's refusal
   * (404: Lens sells this workspace no plan).
   */
  async allowance(user: SyntheticUser): Promise<Answered<PlanAllowance | null>> {
    const res = await this.send('GET', `/v1/workspaces/${user.workspaceID}/billing/allowance`,
      { headers: { ...this.bearer(user.token), Accept: 'application/json' } })
    const raw = await res.text()
    return res.ok
      ? { ok: true, status: res.status, value: (JSON.parse(raw) as { allowance: PlanAllowance | null }).allowance }
      : { ok: false, status: res.status, error: refusalOf(raw) }
  }

  /**
   * B28.5 — each plan's price and the usage it includes this month, from Lens's public GET /v1/billing/plans
   * (talyvor-lens B28.439), read with no credential as a visitor reads it. Null where Lens sells no plan (404).
   */
  async plans(): Promise<PricedPlan[] | null> {
    const res = await this.send('GET', '/v1/billing/plans', { headers: { Accept: 'application/json' } })
    if (res.status === 404) {
      await res.body?.cancel()
      return null
    }
    return ((await this.parse('GET', '/v1/billing/plans', res)) as { plans: PricedPlan[] }).plans
  }

  /** B17.10 — asks Lens itself to start a plan's checkout, for the sentence it refuses with. Nothing is charged. */
  async startSubscription(user: SyntheticUser, plan: string): Promise<Answered<{ url?: string }>> {
    const res = await this.send('POST', `/v1/workspaces/${user.workspaceID}/billing/subscribe`, {
      headers: { ...this.bearer(user.token), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ plan }),
    })
    const raw = await res.text()
    return res.ok ? { ok: true, status: res.status, value: JSON.parse(raw) as { url?: string } } : { ok: false, status: res.status, error: refusalOf(raw) }
  }

  /** B26.17 — whether the workspace's plan renews or ends at the end of its period, and when. */
  async subscription(user: SyntheticUser): Promise<Answered<SubscriptionState>> {
    const res = await this.send('GET', `/v1/workspaces/${user.workspaceID}/billing/subscription`,
      { headers: { ...this.bearer(user.token), Accept: 'application/json' } })
    const raw = await res.text()
    return res.ok ? { ok: true, status: res.status, value: JSON.parse(raw) as SubscriptionState } : { ok: false, status: res.status, error: refusalOf(raw) }
  }

  /** B17.10 — cancels the workspace's plan at the end of its period. */
  async cancelSubscription(user: SyntheticUser): Promise<Answered<unknown>> {
    const res = await this.send('POST', `/v1/workspaces/${user.workspaceID}/billing/subscription/cancel`,
      { headers: { ...this.bearer(user.token), Accept: 'application/json' } })
    const raw = await res.text()
    return res.ok ? { ok: true, status: res.status, value: null } : { ok: false, status: res.status, error: refusalOf(raw) }
  }

  // ─── B32.15: the approved prices, as Lens charges and gates them ───

  /** The company plans' prices as Lens's public plans read states them (talyvor-lens B32.77), in cents a month. */
  async companyPlans(): Promise<{ id: string; usd_cents: number }[]> {
    const body = (await this.call('GET', '/v1/billing/plans', {})) as { company_plans?: { id: string; usd_cents: number }[] | null }
    return body.company_plans ?? []
  }

  /** B35.7 — every fee Talyvor charges, as Lens's public read states it, read with no credential. */
  async fees(): Promise<Fees> {
    return (await this.call('GET', '/v1/public/fees', {})) as Fees
  }

  /** The plan Lens holds the workspace to, its gates, and the agents it has now. */
  async workspacePlan(user: SyntheticUser): Promise<WorkspacePlan> {
    return (await this.call('GET', `/v1/workspaces/${user.workspaceID}/plan`, this.bearer(user.token))) as WorkspacePlan
  }

  /** B34.1 — retires an agent as the workspace's owner: its balance swept back to the workspace, its keys revoked. */
  async archiveAgent(user: SyntheticUser, agentID: string): Promise<Answered<unknown>> {
    const res = await this.send('POST', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/archive`,
      { headers: { ...this.bearer(user.token), Accept: 'application/json' } })
    const raw = await res.text()
    return res.ok ? { ok: true, status: res.status, value: null } : { ok: false, status: res.status, error: refusalOf(raw) }
  }

  /** Creates an agent as the workspace's owner: the agent, or Lens's refusal as it wrote it. */
  async tryCreateAgent(user: SyntheticUser, name: string): Promise<{ status: number; agent?: { id: string; name: string }; refusal?: PlanRefusal }> {
    const res = await this.send('POST', `/v1/workspaces/${user.workspaceID}/agents`, {
      headers: { ...this.bearer(user.token), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name }),
    })
    const raw = await res.text()
    if (res.ok) return { status: res.status, agent: JSON.parse(raw) as { id: string; name: string } }
    let refusal: PlanRefusal
    try {
      refusal = JSON.parse(raw) as PlanRefusal
    } catch {
      refusal = { error: refusalOf(raw) }
    }
    return { status: res.status, refusal: { ...refusal, error: refusalOf(raw) } }
  }

  /** Saves the workspace's own key for a provider (B27.26); 404 where Lens holds no provider keys at all. */
  async putProviderKey(user: SyntheticUser, provider: string, key: string): Promise<Answered<{ provider: string; last4: string }>> {
    const res = await this.send('PUT', `/v1/workspaces/${user.workspaceID}/provider-keys/${provider}`, {
      headers: { ...this.bearer(user.token), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key }),
    })
    const raw = await res.text()
    return res.ok ? { ok: true, status: res.status, value: JSON.parse(raw) as { provider: string; last4: string } } : { ok: false, status: res.status, error: refusalOf(raw) }
  }

  async deleteProviderKey(user: SyntheticUser, provider: string): Promise<Answered<null>> {
    const res = await this.send('DELETE', `/v1/workspaces/${user.workspaceID}/provider-keys/${provider}`, { headers: this.bearer(user.token) })
    const raw = await res.text()
    return res.ok ? { ok: true, status: res.status, value: null } : { ok: false, status: res.status, error: refusalOf(raw) }
  }

  /** One question through Lens's proxy on this user's account, as complete() asks it — refused or answered, never thrown. */
  async ask(user: SyntheticUser, provider: string, model: string, prompt: string, maxTokens: number): Promise<Proxied> {
    const key = await this.sessionKey(user)
    const res = await this.send('POST', `/v1/proxy/${provider}/v1/messages`, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    })
    const raw = await res.text()
    const ownKey = res.headers.get('X-Talyvor-BYOK') === 'own-key'
    if (!res.ok) return { status: res.status, ownKey, error: refusalOf(raw) }
    const body = JSON.parse(raw) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
    return {
      status: res.status,
      ownKey,
      reply: {
        text: (body.content ?? []).map((c) => c.text ?? '').join(''),
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        replayed: res.headers.get('X-Talyvor-Cache-Replay') === 'true',
        pooledULXC: res.headers.has('X-Talyvor-Pool-Charged-ULXC') ? Number(res.headers.get('X-Talyvor-Pool-Charged-ULXC')) : undefined,
      },
    }
  }

  /** B17.10 — the workspace's earnings ledger, newest first — every row, however many pages. */
  async earningsRows(user: SyntheticUser): Promise<EarningsRow[]> {
    const rows: EarningsRow[] = []
    for (let offset = 0; ; offset += 200) {
      const page = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/tokens/history?limit=200&offset=${offset}`,
        this.bearer(user.token))) as EarningsRow[] | null
      if (!Array.isArray(page) || page.length === 0) return rows
      rows.push(...page)
      if (page.length < 200) return rows
    }
  }

  // ─── B25.4: the wallet and the marketplace, as each test user's own token reads and moves them ───

  /** Funds an agent from its workspace, as the workspace's owner. */
  async fundAgent(user: SyntheticUser, agentID: string, amountULXC: number): Promise<void> {
    await this.call('POST', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/fund`, this.bearer(user.token), { amount_ulxc: amountULXC })
  }

  /** What one agent sent and received, newest first. */
  async transfers(user: SyntheticUser, agentID: string): Promise<AgentTransfer[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/transfers`, this.bearer(user.token))) as { transfers?: AgentTransfer[] | null }
    return body.transfers ?? []
  }

  /** The workspace's agent `agentID` sends credits to the agent at wallet `to`, as the workspace's owner. */
  async sendCredits(user: SyntheticUser, agentID: string, to: string, amountULXC: number, memo: string): Promise<Answered<AgentTransfer>> {
    return this.answer('POST', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/send`, user.token, { to, amount_ulxc: amountULXC, memo })
  }

  /** Gives back a transfer the workspace's agent received. */
  async refundTransfer(user: SyntheticUser, transferID: string): Promise<Answered<AgentTransfer>> {
    return this.answer('POST', `/v1/workspaces/${user.workspaceID}/transfers/${transferID}/refund`, user.token)
  }

  /** The workspace's agent `agentID` asks the agent at wallet `from` for credits. */
  async requestMoney(user: SyntheticUser, agentID: string, from: string, amountULXC: number, memo: string): Promise<Answered<MoneyRequest>> {
    return this.answer('POST', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/requests`, user.token, { from, amount_ulxc: amountULXC, memo })
  }

  /** Every request the workspace's agents made and were made. */
  async moneyRequests(user: SyntheticUser): Promise<MoneyRequest[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/money-requests`, this.bearer(user.token))) as { requests?: MoneyRequest[] | null }
    return body.requests ?? []
  }

  /** Every loan the workspace lends and borrows. */
  async loans(user: SyntheticUser): Promise<Loan[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/loans`, this.bearer(user.token))) as { loans?: Loan[] | null }
    return body.loans ?? []
  }

  /** The borrower accepts (or declines) a loan offered to its agent. */
  async answerLoan(user: SyntheticUser, loanID: string, accept: boolean): Promise<Answered<Loan>> {
    return this.answer('POST', `/v1/workspaces/${user.workspaceID}/loans/${loanID}/${accept ? 'accept' : 'decline'}`, user.token)
  }

  /** Every escrow the workspace's agents paid into or are owed from. */
  async escrows(user: SyntheticUser): Promise<Escrow[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/escrows`, this.bearer(user.token))) as { escrows?: Escrow[] | null }
    return body.escrows ?? []
  }

  async pots(user: SyntheticUser, agentID: string): Promise<Pot[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/pots`, this.bearer(user.token))) as { pots?: Pot[] | null }
    return body.pots ?? []
  }

  async schedules(user: SyntheticUser): Promise<AgentSchedule[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/agents/schedules`, this.bearer(user.token))) as { schedules?: AgentSchedule[] | null }
    return body.schedules ?? []
  }

  async scheduleRuns(user: SyntheticUser, scheduleID: string): Promise<ScheduleRun[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/agents/schedules/${scheduleID}/runs`, this.bearer(user.token))) as { runs?: ScheduleRun[] | null }
    return body.runs ?? []
  }

  /** Stops a schedule, so a test user's recurring transfer does not outlive its run. */
  async stopSchedule(user: SyntheticUser, scheduleID: string): Promise<Answered<unknown>> {
    return this.answer('DELETE', `/v1/workspaces/${user.workspaceID}/agents/schedules/${scheduleID}`, user.token)
  }

  async cashOuts(user: SyntheticUser): Promise<CashOut[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/cash-outs`, this.bearer(user.token))) as { cash_outs?: CashOut[] | null }
    return body.cash_outs ?? []
  }

  /** The agent's card, or null when it has none (Lens answers 404). */
  async agentCard(user: SyntheticUser, agentID: string): Promise<AgentCard | null> {
    return (await this.cardAndPurchases(user, agentID))?.card ?? null
  }

  /** B25.8 — the agent's card and every purchase on it, or null when it has none. */
  async cardAndPurchases(user: SyntheticUser, agentID: string): Promise<{ card: AgentCard; authorizations: CardAuthorization[] | null } | null> {
    const r = await this.answer<{ card: AgentCard; authorizations: CardAuthorization[] | null }>('GET', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/card`, user.token)
    if (!r.ok && r.status === 404) return null
    if (!r.ok) throw new Error(`GET the card of ${agentID}: Lens answered ${r.status}: ${r.error}`)
    return r.value
  }

  /**
   * B25.8 — the workspace publishes a public prompt listing with its own token, as another company's software would.
   * B17.34 — sent again through a restart under one Idempotency-Key, so Lens publishes it once.
   */
  async publishListing(user: SyntheticUser, l: { title: string; template: string; priceULXC: number; model: string },
    restartMs = PUBLISH_RESTART_MS): Promise<Answered<Listing>> {
    return this.answerThroughRestart('POST', `/v1/workspaces/${user.workspaceID}/marketplace/listings`, user.token, { kind: 'prompt', title: l.title, description: '',
      price_per_use_ulxc: l.priceULXC, visibility: 'public', artifact: { template: l.template, model: l.model }, changelog: '' }, restartMs)
  }

  /**
   * B34.4 — any route as `user`'s own token makes it, `{ws}` its workspace: Lens's answer, or its status and sentence. For
   * the routes no other method here names, so a scenario reaches each one with the same client the coverage map watches.
   */
  async act<T>(user: SyntheticUser, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answered<T>> {
    return this.answer(method, path.replace('{ws}', user.workspaceID), user.token, body, headers)
  }

  /**
   * B34.6 — one request as a customer's software makes it, on `credential` (a key or a token; '' for none): Lens's
   * status, headers and body, never thrown. The gateway's routes are judged on all three.
   */
  async as(credential: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; headers: Headers; text: string }> {
    const res = await this.send(method, path, {
      headers: {
        Accept: 'application/json',
        ...(credential === '' ? {} : this.bearer(credential)),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, headers: res.headers, text: await res.text() }
  }

  /** B34.7 — `body` sent as it is, as `contentType` (a document Lens converts), on `credential`: status and body, never thrown. */
  async raw(credential: string, method: string, path: string, body: string, contentType: string): Promise<{ status: number; text: string }> {
    const res = await this.send(method, path, { headers: { Accept: 'application/json', ...this.bearer(credential), 'Content-Type': contentType }, body })
    return { status: res.status, text: await res.text() }
  }

  /**
   * B34.6 — the first event a server-sent stream sends, on `credential`, within `ms`; the stream is closed after it. Status
   * 0 when not even its headers came in time, and no event when they did and nothing followed; an answer that is no
   * stream is its body.
   */
  async firstEvent(credential: string, path: string, ms: number): Promise<{ status: number; event: string }> {
    const stop = new AbortController()
    const timer = setTimeout(() => stop.abort(), ms)
    let status = 0
    try {
      const res = await this.send('GET', path, { headers: { Accept: 'text/event-stream', ...(credential === '' ? {} : this.bearer(credential)) }, signal: stop.signal })
      status = res.status
      if (res.status !== 200 || res.body === null) return { status: res.status, event: (await res.text()).slice(0, 300) }
      const reader = res.body.getReader()
      let text = ''
      while (!text.includes('\n\n')) {
        const chunk = await reader.read()
        if (chunk.done) break
        text += new TextDecoder().decode(chunk.value)
      }
      return { status: res.status, event: text.split('\n\n')[0] }
    } catch (e) {
      return { status, event: status === 0 ? describe(e) : '' }
    } finally {
      clearTimeout(timer)
      stop.abort()
    }
  }

  /** B25.8 — takes LXC back from an agent into its workspace, as the workspace's owner. */
  async withdrawAgent(user: SyntheticUser, agentID: string, amountULXC: number): Promise<void> {
    await this.call('POST', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/withdraw`, this.bearer(user.token), { amount_ulxc: amountULXC })
  }

  // ─── B25.8: a test user's slow money brought due now (Lens B25.7), with the synthetic key ───

  /** A test loan the workspace lends or borrows: its next instalment due now, for the minute tick to take or miss. */
  async bringLoanDue(user: SyntheticUser, loanID: string): Promise<Answered<Loan>> {
    return this.synthetic('POST', `/v1/synthetic/workspaces/${user.workspaceID}/loans/${loanID}/due`)
  }

  /** The test buyer's metered, unpaid marketplace uses paid on one bill, their sellers' earnings past the holdback. */
  async payTestBill(user: SyntheticUser): Promise<Answered<PaidTestBill>> {
    return this.synthetic('POST', `/v1/synthetic/workspaces/${user.workspaceID}/marketplace/bill/pay`)
  }

  /** That paid bill refunded, as Stripe's charge.refunded refunds it. */
  async refundTestBill(user: SyntheticUser, invoiceID: string): Promise<Answered<{ uses_refunded: number }>> {
    return this.synthetic('POST', `/v1/synthetic/workspaces/${user.workspaceID}/marketplace/bill/${invoiceID}/refund`)
  }

  /** A purchase on the test agent's card, decided as Stripe Issuing's authorisation request is. */
  async cardPurchase(user: SyntheticUser, agentID: string, p: { amount_minor: number; currency: string; merchant: string }): Promise<Answered<CardPurchase>> {
    return this.synthetic('POST', `/v1/synthetic/workspaces/${user.workspaceID}/agents/${agentID}/card/authorizations`, p)
  }

  private async synthetic<T>(method: string, path: string, body?: unknown): Promise<Answered<T>> {
    const res = await this.send(method, path, {
      headers: { [SYNTHETIC_KEY_HEADER]: this.key, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const raw = await res.text()
    return res.ok ? { ok: true, status: res.status, value: (raw === '' ? null : JSON.parse(raw)) as T } : { ok: false, status: res.status, error: refusalOf(raw) }
  }

  /** The workspace's own listings, whatever their review. */
  async ownListings(user: SyntheticUser): Promise<Listing[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/marketplace/listings`, this.bearer(user.token))) as { listings?: Listing[] | null } | null
    return body?.listings ?? []
  }

  /** The public catalog, as this user browses it. */
  async catalogListings(user: SyntheticUser): Promise<Listing[]> {
    const body = (await this.call('GET', '/v1/marketplace/listings', this.bearer(user.token))) as { listings?: Listing[] | null } | null
    return body?.listings ?? []
  }

  /** One listing as this user sees it; a refusal when they may not. */
  async listing(user: SyntheticUser, id: string): Promise<Answered<Listing>> {
    return this.answer('GET', `/v1/marketplace/listings/${id}`, user.token)
  }

  async payouts(user: SyntheticUser): Promise<Payouts> {
    return (await this.call('GET', `/v1/workspaces/${user.workspaceID}/marketplace/payouts`, this.bearer(user.token))) as Payouts
  }

  get canModerate(): boolean {
    return this.moderatorKey !== ''
  }

  /** The moderators' queue: every held or reported listing. */
  async reviewQueue(): Promise<QueueItem[]> {
    const body = (await this.call('GET', '/v1/admin/marketplace/review', this.moderator())) as { listings?: QueueItem[] | null } | null
    return body?.listings ?? []
  }

  /** A moderator approves a held listing, or takes one down for `reason`. */
  async moderate(listingID: string, action: 'approve' | 'takedown', reason = ''): Promise<Answered<unknown>> {
    const res = await this.send('POST', `/v1/admin/marketplace/listings/${listingID}/${action}`, {
      headers: { ...this.moderator(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(action === 'takedown' ? { reason } : {}),
    })
    const raw = await res.text()
    return res.ok ? { ok: true, status: res.status, value: raw === '' ? null : JSON.parse(raw) } : { ok: false, status: res.status, error: refusalOf(raw) }
  }

  /** A moderator key must name the person it acts for; every use is recorded under that name. */
  private moderator(): Record<string, string> {
    return { Authorization: `Bearer ${this.moderatorKey}`, 'X-Talyvor-Operator': 'e2e-testers' }
  }

  /** A write a scenario reads the refusal of: Lens's answer, or its status and sentence. */
  private async answer<T>(method: string, path: string, token: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answered<T>> {
    const res = await this.send(method, path, {
      headers: { ...this.bearer(token), Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const raw = await res.text()
    return res.ok ? { ok: true, status: res.status, value: (raw === '' ? null : JSON.parse(raw)) as T } : { ok: false, status: res.status, error: refusalOf(raw) }
  }

  /**
   * B17.34 — `answer` for a write Lens takes an Idempotency-Key on: sent again with the same key, a second
   * apart, while Lens answers 502, 503 or 504 or not at all — for up to `restartMs`.
   */
  private async answerThroughRestart<T>(method: string, path: string, token: string, body: unknown, restartMs: number): Promise<Answered<T>> {
    const headers = { ...this.bearer(token), 'Idempotency-Key': randomUUID(), Accept: 'application/json', 'Content-Type': 'application/json' }
    const deadline = Date.now() + restartMs
    for (;;) {
      const res = await this.send(method, path, { headers, body: JSON.stringify(body) }).catch((e: unknown) => e)
      const restarting = !(res instanceof Response) || [502, 503, 504].includes(res.status)
      if (!restarting || Date.now() >= deadline) {
        if (!(res instanceof Response)) throw res
        const raw = await res.text()
        return res.ok ? { ok: true, status: res.status, value: (raw === '' ? null : JSON.parse(raw)) as T } : { ok: false, status: res.status, error: refusalOf(raw) }
      }
      if (res instanceof Response) await res.body?.cancel()
      await new Promise((r) => setTimeout(r, 1_000))
    }
  }

  private sessionKey(user: SyntheticUser): Promise<string> {
    let key = this.sessionKeys.get(user.workspaceID)
    if (key === undefined) {
      key = this.call('POST', '/v1/auth/session-keys', this.bearer(user.token), {}).then((b) => {
        const k = (b as { key?: string }).key
        if (k === undefined || k === '') throw new Error('Lens minted no session key')
        return k
      })
      this.sessionKeys.set(user.workspaceID, key)
    }
    return key
  }

  private bearer(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` }
  }

  private async call(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<unknown> {
    const res = await this.send(method, path, {
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return this.parse(method, path, res)
  }

  private async parse(method: string, path: string, res: Response): Promise<unknown> {
    const raw = await res.text()
    if (!res.ok) throw new Error(`${method} ${path}: Lens answered ${res.status}: ${raw.slice(0, 200)}`)
    return raw === '' ? null : JSON.parse(raw)
  }

  /** A GET asked again, a second apart, while Lens answers 502, 503 or 504 or not at all — for up to `restartMs`. */
  private async callThroughRestart(path: string, headers: Record<string, string>, restartMs: number): Promise<unknown> {
    const deadline = Date.now() + restartMs
    for (;;) {
      const res = await this.send('GET', path, { headers: { Accept: 'application/json', ...headers } }).catch((e: unknown) => e)
      const restarting = !(res instanceof Response) || [502, 503, 504].includes(res.status)
      if (!restarting || Date.now() >= deadline) {
        if (!(res instanceof Response)) throw res
        return this.parse('GET', path, res)
      }
      if (res instanceof Response) await res.body?.cancel()
      await new Promise((r) => setTimeout(r, 1_000))
    }
  }
}
