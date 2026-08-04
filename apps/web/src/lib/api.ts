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
  /** SPENDABLE LENS. A held mint does not touch this. */
  balance_ulens: number
  /**
   * EARNED BUT NOT YET SPENDABLE — a pool royalty inside its holdback window, settled into
   * balance_ulens by Lens's finalize sweeper once finalize_after passes (72h by default).
   *
   * ⚠ NEVER ADD IT TO balance_ulens. The first real royalty was 822 µLENS held against a balance
   * of 0, and a screen showing only the balance made a correct system read as broken. Summing them
   * is the opposite error: offering a number that cannot be spent.
   *
   * Optional because a Lens older than the change that added it omits the field; `?? 0` at the
   * read sites is a deployment-skew tolerance, not a default.
   */
  held_balance_ulens?: number
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

/** GET /v1/workspaces/{ws}/lxc/history → []economy.LXCLedgerEntry. Same shape as the LENS
 *  ledger but for the pegged token: the µ-fields are `_ulxc`, not `_ulens`. */
export interface LXCLedgerEntry {
  id: string
  workspace_id: string
  amount_ulxc: number
  balance_after_ulxc: number
  type: string
  description: string
  metadata: Record<string, unknown>
  created_at: string
}

/** GET /api/context — BFF-originated; never contains the key. */
export interface BffContext {
  workspace_id: string
  /** How the BFF reaches Lens — a loopback/compose address. NOT for display: a customer
   *  cannot resolve it. */
  lens_base_url: string
  /** How a CUSTOMER reaches Lens — the origin for OPENAI_BASE_URL / ANTHROPIC_BASE_URL.
   *  Empty when LENS_PUBLIC_BASE_URL is unset; callers must branch on that rather than fall
   *  back to lens_base_url. */
  lens_public_base_url: string
}

/** Which token a ledger/numeral belongs to. Drives the unit tick (copper LENS / steel LXC). */
export type Token = 'lens' | 'lxc'

/** A ledger row normalized across both tokens. `amount`/`balanceAfter` are µ-units of the
 *  row's token — the ONLY per-token difference between the two Lens ledgers is the field
 *  name (`_ulens` vs `_ulxc`) and the unit tick, so one normalized shape lets one table
 *  render either ledger. `type`/`description` are shown verbatim (see the mislabeled
 *  bootstrap `purchase` row — the data is wrong, not the display). */
