// B26.24 — the shapes of Lens's answers, recorded from a real Lens, that the stub Lens is held to.
//
// The stub drifted silently: it answered every workspace route it did not know with `{}`, so when the
// app began reading Lens's API keys, its month's spend and its approvals' payees, the self-test's
// screens threw ("f.map is not a function") and seven bank scenarios could not be shown to catch their
// planted defects. Here each read the app and the harness make is recorded once from a real Lens
// (record-lens-shapes.ts → lens-shapes.json), and test/stubLens.test.ts reads the same routes from the
// stub and fails on any field Lens sends that the stub does not, in the type Lens sends it.
//
// READS is taken from what the self-test reads: every GET the stub served in a whole run (BFF and
// harness), with the workspace, and the one agent the seed makes, as the only parameters. The
// moderators' queue is read with a moderator key (MODERATOR_READS).

/** A JSON value's shape: a primitive's type, a list's element (none when empty), an object's fields. */
export type Shape = 'string' | 'number' | 'boolean' | 'null' | Shape[] | { [field: string]: Shape }

export interface Recorded {
  /** The Lens commit the shapes were read from, and when. */
  lens: string
  recorded_at: string
  reads: Record<string, { status: number; shape?: Shape }>
}

/** The reads, as paths with {wsID} and {agentID} in them. A query is part of the read. */
export const READS: readonly string[] = [
  '/v1/catalog/models',
  '/v1/catalog/discovered',
  '/v1/economy/conversion-rate',
  '/v1/api/usage?days=30',
  '/v1/api/spend/by-feature?days=30',
  '/v1/bonds',
  '/v1/markets/simulated/quotes',
  '/v1/marketplace/listings',
  '/v1/wallets/capabilities',
  '/v1/wallets/{agentID}',
  '/v1/workspaces/{wsID}',
  '/v1/workspaces/{wsID}/api-keys',
  '/v1/workspaces/{wsID}/spend/current-month',
  '/v1/workspaces/{wsID}/savings/current-month',
  '/v1/workspaces/{wsID}/deletion-requests',
  '/v1/workspaces/{wsID}/pattern-mining/opt-in',
  '/v1/workspaces/{wsID}/stored-answers',
  '/v1/workspaces/{wsID}/tokens/balance',
  '/v1/workspaces/{wsID}/tokens/history?limit=20&offset=0',
  '/v1/workspaces/{wsID}/lxc/balance',
  '/v1/workspaces/{wsID}/lxc/history?limit=20&offset=0',
  '/v1/workspaces/{wsID}/billing/allowance',
  '/v1/workspaces/{wsID}/billing/subscription',
  '/v1/workspaces/{wsID}/budgets',
  '/v1/workspaces/{wsID}/earnings',
  '/v1/workspaces/{wsID}/distill/usage',
  '/v1/workspaces/{wsID}/provider-keys',
  '/v1/workspaces/{wsID}/tare/savings',
  '/v1/workspaces/{wsID}/guardrails',
  '/v1/workspaces/{wsID}/agents',
  '/v1/workspaces/{wsID}/agents/approvals',
  '/v1/workspaces/{wsID}/agents/alerts',
  '/v1/workspaces/{wsID}/agents/forecast',
  '/v1/workspaces/{wsID}/agents/passkeys',
  '/v1/workspaces/{wsID}/agents/schedules',
  '/v1/workspaces/{wsID}/agents/statement',
  '/v1/workspaces/{wsID}/agents/{agentID}/rules',
  '/v1/workspaces/{wsID}/agents/{agentID}/pots',
  '/v1/workspaces/{wsID}/agents/{agentID}/statement',
  '/v1/workspaces/{wsID}/agents/{agentID}/transfers',
  '/v1/workspaces/{wsID}/agents/{agentID}/topup',
  '/v1/workspaces/{wsID}/agents/{agentID}/portfolios',
  '/v1/workspaces/{wsID}/agents/{agentID}/card',
  '/v1/workspaces/{wsID}/cash-outs',
  '/v1/workspaces/{wsID}/credit-line',
  '/v1/workspaces/{wsID}/escrows',
  '/v1/workspaces/{wsID}/loans',
  '/v1/workspaces/{wsID}/money-requests',
  '/v1/workspaces/{wsID}/marketplace/bill',
  '/v1/workspaces/{wsID}/marketplace/earnings',
  '/v1/workspaces/{wsID}/marketplace/listings',
  '/v1/workspaces/{wsID}/marketplace/payouts',
]

