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
  /** B28.21 — what the agent is for, in its owner's words. */
  description?: string
  /** B28.21 — set once it is archived: swept to zero, its keys revoked, refused every movement of its own. */
  archived_at?: string
}

/** Lens economy.AgentArchive (B28.21): what archiving an agent did. */
export interface AgentArchive {
  agent_id: string
  /** its whole balance, moved back to the workspace in one withdraw entry */
  swept_ulxc: number
  revoked_keys: string[]
  archived_at: string
}

/**
 * B28.30 — a request to judge without making it (Lens economy.SimulatedRequest, B28.306). With a payee it is a
 * payment to that payee; without one a question to the model through the provider.
 */
export interface SimulatedRequest {
  amount_ulxc: number
  model?: string
  provider?: string
  payee?: { kind: 'agent' | 'listing' | 'company' | 'merchant'; id: string }
}

/** Lens economy.RuleSimulation (B28.306): what the agent's rules would say to it. Nothing was spent or posted. */
export interface RuleSimulation {
  verdict: 'allowed' | 'refused' | 'approval_required'
  /** why, when it is not allowed: the rule's own sentence */
  reason: string
  amount_ulxc: number
  at: string
  /** what the agent holds now; the rules do not judge it, but a request beyond it is still refused */
  balance_ulxc: number
}

/** Lens economy.AgentRulesVersion (B28.307): the agent's rules as one change left them, who changed them and how. */
export interface AgentRulesVersion {
  version: number
  rules: AgentRules
  /** the credential that changed them: "operator", or its method, user and key ("jwt:user:…"); empty when unknown */
  changed_by: string
  /** set | template <id> | rollback to <n> | before history (rules set before versions were kept) */
  change: string
  created_at: string
}

/** Lens economy.AgentRuleBoost (B28.308): one of the agent's limits raised until a time, after which it is the rules' again. */
export interface AgentRuleBoost {
  /** the limit, as AgentRules names it: daily_limit_ulxc, requests_per_minute, … */
  rule: string
  /** the limit as the rules set it when the boost was set; once the rules change it, the boost no longer applies */
  raised_from: number
  /** what it is raised to: µLXC, or requests a minute */
  value: number
  until: string
  /** the credential that set it, as a rules version names it; empty when unknown */
  created_by: string
  created_at: string
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
  agents:
    | {
        agent_id: string
        name: string
        spent_ulxc: number
        forecast_ulxc: number
        /** B28.94 — what the agent holds now. */
        balance_ulxc?: number
        /**
         * B28.94 — when its balance runs out at its pace so far this month, an RFC 3339 time written in the agent's own
         * time zone, so its date is the agent's date; null when it does not run out at that pace.
         */
        runs_out_at?: string | null
      }[]
    | null
}

