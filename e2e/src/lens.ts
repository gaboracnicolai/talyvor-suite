// B17.3 — the harness's own calls to Lens: create and reset the synthetic users (B17.1), read each
// one's ledger back, and ask the judge. Every call a synthetic user makes uses that user's own token.

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

const SYNTHETIC_KEY_HEADER = 'X-Talyvor-Synthetic-Key'

export class LensClient {
  readonly baseURL: string
  private readonly key: string
  private readonly sessionKeys = new Map<string, Promise<string>>()

  constructor(baseURL: string, syntheticKey: string) {
    this.baseURL = baseURL
    this.key = syntheticKey
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
    const key = await this.sessionKey(user)
    const res = await fetch(`${this.baseURL}/v1/proxy/${provider}/v1/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 5, messages: [{ role: 'user', content: prompt }] }),
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`judge: Lens answered ${res.status}: ${raw.slice(0, 200)}`)
    const body = JSON.parse(raw) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
    return {
      text: (body.content ?? []).map((c) => c.text ?? '').join(''),
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      replayed: res.headers.get('X-Talyvor-Cache-Replay') === 'true',
      pooledULXC: res.headers.has('X-Talyvor-Pool-Charged-ULXC') ? Number(res.headers.get('X-Talyvor-Pool-Charged-ULXC')) : undefined,
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
    const res = await fetch(this.baseURL + path, {
      method,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const raw = await res.text()
    if (!res.ok) throw new Error(`${method} ${path}: Lens answered ${res.status}: ${raw.slice(0, 200)}`)
    return raw === '' ? null : JSON.parse(raw)
  }
}
