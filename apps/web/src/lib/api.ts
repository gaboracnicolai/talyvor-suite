// Typed reads against the BFF (same origin, /api/*). The shapes mirror the Lens source
// verbatim (internal/economy/dualtoken.go, internal/mining/cache_mining.go) — every
// money field is an integer count of µ-units (1e-6), never a float.

/** GET /v1/workspaces/{ws}/lxc/balance → economy.LXCSnapshot */
export interface LXCSnapshot {
  workspace_id: string
  balance_ulxc: number
  lifetime_minted_ulxc: number
  lifetime_spent_ulxc: number
  usd_value_uusd: number
}

/** GET /v1/workspaces/{ws}/tokens/balance → mining.BalanceSnapshot */
export interface LensBalance {
  workspace_id: string
  balance_ulens: number
  lifetime_earned_ulens: number
  lifetime_spent_ulens: number
  updated_at: string
}

/** GET /v1/workspaces/{ws}/tokens/history → []mining.LedgerEntry.
 *  Note the columns present: there is NO hold-window field (no finalize_after / start /
 *  end). `metadata` is a free map; on the live data its keys are provenance
 *  (model_used, latency_bucket, …), never a window. See the report for why HoldBar
 *  cannot be driven from this. */
export interface LedgerEntry {
  id: string
  workspace_id: string
  amount_ulens: number
  balance_after_ulens: number
  type: string
  description: string
  metadata: Record<string, unknown>
  created_at: string
}

/** GET /api/context — BFF-originated; never contains the key. */
export interface BffContext {
  workspace_id: string
  lens_base_url: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`${path} → HTTP ${status}`)
    this.name = 'ApiError'
  }
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  return (await res.json()) as T
}

/**
 * A capability-gated read: either the feature is off, or it's on with a payload. Lens
 * makes a flag-off route wire-identical to a real not-found, so the BFF resolves the
 * ambiguity (it knows which endpoints are gated) and returns this envelope. The client
 * discriminates on `enabled` — never on a status code, so a disabled capability never
 * touches the error path. A genuine failure (5xx/auth) still throws ApiError.
 */
export type Capability<T> = { enabled: false } | { enabled: true; data: T }

async function getCapability<T>(path: string): Promise<Capability<T>> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new ApiError(res.status, path)
  const body = (await res.json()) as { enabled: boolean; data?: T }
  return body.enabled ? { enabled: true, data: body.data as T } : { enabled: false }
}

/** A reputation bond (H5). Shape is intentionally loose — this increment only proves the
 *  gate; the field set firms up when bonds are actually built. */
export interface Bond {
  id: string
  kind?: string
  [k: string]: unknown
}

export const api = {
  context: () => getJSON<BffContext>('/api/context'),
  lxcBalance: () => getJSON<LXCSnapshot>('/api/lxc/balance'),
  lensBalance: () => getJSON<LensBalance>('/api/tokens/balance'),
  tokensHistory: (limit: number, offset: number) =>
    getJSON<LedgerEntry[]>(`/api/tokens/history?limit=${limit}&offset=${offset}`),
  /** Capability-gated (H5 bonds). Off in the trial config today → { enabled: false }. */
  bonds: () => getCapability<Bond[]>('/api/bonds'),
}