/** Lens economy.AgentRules. A zero limit and an empty list are "no rule". */
export interface AgentRules {
  max_per_request_ulxc: number
  /** B28.24 — spend in the clock hour; Lens always reads it, and a save without it keeps the cap. */
  hourly_limit_ulxc?: number
  daily_limit_ulxc: number
  /** B28.24 — spend in the week from Monday; Lens always reads it, and a save without it keeps the cap. */
  weekly_limit_ulxc?: number
  monthly_limit_ulxc: number
  /**
   * B28.25 — what the agent may spend on one model in a day, by the model's name; Lens reads it back
   * lower-cased and without a dated suffix. Saved, it replaces the caps whole; a save without it keeps them.
   */
  model_daily_limits_ulxc?: Record<string, number>
  /**
   * B28.26 — the requests the agent may make in any sixty seconds; the one past it is refused 429 and holds
   * nothing. Lens always reads it, zero is no cap, and a save without it keeps the cap.
   */
  requests_per_minute?: number
  approval_above_ulxc: number
  allowed_models: string[] | null
  allowed_providers: string[] | null
  /** B19.14 — the marketplace listings it may use; empty or null allows any. */
  allowed_listings?: string[] | null
  /**
   * B28.27 — who the agent may pay, and who it may not, by payee id: an agent, a listing, a company (its
   * workspace id) or a card merchant. Lens refuses a payment to a blocked payee and, once allowed_payees names
   * anyone, to a payee it does not name. Lens always reads them; a save without them keeps the lists.
   */
  allowed_payees?: string[] | null
  blocked_payees?: string[] | null
  /**
   * B28.28 — what the agent may pay one payee in a day, in µLXC, keyed by the payee's id as the lists above name it.
   * Lens refuses a payment that would take the day's total to that payee past its cap. A save without it keeps the caps.
   */
  payee_daily_limits_ulxc?: Record<string, number> | null
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

/** Every kind of agent_postings row Lens writes on an agent's account. */
export type PostingKind =
  | 'fund'
  | 'withdraw'
  | 'topup'
  | 'credit_line'
  | 'spend'
  | 'hold'
  | 'settle'
  | 'release'
  | 'pay'
  | 'transfer'
  | 'escrow'
  | 'reversal'
  | 'card'
  | 'cash_out'
  | 'pot_in'
  | 'pot_out'
  | 'platform_fee'

/** Lens economy.AgentStatementLine. */
export interface StatementLine {
  entry_id: string
  kind: PostingKind
  amount_ulxc: number
  counterparty: string
  ref?: string
  balance_after_ulxc: number
  at: string
  /** B32.11 — a platform fee line's words with its rate, "Platform fee 3%". Absent on every other kind. */
  label?: string
  /** B28.93 — on a call's lines (spend, hold, settle, release, platform_fee): the model it asked. */
  model?: string
  /** B28.93 — on a call's lines: where the call came from, in Lens's words. Chat's Recent calls shows it as it is. */
  source?: string
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

/** B28.359 — a task handed to an agent from Chat, as the BFF answers it (apps/bff/agent_task.go): the model's answer to it,
 *  on the agent's own wallet, and whether the key it ran on was revoked after. */
export interface AgentTaskReply {
  agent_id: string
  answer: string
  model?: string
  request_id?: string
  /** Lens answered from the cache: nothing was charged. */
  replayed: boolean
  usage: { input_tokens: number; output_tokens: number }
  key_revoked: boolean
}

/** B28.377 — one run of a prompt scheduled from Chat (Lens B28.125, apps/bff/prompt_schedules.go): the model's answer,
 *  asked on the agent's own wallet, or why the agent's rules refused it. */
export interface PromptScheduleRun {
  ran_at: string
  outcome: 'answered' | 'refused'
  answer?: string
  /** refused: Lens's sentence */
  detail?: string
  request_id?: string
  /** all the run took from the agent's wallet, its platform fee included */
  charged_ulxc?: number
  /** the agent's statement line the answer was charged on */
  entry_id?: string
}

/** B28.377 — a prompt scheduled from Chat: asked at first_run_at, then every day or week while it is active, on the
 *  agent's own wallet. */
export interface PromptSchedule {
  id: string
  agent_id: string
  prompt: string
  provider: string
  model: string
  every: 'once' | 'day' | 'week'
  /** absent once it will not run again */
  next_run_at?: string
  active: boolean
  created_at: string
  /** newest first */
  runs: PromptScheduleRun[] | null
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
  /** B28.360 — frozen: Lens declines every purchase on it until it is unfrozen */
  frozen?: boolean
  frozen_at?: string
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
  if (res.status === 204) return undefined as T // B28.32: ending a boost answers nothing
  return (await res.json()) as T
}

const e = encodeURIComponent

/** B30.103 — a read whose refusal carries Lens's sentence: a frozen agent's credential is a 409 saying why it has none. */
async function getSaid<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
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

/** B30.116 — where each level's check is sent. */
const VERIFY_PATH: Record<VerificationBody['kind'], string> = {
  contact: '/api/verification/contact',
  identity: '/api/verification/identity',
  company: '/api/verification/company',
}

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
  /** B28.359 — runs a task on the agent's own wallet: the BFF issues it a key for the task, and revokes it after. */
  task: (id: string, body: { task: string; provider: string; model: string }) => send<AgentTaskReply>('POST', `/api/agents/${e(id)}/tasks`, body),
  rules: (id: string) => getJSON<AgentRules>(`/api/agents/${e(id)}/rules`, {
      max_per_request_ulxc: 'number',
      daily_limit_ulxc: 'number',
      monthly_limit_ulxc: 'number',
      approval_above_ulxc: 'number',
    }),
  setRules: (id: string, rules: AgentRules) => send<AgentRules>('PUT', `/api/agents/${e(id)}/rules`, rules),
  /** B28.30 — would the agent's rules let this request through? Lens judges it and moves nothing. */
  simulate: (id: string, req: SimulatedRequest) => send<RuleSimulation>('POST', `/api/agents/${e(id)}/rules/simulate`, req),
  /** B28.31 — every version of the agent's rules, newest first: the first is the rules in force. */
  rulesHistory: (id: string) =>
    getJSON<{ versions: AgentRulesVersion[] | null }>(`/api/agents/${e(id)}/rules/history`, { versions: 'list' }),
  /** B28.31 — put the agent's rules back exactly as they were at version; Lens records that as a new version. */
  rollbackRules: (id: string, version: number) => send<AgentRules>('POST', `/api/agents/${e(id)}/rules/rollback`, { version }),
  /** B28.32 — the agent's limits raised for now, the soonest to end first. */
  boosts: (id: string) => getJSON<{ boosts: AgentRuleBoost[] | null }>(`/api/agents/${e(id)}/rules/boosts`, { boosts: 'list' }),
  /** B28.32 — raise one of the agent's limits to value until a time; from then on it is the rules' limit again by itself. */
  boost: (id: string, b: { rule: string; value: number; until: string }) =>
    send<AgentRuleBoost>('POST', `/api/agents/${e(id)}/rules/boosts`, b),
  /** B28.32 — end the agent's boost on that limit now, before its time. */
  endBoost: (id: string, rule: string) => send<void>('DELETE', `/api/agents/${e(id)}/rules/boosts/${e(rule)}`),
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
  /** B28.360 — every purchase on the agent's card refused until it is unfrozen; Lens answers the card. */
  freezeCard: (id: string) => send<AgentCard>('POST', `/api/agents/${e(id)}/card/freeze`),
  unfreezeCard: (id: string) => send<AgentCard>('POST', `/api/agents/${e(id)}/card/unfreeze`),
  /** B28.21 — renames the agent and/or sets what it is for; Lens answers the agent. */
  update: (id: string, change: { name?: string; description?: string }) => send<Agent>('PATCH', `/api/agents/${e(id)}`, change),
  /** B28.21 — retires the agent: its balance back to the workspace, its keys revoked, its top-up and schedules stopped. */
  archive: (id: string) => send<AgentArchive>('POST', `/api/agents/${e(id)}/archive`),
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
  // B28.377 — prompts scheduled from Chat, each asked at its time on an agent's wallet.
  promptSchedules: () => getJSON<{ schedules: PromptSchedule[] | null }>('/api/agents/prompt-schedules', { schedules: 'list' }),
  schedulePrompt: (id: string, body: { prompt: string; provider: string; model: string; every: PromptSchedule['every']; first_run_at: string }) =>
    send<PromptSchedule>('POST', `/api/agents/${e(id)}/prompt-schedules`, body),
  stopPromptSchedule: (sid: string) => send<{ active: boolean }>('POST', `/api/agents/prompt-schedules/${e(sid)}/stop`),
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
  // B30.116 — the owner's verification levels (Lens B30.4).
  verification: () =>
    getJSON<WorkspaceVerification>('/api/verification', { level: 'string', live_level: 'string', checks: 'list' }),
  verify: ({ kind, ...body }: VerificationBody) => send<VerificationAnswer>('POST', VERIFY_PATH[kind], body),
  // B30.103 — each capability's terms (Lens B30.9), and each agent's Know Your Agent credential (Lens B30.5).
  terms: () => getJSON<{ terms: WorkspaceTerms[] | null }>('/api/terms', { terms: 'list' }),
  termsFor: (capability: string) =>
    getJSON<WorkspaceTerms>(`/api/terms/${e(capability)}`, { capability: 'string', version: 'number', body: 'string' }),
  acceptTerms: (capability: string, version: number) =>
    send<{ acceptance: TermsAcceptance }>('POST', `/api/terms/${e(capability)}/accept`, { version }),
  credential: (id: string) => getSaid<KYACredential>(`/api/agents/${e(id)}/credential`),
  verifyCredential: (credential: string) => send<KYAVerification>('POST', '/api/kya/verify', { credential }),
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
  // B28.23 — give back a transfer one of the workspace's agents received (Lens B22.3, B28.299).
  refundTransfer: (tid: string) => send<AgentTransfer>('POST', `/api/wallets/transfers/${e(tid)}/refund`),
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
  // B30.97 — invoices from an agent's currency account and their pay page (Lens B30.20), and the accounts they are paid into (B30.13).
  moneyAccounts: () => getJSON<{ accounts: CurrencyAccount[] | null }>('/api/money/accounts', { accounts: 'list' }),
  openMoneyAccount: (currency: string, agent_id: string) => send<CurrencyAccount>('POST', '/api/money/accounts', { currency, agent_id }),
  invoices: () => getJSON<{ invoices: Invoice[] | null }>('/api/money/invoices', { invoices: 'list' }),
  createInvoice: (body: InvoiceRequest) => send<Invoice>('POST', '/api/money/invoices', body),
  sendInvoice: (id: string) => send<Invoice>('POST', `/api/money/invoices/${e(id)}/send`),
  voidInvoice: (id: string) => send<Invoice>('POST', `/api/money/invoices/${e(id)}/void`),
  payInvoiceByAgent: (token: string, agent_id: string) => send<PaidInvoice>('POST', `/api/money/pay/${e(token)}/agent`, { agent_id }),
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
  clearance?: {
    by: string
    reference: string
    at: string
    licence_reference?: string
    partner?: string
    countries?: string[] | null
    expires_at?: string
  }
  /** B30.4: the verification level its live money needs, "L0" to "L3". */
  level_needed?: string
}

/** Lens economy.VerificationCheck (B30.4): one check, as the provider that made it answered. */
export interface VerificationCheck {
  level: string
  subject: string
  /** The provider that checked. */
  method: string
  /** Checked by the Test provider: it counts for test money only. */
  test: boolean
  status: 'pending' | 'completed' | 'failed' | 'returned'
  evidence_ref: string
  verified_name?: string
  country?: string
  company_number?: string
  detail?: string
  started_at: string
  checked_at: string
}

/** Lens economy.WorkspaceVerification (B30.4): the level the checks reach, the level live money is judged by, every check. */
export interface WorkspaceVerification {
  level: string
  meaning: string
  live_level: string
  live_meaning: string
  checks: VerificationCheck[] | null
}

/** What a check answers: the check, and the record after it. */
export interface VerificationAnswer {
  check: VerificationCheck
  verification: WorkspaceVerification
}

/** What each level's check is asked to confirm (Lens economy.VerificationRequest). */
export type VerificationBody =
  | { kind: 'contact'; email: string; phone: string }
  | { kind: 'identity'; name: string; country: string; date_of_birth: string }
  | { kind: 'company'; name: string; country: string; company_number: string; directors: string[]; people_with_significant_control: string[] }

/** Lens economy.TermsAcceptance (B30.9): who accepted which version of a capability's terms, and when. */
export interface TermsAcceptance {
  capability: string
  version: number
  person: string
  accepted_at: string
}

/** Lens economy.WorkspaceTerms (B30.9): a capability's latest terms, and whether this workspace has accepted them. */
export interface WorkspaceTerms {
  capability: string
  name: string
  class: 'GREEN' | 'AMBER' | 'RED'
  version: number
  published_at: string
  /** The text, in Markdown; only on the read of one capability's terms. */
  body?: string
  /** Of the latest version; absent until it is accepted. */
  accepted?: TermsAcceptance
  /** The latest earlier version this workspace accepted, while it has not accepted this one. */
  previously_accepted_version?: number
}

/** Lens kya claims (docs/kya.md): what an agent's credential says about it. */
export interface KYAClaims {
  iss: string
  sub: string
  jti: string
  iat: number
  exp: number
  agent: { id: string; name: string }
  owner: { workspace_id: string; name?: string; level: string; live_level: string }
  capabilities: { capability: string; money: string }[] | null
  limits: Record<string, number | string | boolean>
}

/** Lens kya.Credential (B30.5): the signed credential an agent shows, and where any platform checks it. */
export interface KYACredential {
  id: string
  credential: string
  claims: KYAClaims
  issued_at: string
  expires_at: string
  jwks_url: string
  verify_url: string
}

/** Lens kya.Verification (B30.5): Talyvor's answer on a credential. */
export interface KYAVerification {
  valid: boolean
  reason?: string
  claims?: KYAClaims
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
  /** B28.299: the refund that gave this transfer back, if one did */
  refunded_by?: string
  /** B28.299: this agent received it and may still give it back (not a refund, a loan's movement or given back) */
  refundable?: boolean
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

/** Lens economy.CurrencyAccount (B30.13): the company's or an agent's account in GBP, EUR, USD or USDC. */
export interface CurrencyAccount {
  id: string
  /** "" for the company's own */
  agent_id?: string
  currency: string
  purpose: 'company' | 'agent'
  status: string
  name: string
  balance_minor: number
  test_minor: number
  live_minor: number
}

/** One line of an invoice (Lens economy.InvoiceLine): a quantity at a unit price in minor units, with its VAT rate in basis points. */
export interface InvoiceLine {
  description: string
  quantity: number
  unit_amount_minor: number
  vat_rate_bps: number
  net_minor?: number
  vat_minor?: number
}

/** What issues an invoice (Lens economy.InvoiceRequest, B30.20); the account names the currency. */
export interface InvoiceRequest {
  account_id: string
  customer_name: string
  customer_email: string
  customer_address: string
  customer_vat_number: string
  seller_vat_number: string
  lines: InvoiceLine[]
  /** YYYY-MM-DD */
  due_date: string
  remind_days_before: number
  memo: string
  /** sent at once, its pay link open, rather than kept as a draft */
  send: boolean
}

/** Lens economy.Invoice (B30.20). Its ids and pay token are absent from the payer's view (PayPage). */
export interface Invoice {
  id: string
  agent_id?: string
  account_id?: string
  issuer: string
  /** INV-000001, the workspace's own */
  number: string
  /** quoted with a transfer, it marks the invoice paid */
  reference: string
  pay_url?: string
  currency: string
  customer_name: string
  customer_email?: string
  customer_address?: string
  customer_vat_number?: string
  seller_vat_number?: string
  lines: InvoiceLine[]
  subtotal_minor: number
  vat_minor: number
  total_minor: number
  paid_minor: number
  due_minor: number
  due_date: string
  remind_days_before: number
  memo?: string
  status: 'draft' | 'sent' | 'overdue' | 'paid' | 'void'
  sent_at?: string
  paid_at?: string
  voided_at?: string
  created_at: string
  payments?: { entry_id: string; method: 'card' | 'transfer' | 'agent'; amount_minor: number; paid_at: string }[] | null
  reminders?: { kind: string; sent_to?: string; message: string; sent_at: string }[] | null
}

/** What a Talyvor agent's payment of an invoice did (Lens economy.PaidInvoice): the invoice as it now reads, and the entry. */
export interface PaidInvoice {
  invoice: Invoice
  entry: { id: string }
}

/** The pay page as Lens serves it to whoever holds the link (GET /v1/pay/{token}, B30.20). */
export interface PayPage {
  notice: string
  invoice: Invoice
  /** a card may pay what is due (Lens has a Stripe test-mode key and the invoice is sent or overdue) */
  card: boolean
  transfer?: {
    details: { holder: string; currency: string; sort_code?: string; account_number?: string; iban?: string; bic?: string; routing_number?: string }
    mode: string
    reference: string
  }
}

/** 12345 GBP → "£123.45": minor units in the currency's own figures. */
export function formatMinor(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100)
}
