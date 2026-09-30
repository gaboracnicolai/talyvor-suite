// B17.3 — the harness's own calls to Lens: create and reset the synthetic users (B17.1), read each
// one's ledger back, and ask the judge. Every call a synthetic user makes uses that user's own token.

import type { Recorder, Tag } from './coverage.ts'
import type { CatalogModel } from './oracles.ts'

export interface SyntheticUser {
  index: number
  workspaceID: string
  token: string
  expiresAt: string
}

/** One row of the workspace's LXC ledger (GET /v1/workspaces/{id}/lxc/history). */
export interface LedgerRow {
  id: string
  amount_ulxc: number
  balance_after_ulxc: number
  type: string
  description: string
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

/** Lens economy.AgentApproval. */
export interface AgentApproval {
  id: string
  agent_id: string
  amount_ulxc: number
  status: 'pending' | 'approved' | 'denied' | 'used'
}

/** Lens economy.AgentStatementLine: one posting on an agent's account. */
export interface AgentLine {
  entry_id: string
  kind: string
  amount_ulxc: number
  counterparty: string
  balance_after_ulxc: number
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
  payee_agent_id?: string
}

/** Lens market.Bill: a buyer's billed uses in one month. */
export interface MarketBill {
  month: string
  total_ulxc: number
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
}

/** B17.10 — one period of a plan, as Lens granted it (billing.Allowance). */
export interface PlanAllowance {
  granted_ulxc: number
  consumed_ulxc: number
  remaining_ulxc: number
  fee_usd_cents: number
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
function refusalOf(raw: string): string {
  try {
    const e = (JSON.parse(raw) as { error?: string | { message?: string } }).error
    if (typeof e === 'string') return e
    if (e?.message !== undefined) return e.message
  } catch {
    // not JSON: the body is the sentence
  }
  return raw.slice(0, 300)
}

const SYNTHETIC_KEY_HEADER = 'X-Talyvor-Synthetic-Key'

export class LensClient {
  readonly baseURL: string
  private readonly key: string
  private readonly sessionKeys: Map<string, Promise<string>>
  private readonly recorder: Recorder | undefined
  private readonly tag: Tag

  constructor(baseURL: string, syntheticKey: string, recorder?: Recorder, tag: Tag = { scenario: 'harness', user: -1 },
    sessionKeys = new Map<string, Promise<string>>()) {
    this.baseURL = baseURL
    this.key = syntheticKey
    this.recorder = recorder
    this.tag = tag
    this.sessionKeys = sessionKeys
  }

  /** B25.5 — the same client, its calls recorded as `tag`'s for the coverage map. */
  tagged(tag: Tag): LensClient {
    return new LensClient(this.baseURL, this.key, this.recorder, tag, this.sessionKeys)
  }

  /** Every request to Lens goes through here, so the coverage map sees each one with its time. */
  private async send(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const t0 = Date.now()
    let status = 0
    try {
      const res = await fetch(this.baseURL + path, { ...init, method })
      status = res.status
      return res
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

  /** Clears every synthetic workspace's stored answers and restores its credits. */
  async reset(): Promise<number> {
    const body = await this.call('POST', '/v1/synthetic/workspaces/reset', { [SYNTHETIC_KEY_HEADER]: this.key })
    return Number((body as { reset?: number }).reset ?? 0)
  }

  /** Creates `count` synthetic workspaces, each with test credits and a token. */
  async createUsers(count: number): Promise<SyntheticUser[]> {
    const body = (await this.call('POST', '/v1/synthetic/workspaces', { [SYNTHETIC_KEY_HEADER]: this.key }, { count })) as {
      workspaces?: { workspace_id: string; token: string; expires_at: string }[]
    }
    const list = body.workspaces ?? []
    if (list.length !== count) throw new Error(`asked Lens for ${count} synthetic users, got ${list.length}`)
    return list.map((w, index) => ({ index, workspaceID: w.workspace_id, token: w.token, expiresAt: w.expires_at }))
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

  /** The workspace's ledger, newest first — every row, however many pages. */
  async ledger(user: SyntheticUser): Promise<LedgerRow[]> {
    const rows: LedgerRow[] = []
    for (let offset = 0; ; offset += 200) {
      const page = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/lxc/history?limit=200&offset=${offset}`,
        this.bearer(user.token))) as LedgerRow[] | null
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

  /** B17.6 — one agent's account, newest first (Lens B19.3). */
  async agentLines(user: SyntheticUser, agentID: string): Promise<AgentLine[]> {
    const body = (await this.call('GET', `/v1/workspaces/${user.workspaceID}/agents/${agentID}/statement`, this.bearer(user.token))) as { lines?: AgentLine[] | null }
    return body.lines ?? []
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

  /** B17.10 — asks Lens itself to start a plan's checkout, for the sentence it refuses with. Nothing is charged. */
  async startSubscription(user: SyntheticUser, plan: string): Promise<Answered<{ url?: string }>> {
    const res = await this.send('POST', `/v1/workspaces/${user.workspaceID}/billing/subscribe`, {
      headers: { ...this.bearer(user.token), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ plan }),
    })
    const raw = await res.text()
    return res.ok ? { ok: true, status: res.status, value: JSON.parse(raw) as { url?: string } } : { ok: false, status: res.status, error: refusalOf(raw) }
  }

  /** B17.10 — cancels the workspace's plan at the end of its period. */
  async cancelSubscription(user: SyntheticUser): Promise<Answered<unknown>> {
    const res = await this.send('POST', `/v1/workspaces/${user.workspaceID}/billing/subscription/cancel`,
      { headers: { ...this.bearer(user.token), Accept: 'application/json' } })
    const raw = await res.text()
    return res.ok ? { ok: true, status: res.status, value: null } : { ok: false, status: res.status, error: refusalOf(raw) }
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
    const raw = await res.text()
    if (!res.ok) throw new Error(`${method} ${path}: Lens answered ${res.status}: ${raw.slice(0, 200)}`)
    return raw === '' ? null : JSON.parse(raw)
  }
}