/** The reads a marketplace moderator makes, with a moderator key and the operator it names. */
export const MODERATOR_READS: readonly string[] = ['/v1/admin/marketplace/review']
export const moderatorHeaders = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}`, 'X-Talyvor-Operator': 'lens-shapes' })

/** A Lens (or the stub) at `base`, read and written as a synthetic workspace. */
export class Reader {
  readonly base: string
  readonly syntheticKey: string
  constructor(base: string, syntheticKey: string) {
    this.base = base
    this.syntheticKey = syntheticKey
  }

  /** A new synthetic workspace: its id and token. */
  async workspace(): Promise<{ ws: string; token: string }> {
    const res = await fetch(`${this.base}/v1/synthetic/workspaces`, {
      method: 'POST',
      headers: { 'X-Talyvor-Synthetic-Key': this.syntheticKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1 }),
    })
    if (res.status !== 201) throw new Error(`creating a synthetic workspace: ${res.status} ${await res.text()}`)
    const w = ((await res.json()) as { workspaces: { workspace_id: string; token: string }[] }).workspaces[0]
    return { ws: w.workspace_id, token: w.token }
  }

  async send(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: unknown }> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
    return { status: res.status, json }
  }

  /**
   * What the reads find, the same on Lens and the stub: an API key, a spending limit, and an agent
   * funded with 1 LXC — so a list has a row to take its shape from. The agent's id.
   */
  async seed(ws: string, token: string): Promise<string> {
    const must = async (method: string, path: string, body: unknown): Promise<Record<string, unknown>> => {
      const a = await this.send(token, method, `/v1/workspaces/${ws}${path}`, body)
      if (a.status >= 300) throw new Error(`seeding ${method} ${path}: ${a.status} ${JSON.stringify(a.json)}`)
      return a.json as Record<string, unknown>
    }
    await must('POST', '/api-keys', { name: 'shapes', scopes: ['proxy'] })
    await must('POST', '/budgets', { scope: 'workspace', period: 'monthly', limit_usd: 5, enforcement: 'hard_block', alert_thresholds: [0.8] })
    const agent = await must('POST', '/agents', { name: 'Shapes' })
    const id = String(agent.id)
    await must('POST', `/agents/${id}/fund`, { amount_ulxc: 1_000_000 })
    return id
  }
}

export const fill = (path: string, ws: string, agent: string): string =>
  path.replace('{wsID}', encodeURIComponent(ws)).replace('{agentID}', encodeURIComponent(agent))

/** The shape of a JSON value. A list's element is what every element has in common. */
export function shapeOf(v: unknown): Shape {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return v.length === 0 ? [] : [v.map(shapeOf).reduce(common)]
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x)]))
  return typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string'
}

/** The fields two shapes share, in the type both have (a null takes the other's). */
function common(a: Shape, b: Shape): Shape {
  if (a === 'null') return b
  if (b === 'null') return a
  if (Array.isArray(a) && Array.isArray(b)) return a.length === 0 ? b : b.length === 0 ? a : [common(a[0], b[0])]
  if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    return Object.fromEntries(Object.keys(a).filter((k) => k in b).map((k) => [k, common(a[k], b[k])]))
  }
  return a
}

const kind = (s: Shape): string => (Array.isArray(s) ? 'a list' : typeof s === 'object' ? 'an object' : `a ${s}`)

/**
 * Where the stub's answer falls short of Lens's: a field Lens sends that the stub leaves out, or sends
 * as another type. A null on either side is a value Lens may send, so it matches anything; a field
 * only the stub sends is not drift (Lens leaves out an empty `omitempty` field).
 */
export function drift(lens: Shape, stub: Shape, at = '$'): string[] {
  if (lens === 'null' || stub === 'null') return []
  if (Array.isArray(lens)) {
    if (!Array.isArray(stub)) return [`${at}: Lens sends a list, the stub ${kind(stub)}`]
    return lens.length === 0 || stub.length === 0 ? [] : drift(lens[0], stub[0], `${at}[]`)
  }
  if (typeof lens === 'object') {
    if (typeof stub !== 'object' || Array.isArray(stub)) return [`${at}: Lens sends an object, the stub ${kind(stub)}`]
    return Object.keys(lens).flatMap((k) => (k in stub ? drift(lens[k], stub[k], `${at}.${k}`) : [`${at}.${k}: Lens sends ${kind(lens[k])}, the stub nothing`]))
  }
  return lens === stub ? [] : [`${at}: Lens sends ${kind(lens)}, the stub ${kind(stub)}`]
}
