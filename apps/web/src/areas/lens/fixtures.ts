// SAMPLE DATA for the lens-area screens whose BFF routes do not exist yet.
// Every shape below is copied from the OWNING repo's source at its origin/main
// (lens 839b447, track a3bc7b2) — fixtures mirror the wire, they do not invent
// it. Each fixture-backed screen shows a visible FixtureNotice; nothing here is
// presented as live. When the BFF routes land (see the lens-area report), these
// types move next to api.ts calls and the fixtures die.

// The Keys types and fixtures that used to live here are GONE: /keys is now
// wired to the real BFF routes (GET + POST /api/keys), so its shapes moved to
// ./keysApi.ts next to the fetch calls — exactly the "the fixtures die" step the
// header promised. Members is the only screen still fixture-backed below.

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

// UNMISTAKABLY SYNTHETIC. A fixture must never impersonate a real person — a
// reviewer who recognises a real name or address on a "sample data"-labelled
// screen stops trusting every number on every other screen (the review found
// this file naming a real owner). Every address here is on the RFC-2606
// `.invalid` TLD, which can never resolve to a real mailbox, and the names say
// what they are. Members.test.tsx pins the `.invalid` rule so it cannot regress.
export const fixtureRoster: RosterMember[] = [
  { id: 'm_01', name: 'Sample Owner', email: 'owner@example.invalid', role: 'owner', avatar_url: '' },
  { id: 'm_02', name: 'Sample Member', email: 'member@example.invalid', role: 'member', avatar_url: '' },
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
