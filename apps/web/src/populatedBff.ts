/**
 * populatedBff — ONE shared fixture that answers every request a console screen makes on mount
 * with a plausible, POPULATED body, so a per-address sweep measures the screen instead of its
 * empty state. W1.1.17b.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 *
 * Every per-address sweep in this repo used a local `mockBff` that answers 404 to everything, and
 * a census taken under that fixture is **a census of twelve failure screens**. It is not a
 * hypothetical: `CardHeaderHeading.test.tsx`'s `CARD_HEADER_CENSUS` row for `/docs` reads 0, and
 * the note merged with it (`6d97481`) records why — AskAI and SearchDocs are gated on the spaces
 * read SUCCEEDING, so that row has ALWAYS measured the OFF state of the address and structurally
 * cannot see two of its three cards. A floor was being read as a count.
 *
 * ── WHY A PER-SCREEN OBJECT AND NOT A DEFAULT ────────────────────────────────────────────────
 *
 * W1.1.17b measured the obvious fix and it does not work: answering 200 with a generic `{}` body
 * crashes the first screen it reaches — `areas/lens/Overview.tsx#SpendCard` throws
 * `TypeError: rows.filter is not a function`, because `{}` is not the array it expects. A useful
 * populated fixture is a map from URL to a body of the RIGHT SHAPE, one entry per endpoint.
 *
 * ── THE POPULATION IS DERIVED, NOT REMEMBERED ────────────────────────────────────────────────
 *
 * The URL list below was taken by RECORDING every request the real `<App/>` makes at each of
 * `CONSOLE_ROUTES`'s addresses, not by reading the source and listing what seemed likely.
 * `populatedBffCoverage.test.tsx` re-derives it on every run and fails when a screen asks for
 * something this file does not answer — which is what stops it going stale one screen at a time,
 * the exact failure mode W1.1.17b warns about.
 *
 * ⚠ UNANSWERED URLS FALL THROUGH TO 404 ON PURPOSE. Silently inventing a body for an endpoint
 * nobody declared would hide the very drift the coverage test exists to report.
 */

/** A body per endpoint. Keys are matched by exact URL first, then by pathname. */
const BODIES: Record<string, unknown> = {
  '/auth/me': { mode: 'disabled', authenticated: false, user: null },

  '/api/context': {
    workspace_id: 'ws-fixture',
    lens_base_url: 'http://lens.internal',
    lens_public_base_url: 'https://lens.example',
  },

  '/api/lxc/balance': {
    workspace_id: 'ws-fixture',
    balance_ulxc: 4_250_000,
    lifetime_minted_ulxc: 10_000_000,
    lifetime_spent_ulxc: 5_750_000,
    usd_value_uusd: 4_250_000,
  },

  '/api/tokens/balance': {
    workspace_id: 'ws-fixture',
    balance_ulens: 3_000_000,
    held_balance_ulens: 800_000,
    lifetime_earned_ulens: 9_000_000,
    lifetime_spent_ulens: 6_000_000,
    updated_at: '2026-08-20T10:00:00Z',
  },

  '/api/spend/month': { current_month_usd: 12.34 },

  '/api/lxc/topup-options': { allowed_usd_cents: [1000, 2500, 5000], billing_enabled: true },

  '/api/distill': { converted: 12, vision_ocr: 3, days: 30 },

  '/api/earnings': {
    workspace_id: 'ws-fixture',
    contribution_settled_ulens: 6_000_000,
    capital_settled_ulens: 1_000_000,
    settled_ulens: 7_000_000,
    held_ulens: 800_000,
    revoked_ulens: 0,
    contribution_settled_usd_at_peg: 0.6,
    settled_usd_at_peg: 0.7,
    held_usd_at_peg: 0.08,
    lens_per_usd: 10,
    earning_enabled: true,
    disabled_gates: [],
    by_type: [
      {
        type: 'pool_royalty',
        class: 'settled',
        kind: 'contribution',
        amount_ulens: 6_000_000,
        rows: 3,
        reason: 'a cross-tenant pooled hit on this workspace answer, settled',
      },
    ],
    unclassified_types: [],
  },
}

/** Bodies for endpoints whose URL carries a query string — matched on pathname. */
const BY_PATH: Record<string, unknown> = {
  '/api/usage': {
    period_days: 7,
    models: [
      { model: 'claude-sonnet-4', requests: 120, input_tokens: 240_000, output_tokens: 60_000, cost_usd: 3.2, cache_hits: 40 },
      { model: 'gpt-4o-mini', requests: 80, input_tokens: 90_000, output_tokens: 20_000, cost_usd: 0.6, cache_hits: 25 },
    ],
    cache: { total_requests: 200, cache_hits: 65, misses: 135, hit_rate: 0.325 },
  },
}

/**
 * Endpoints that legitimately answer with a JSON array.
 *
 * ⚠ THESE ARE POPULATED, NOT `[]`. An empty array is a 200, so it satisfies the coverage check
 * while still rendering the screen's EMPTY state — which is the same floor this fixture exists to
 * stop measuring, arrived at from the other side.
 */
