// SAMPLE DATA for the lens-area screens whose BFF routes do not exist yet.
// Every shape below is copied from the OWNING repo's source at its origin/main
// (lens 839b447, track a3bc7b2) — fixtures mirror the wire, they do not invent
// it. Each fixture-backed screen shows a visible FixtureNotice; nothing here is
// presented as live. When the BFF routes land (see the lens-area report), these
// types move next to api.ts calls and the fixtures die.

/** Lens list row: internal/tenant/store.go WorkspaceAPIKey (KeyHash json:"-").
 *  GET /v1/workspaces/{ws}/api-keys → []WorkspaceAPIKey. */
export interface WorkspaceAPIKey {
  id: string
  workspace_id: string
  key_prefix: string
  name: string
  scopes: string[]
  last_used_at?: string
  expires_at?: string
  created_at: string
}

/** Lens mint response: cmd/lens/main.go POST /v1/workspaces/{ws}/api-keys →
 *  201 {key, prefix, name, scopes, …} — `key` and `prefix` ADJACENT in one
 *  JSON object; the /keys screen exists to keep humans from confusing them. */
export interface MintResult {
  key: string
  prefix: string
  name: string
  scopes: string[]
}

/** Track roster row: internal/member/mgmt_handler.go memberView.
 *  GET /v1/workspaces/{wsID}/members → []memberView. Roles: owner | member. */
export interface RosterMember {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  avatar_url: string
}

/** A mint-ledger row, the shape /api/tokens/history serves TODAY (live route;
 *  see lib/api.ts LedgerEntry). Spend-by-model derivation runs on THESE rows so
 *  the wiring to the live route is a data-source swap, not a logic change. */
export interface SpendLedgerRow {
  id: string
  amount_ulens: number
  type: string
  created_at: string
  metadata: Record<string, unknown> // lib/api.ts LedgerEntry.metadata — live rows feed the same functions
}

export const fixtureKeys: WorkspaceAPIKey[] = [
  {
    id: 'key_01',
    workspace_id: 'trial-ws-1',
    key_prefix: 'tlv_ws_9f21c4a0',
    name: 'CI pipeline',
    scopes: ['proxy'],
    created_at: '2026-07-14T09:12:00Z',
    last_used_at: '2026-07-22T07:41:00Z',
  },
  {
    id: 'key_02',
    workspace_id: 'trial-ws-1',
    key_prefix: 'tlv_ws_b7e02d11',
    name: 'Local development',
    scopes: ['proxy', 'earn'],
    created_at: '2026-07-19T16:03:00Z',
  },
]

/** The sample mint. The key value is unmistakably a SAMPLE — it says so. */
export const fixtureMint: MintResult = {
  key: 'tlv_ws_SAMPLE_this_is_not_a_real_credential_0000000000000000',
  prefix: 'tlv_ws_5ample00',
  name: 'New key',
  scopes: ['proxy'],
}

export const fixtureRoster: RosterMember[] = [
  { id: 'm_01', name: 'N. Gaborac', email: 'gaborac.nicolai@gmail.com', role: 'owner', avatar_url: '' },
  { id: 'm_02', name: 'Trial Reviewer', email: 'reviewer@example.com', role: 'member', avatar_url: '' },
]

/** Rows shaped exactly like the live mint ledger (metadata.model_used is real:
 *  see the inc2 report — provenance keys on pattern_mine rows). */
export const fixtureSpendRows: SpendLedgerRow[] = [
  { id: 'l1', amount_ulens: 420, type: 'pattern_mine', created_at: '2026-07-21T10:00:00Z', metadata: { model_used: 'claude-haiku-4-5', provider_used: 'anthropic' } },
  { id: 'l2', amount_ulens: 180, type: 'pattern_mine', created_at: '2026-07-21T11:30:00Z', metadata: { model_used: 'claude-haiku-4-5', provider_used: 'anthropic' } },
  { id: 'l3', amount_ulens: 950, type: 'pattern_mine', created_at: '2026-07-20T09:15:00Z', metadata: { model_used: 'claude-sonnet-5', provider_used: 'anthropic' } },
  { id: 'l4', amount_ulens: 60, type: 'pattern_mine_held', created_at: '2026-07-05T08:00:00Z', metadata: { model_used: 'claude-haiku-4-5', provider_used: 'anthropic' } },
]

/** Model → tier for the two-step ramp. Category, not rank-by-hue. */
export const fixtureModelTiers: Record<string, 'cheap' | 'capable'> = {
  'claude-haiku-4-5': 'cheap',
  'claude-sonnet-5': 'capable',
}

/** Cache stats in the shape of internal/api/distill.go (cache_hits,
 *  cache_hit_rate = hits/(hits+misses)) — no workspace endpoint serves this
 *  yet; entirely sample. */
export const fixtureCache = { cache_hits: 1240, cache_lookups: 1421, cache_hit_rate: 0.8726 }
