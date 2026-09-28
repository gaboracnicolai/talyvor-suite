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
}

/** Lens economy.AgentBook: workspace = allocated + unallocated; spent is what the agents spent. */
export interface AgentBook {
  workspace_balance_ulxc: number
  allocated_ulxc: number
  unallocated_ulxc: number
  spent_ulxc: number
  agents: Agent[]
}

/** Lens economy.AgentRules. A zero limit and an empty list are "no rule". */
export interface AgentRules {
  max_per_request_ulxc: number
  daily_limit_ulxc: number
  monthly_limit_ulxc: number
  approval_above_ulxc: number
  allowed_models: string[] | null
  allowed_providers: string[] | null
  active_from: string
  active_until: string
  timezone: string
}

/** Lens economy.AgentApproval. `model` is empty for a payment to another agent. */
export interface AgentApproval {
  id: string
  agent_id: string
  amount_ulxc: number
  model: string
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
  pay: (id: string, to_agent_id: string, amount_ulxc: number, memo: string) =>
    send<AgentPayment>('POST', `/api/agents/${e(id)}/pay`, { to_agent_id, amount_ulxc, memo }),
  approvals: () => getJSON<{ approvals: AgentApproval[] | null }>('/api/agents/approvals'),
  decide: (approvalID: string, decision: 'approve' | 'deny') =>
    decision === 'approve'
      ? send<AgentApproval>('POST', `/api/agents/approvals/${e(approvalID)}/approve`)
      : send<AgentApproval>('POST', `/api/agents/approvals/${e(approvalID)}/deny`),
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