const ARRAYS: Record<string, unknown[]> = {
  '/api/tokens/history': [
    {
      id: 'lens-1',
      workspace_id: 'ws-fixture',
      amount_ulens: 6_000_000,
      balance_after_ulens: 6_000_000,
      type: 'pool_royalty',
      description: 'a pooled hit on this workspace answer',
      metadata: {},
      created_at: '2026-08-20T09:00:00Z',
    },
  ],
  '/api/lxc/history': [
    {
      id: 'lxc-1',
      workspace_id: 'ws-fixture',
      amount_ulxc: -260_000,
      balance_after_ulxc: 4_250_000,
      type: 'spend',
      description: 'a served request',
      metadata: {},
      created_at: '2026-08-20T09:05:00Z',
    },
  ],
  '/api/spend/by-feature': [
    { feature: 'docs.ask', cost_usd: 1.1, requests: 42 },
    { feature: 'track.triage', cost_usd: 0.4, requests: 12 },
  ],
  '/api/bonds': [{ id: 'bond-1', kind: 'reputation' }],
  '/api/models': [
    { id: 'claude-sonnet-4', provider: 'anthropic', display_name: 'Claude Sonnet 4', input_per_1m: 3, output_per_1m: 15 },
    { id: 'gpt-4o-mini', provider: 'openai', display_name: 'GPT-4o mini', input_per_1m: 0.15, output_per_1m: 0.6 },
  ],
  '/api/keys': [
    {
      id: 'key-1',
      workspace_id: 'ws-fixture',
      key_prefix: 'tlv_ab',
      name: 'the key a service holds',
      scopes: ['proxy'],
      created_at: '2026-08-01T00:00:00Z',
    },
  ],
  '/api/members': [
    { id: 'mem-1', name: 'Ada Owner', email: 'ada@corp.example', role: 'owner', avatar_url: '' },
    { id: 'mem-2', name: 'Bo Member', email: 'bo@corp.example', role: 'member', avatar_url: '' },
  ],
  '/api/track/workspaces': [
    { id: 'tw-1', name: 'Engineering', slug: 'eng', logo_url: '', plan: 'pro', created_at: '2026-01-01T00:00:00Z' },
  ],
  '/api/track/issues': [
    {
      id: 'iss-1',
      workspace_id: 'tw-1',
      team_id: 'team-1',
      identifier: 'ENG-1',
      title: 'The importer drops a column',
      description: '',
      state: 'open',
      priority: 2,
      labels: [],
      sort_order: 1,
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-20T00:00:00Z',
    },
  ],
  '/api/docs/spaces': [
    {
      id: 'sp-eng',
      workspace_id: 'ws-fixture',
      name: 'Engineering',
      slug: 'eng',
      description: 'How the thing works',
      icon: '',
      color: '',
    },
  ],
}

export interface PopulatedResult {
  /** every URL the fixture was asked for, in order */
  asked: string[]
  /** the URLs it had no body for, so they fell through to 404 */
  unanswered: string[]
}

/**
 * Install the fixture on `globalThis.fetch`. Returns the record of what was asked, so a caller can
 * assert coverage rather than assume it.
 *
 * `spy` is the caller's `vi.spyOn(globalThis, 'fetch')` mock function — passed in rather than
 * created here so this module needs no vitest import and can be used from any harness.
 */
export function populatedBff(
  install: (impl: (input: unknown) => Promise<Response>) => void,
  /**
   * Per-call replacements, by exact URL. The one real user is `/auth/me`: some sweeps need the
   * SIGNED-OUT shell, which is a different screen rather than a different fixture. Anything here
   * still counts as answered, so the coverage census is unaffected.
   */
  overrides: Record<string, unknown> = {},
): PopulatedResult {
  const result: PopulatedResult = { asked: [], unanswered: [] }
  install(async (input: unknown) => {
    const url = String(input)
    result.asked.push(url)
    const body = url in overrides ? overrides[url] : bodyFor(url)
    if (body === undefined) {
      result.unanswered.push(url)
      return new Response('null', { status: 404 })
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  return result
}

/** The body for a URL, or undefined when this fixture does not answer it. */
export function bodyFor(url: string): unknown {
  if (url in BODIES) return BODIES[url]
  const path = url.split('?')[0]
  if (path in ARRAYS) return ARRAYS[path]
  if (path in BY_PATH) return BY_PATH[path]
  if (path in BODIES) return BODIES[path]
  return undefined
}

/** Every URL this fixture answers — for a coverage census to compare against. */
export function answeredUrls(): string[] {
  return [...new Set([...Object.keys(BODIES), ...Object.keys(BY_PATH), ...Object.keys(ARRAYS)])].sort()
}

/**
 * Wait until nothing is in flight, so a census reads the SCREEN rather than its spinner.
 *
 * ⚠ THIS IS THE THIRD BLINDNESS, AND W1.1.17b DOES NOT NAME IT. Every per-address sweep in this
 * repo awaits `findByRole('navigation')` — the SIDEBAR, which renders immediately and is part of
 * the shell — and then counts. No query has resolved at that point, so the census measures each
 * screen's LOADING state. Measured while migrating the first sweep: swapping the 404 fixture for a
 * populated one changed exactly ONE row, because the sweep was never looking at data either way.
 * A populated fixture without this is a no-op dressed as a repair.
 *
 * It waits on the query client rather than sleeping a fixed number of milliseconds: a sleep is a
 * guess that gets slower to stay safe and still races on a loaded machine.
 */
export async function settleQueries(
  client: { isFetching: () => number },
  waitFor: (cb: () => void) => Promise<unknown>,
): Promise<void> {
  await waitFor(() => {
    if (client.isFetching() !== 0) throw new Error('still fetching')
  })
  // ⚠ NO EXTRA TIMER TURN HERE, AND THAT IS A MEASURED CHOICE RATHER THAN AN OMISSION. The first
  // version ended with `await new Promise((r) => setTimeout(r, 0))` to let a component commit off
  // the resolved query, and timerCleanup.test.tsx refused it: that sweep looks for a cleanup
  // RETURNED to React (`return () => clearTimeout(...)`), which a module with no component cannot
  // write, so clearing the handle inline did not satisfy it either. Dressing the code up to match
  // a matcher would have been the wrong repair. Measured instead: `waitFor` already retries inside
  // `act`, so by the time its condition holds the commit has happened and the extra turn changed
  // no assertion in any migrated sweep.
}