export interface LedgerRow {
  id: string
  amount: number
  balanceAfter: number
  type: string
  description: string
  created_at: string
  /** The row's metadata document, PRESERVED rather than dropped.
   *
   *  This mapper used to discard it, which is how two screens ended up captioned "LXC ledger
   *  rows carry no model attribution, so spend has no per-model split" while the model was
   *  sitting in the response body: Lens stamps requested_model on every agent-lane writer
   *  (#343) and served_model on the delivered-charge spend row (#355), GetLXCHistory selects
   *  the column, and the BFF streams it verbatim. The claim was true of this function, not of
   *  the data. Kept as an opaque map — spendMath.lxcDebitsByModel reads the two model keys and
   *  nothing else, so a new key upstream cannot change what any screen renders. */
  metadata: Record<string, unknown>
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
 * A LIST read that tolerates an empty result serialised as JSON `null`.
 *
 * Lens builds list responses with the Go idiom `var out []T; for rows.Next()…;
 * return out`, so a genuinely-empty result is a nil slice → `null` on the wire,
 * NOT `[]`. THREE suite endpoints do this (verified in Lens source): tokens/history,
 * lxc/history and api-keys. A caller that maps or reads .length on `null` throws,
 * and a TRUE empty state (a new workspace with no rows) renders as a FAILURE — the
 * bug this fixes, and the third instance of that shape in the suite.
 *
 * Normalise ONCE here rather than let every screen guard with `?? []`: null and []
 * are identical for a list. This is deliberately array-scoped — object reads keep
 * getJSON, so a null that MEANS something (a missing object) still surfaces. The
 * one Lens list that must never be null (`/v1/workspaces`, "ALWAYS a JSON array")
 * loses nothing by passing through.
 */
async function getJSONArray<T>(path: string): Promise<T[]> {
  const body = await getJSON<T[] | null>(path)
  return body ?? []
}

/**
 * A capability-gated read: either the feature is off, or it's on with a payload. Lens
 * makes a flag-off route wire-identical to a real not-found, so the BFF resolves the
 * ambiguity (it knows which endpoints are gated) and returns this envelope. The client
 * discriminates on `enabled` — never on a status code, so a disabled capability never
 * touches the error path. A genuine failure (5xx/auth) still throws ApiError.
 */
export { getJSON, getJSONArray }

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

/** GET /auth/me — BFF-originated, always 200. `mode` says whether this BFF
 *  authenticates at all ("disabled" = loopback dev); `authenticated` + `user`
 *  describe the current session. The gate renders sign-in ONLY for
 *  mode:"oidc" + authenticated:false — everything else is the app. */
export interface AuthMe {
  mode: 'oidc' | 'disabled'
  authenticated: boolean
  user: { sub: string; email: string } | null
  /** This session's OWN Lens workspace, derived by Lens from the identity. Opaque to the client;
   *  shown only so two people can tell their screens apart. The session's token never appears
   *  here — it stays server-side in the BFF. */
  workspace_id?: string
  /** Whether THIS deployment's Docs is a single workspace shared by everyone signed in.
   *  Derived by the BFF from its own config (docsBaseURL + docsWorkspaceID), never hardcoded —
   *  so it goes false by construction the day Docs gains its own tenancy root, and the notice
   *  that depends on it stops rendering rather than becoming a false claim.
   *  Absent (older BFF) is treated as false: silence must not manufacture a warning. */
  /** The consent Lens RECORDED for this workspace — not what was requested. */
  cache_poolable?: boolean
  /** True only for the login that CREATED the workspace: the one moment the pooling question is
   *  put to the person, before anything of theirs could be shared. */
  needs_pooling_choice?: boolean
  /** Whether an identity NOBODY HAS ADDED can complete signup on this deployment — i.e. whether
   *  OIDC_ALLOWED_EMAILS is `*`. Reported on the UNAUTHENTICATED answer too, because everyone
   *  who needs it is by definition not signed in: the marketing hero and the signup page have to
   *  tell a stranger whether they may start, and a sentence hardcoded in the bundle goes stale
   *  the moment an operator changes the variable. One bit — never who is on the list.
   *  Absent (older BFF) is UNKNOWN, not false: see lib/signupOpen.ts for why that is its own
   *  state rather than a boolean default. */
  signup_open?: boolean
}

/** GET /api/spend/month — Lens spend/current-month. A float upstream, so the
 *  UI dresses it as derived (≈), never as a numeral. */
export interface MonthSpend {
  current_month_usd: number
}

/** GET /api/usage → Lens GET /v1/api/usage. Per-model usage plus the cache rollup, one call.
 *
 *  THE CACHE NUMBERS ARE MEASURED, from token_events.serve_source (Lens migration 0100). The
 *  legacy `cached` boolean is NOT used upstream and never was written true — reading it gave a
 *  structural zero reported as a measurement, which is why Lens switched to serve_source.
 *
 *  DENOMINATOR CAVEAT, carried from the Lens handler's own doc comment: a node-routed serve
 *  writes no token_events row, so node serves are absent from BOTH numerator and denominator
 *  and the rate would read HIGH if node routing were ever enabled (default-off today, and a
 *  reader can see it: `by_source` carries only 'upstream' and cache_hit_* keys, never 'node').
 *  Fixing that is Lens-side work in tryNodeRouting, not something this UI can correct. */
export interface UsageModelRow {
  model: string
  requests: number
  input_tokens: number
  output_tokens: number
  /** Provider USD COGS from token_events — NOT the µLXC the workspace was charged. */
  cost_usd: number
  cache_hits: number
}

export interface UsageCache {
  total_requests: number
  cache_hits: number
  misses: number
  /** 0..1. Derived, so the UI ≈-marks it and never renders it as an exact numeral. */
  hit_rate: number
  /** serve_source composition, e.g. {upstream: 12, cache_hit_exact: 3}. */
  by_source: Record<string, number>
}

export interface Usage {
  period_days: number
  models: UsageModelRow[]
  cache: UsageCache
}

export const api = {
  me: () => getJSON<AuthMe>('/auth/me'),
  spendMonth: () => getJSON<MonthSpend>('/api/spend/month'),
  context: () => getJSON<BffContext>('/api/context'),
  lxcBalance: () => getJSON<LXCSnapshot>('/api/lxc/balance'),
  lensBalance: () => getJSON<LensBalance>('/api/tokens/balance'),
  tokensHistory: (limit: number, offset: number) =>
    getJSONArray<LedgerEntry>(`/api/tokens/history?limit=${limit}&offset=${offset}`),
  /** Capability-gated (H5 bonds). Off in the trial config today → { enabled: false }. */
  bonds: () => getCapability<Bond[]>('/api/bonds'),
  /** Per-model usage + the measured cache rollup for a window. Replaces the cache fixture. */
  usage: (days: number) => getJSON<Usage>(`/api/usage?days=${days}`),

  /** The LENS mint ledger, normalized. */
  lensLedger: (limit: number, offset: number): Promise<LedgerRow[]> =>
    getJSONArray<LedgerEntry>(`/api/tokens/history?limit=${limit}&offset=${offset}`).then((rs) =>
      rs.map((r) => ({
        id: r.id,
        amount: r.amount_ulens,
        balanceAfter: r.balance_after_ulens,
        type: r.type,
        description: r.description,
        created_at: r.created_at,
        metadata: r.metadata ?? {},
      })),
    ),
  /** The LXC (pegged) ledger, normalized. */
  lxcLedger: (limit: number, offset: number): Promise<LedgerRow[]> =>
    getJSONArray<LXCLedgerEntry>(`/api/lxc/history?limit=${limit}&offset=${offset}`).then((rs) =>
      rs.map((r) => ({
        id: r.id,
        amount: r.amount_ulxc,
        balanceAfter: r.balance_after_ulxc,
        type: r.type,
        description: r.description,
        created_at: r.created_at,
        metadata: r.metadata ?? {},
      })),
    ),
  /** One ledger fetch keyed by token — feeds the one LedgerTable. */
  ledger: (token: Token, limit: number, offset: number): Promise<LedgerRow[]> =>
    token === 'lxc' ? api.lxcLedger(limit, offset) : api.lensLedger(limit, offset),
}
