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

/** Lens economy.AgentApproval. `model` is empty for a payment to another agent. */
export interface AgentApproval {
  id: string
  agent_id: string
  amount_ulxc: number
  model: string
  /** Why the agent asked (B19.9), when it asked through its own tools. */
  reason?: string
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

async function send<T>(method: string, path: string, body: object = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
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
  book: () => getJSON<AgentBook>('/api/agents'),
  create: (name: string) => send<Agent>('POST', '/api/agents', { name }),
  fund: (id: string, amount_ulxc: number) =>
    send<{ balance_ulxc: number }>('POST', `/api/agents/${e(id)}/fund`, { amount_ulxc }),
  withdraw: (id: string, amount_ulxc: number) =>
    send<{ balance_ulxc: number }>('POST', `/api/agents/${e(id)}/withdraw`, { amount_ulxc }),
  issueKey: (id: string, name: string) => send<AgentKey>('POST', `/api/agents/${e(id)}/keys`, { name }),
  rules: (id: string) => getJSON<AgentRules>(`/api/agents/${e(id)}/rules`),
  setRules: (id: string, rules: AgentRules) => send<AgentRules>('PUT', `/api/agents/${e(id)}/rules`, rules),
  statement: (id: string) => getJSON<{ lines: StatementLine[] | null }>(`/api/agents/${e(id)}/statement`),
  statementFile,
  /** B19.24 — the agent's test-mode card and every purchase on it; null when it has none (Lens answers 404). */
  card: async (id: string): Promise<{ card: AgentCard; authorizations: CardAuthorization[] | null } | null> => {
    try {
      return await getJSON<{ card: AgentCard; authorizations: CardAuthorization[] | null }>(`/api/agents/${e(id)}/card`)
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
  approvals: () => getJSON<{ approvals: AgentApproval[] | null }>('/api/agents/approvals'),
  // B19.21 — scheduled payments and automatic top-ups.
  schedules: () => getJSON<{ schedules: AgentSchedule[] | null }>('/api/agents/schedules'),
  schedule: (id: string, body: { to_agent_id: string; to_listing_id: string; amount_ulxc: number; memo: string; every: AgentSchedule['every'] }) =>
    send<AgentSchedule>('POST', `/api/agents/${e(id)}/schedules`, body),
  scheduleRuns: (sid: string) => getJSON<{ runs: AgentScheduleRun[] | null }>(`/api/agents/schedules/${e(sid)}/runs`),
  stopSchedule: (sid: string) => send<{ active: boolean }>('POST', `/api/agents/schedules/${e(sid)}/stop`),
  /** Null when the agent has none (Lens answers 404). */
  topUp: async (id: string): Promise<AgentTopUp | null> => {
    try {
      return await getJSON<AgentTopUp>(`/api/agents/${e(id)}/topup`)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  },
  setTopUp: (id: string, below_ulxc: number, to_ulxc: number) =>
    send<AgentTopUp>('PUT', `/api/agents/${e(id)}/topup`, { below_ulxc, to_ulxc }),
  removeTopUp: (id: string) => send<unknown>('DELETE', `/api/agents/${e(id)}/topup`),
  // B19.20 — stop every agent or one, and what they are spending.
  alerts: () => getJSON<{ alerts: AgentSpendAlert[] | null; rule: string }>('/api/agents/alerts'),
  forecast: () => getJSON<SpendForecast>('/api/agents/forecast'),
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
  passkeys: () => getJSON<{ passkeys: Passkey[] | null }>('/api/agents/passkeys'),
  passkeyChallenge: () => send<{ challenge: string; rp_id: string }>('POST', '/api/agents/passkeys/challenge'),
  registerPasskey: (body: PasskeyRegistration) => send<Passkey>('POST', '/api/agents/passkeys', body),
  approvalChallenge: (approvalID: string) =>
    send<{ challenge: string; allow_credentials: string[] | null }>('POST', `/api/agents/approvals/${e(approvalID)}/challenge`),
  pushPublicKey: () => getJSON<{ public_key: string }>('/api/agents/push/public-key'),
  subscribePush: (sub: PushSubscriptionBody) => send<{ endpoint: string }>('POST', '/api/agents/push/subscriptions', sub),
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
