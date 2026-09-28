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
  '/api/ai/providers': { unconfigured: [] },

  '/api/lxc/topup-options': { allowed_usd_cents: [1000, 2500, 5000], billing_enabled: true },

  // B18.61 — the subscriber's plan renews at the end of the period.
  '/api/billing/subscription': {
    capability: 'subscriptions',
    enabled: true,
    data: { subscribed: true, status: 'active', current_period_end: '2026-09-01T00:00:00Z', cancel_at_period_end: false, livemode: false },
  },
  '/api/billing/allowance': {
    capability: 'subscriptions',
    enabled: true,
    data: {
      allowance: {
        period_start: '2026-08-01T00:00:00Z',
        period_end: '2026-09-01T00:00:00Z',
        granted_ulxc: 200_000_000,
        consumed_ulxc: 50_000_000,
        remaining_ulxc: 150_000_000,
        fee_usd_cents: 2000,
      },
      earned_ulens: 9_000_000,
      earned_held_ulens: 0,
      earned_usd_cents: 600,
      earned_back_usd_cents: 600,
    },
  },

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
  // B8.2 — the Features screen reads every capability setting on the workspace.
  '/api/features': {
    tare_policy: 'disabled',
    distill_policy: 'always',
    compression_policy: 'disabled',
    logging_policy: 'metadata',
    cache_poolable: false,
    distill_poolable: false,
    cost_optimize_routing: false,
    guardrails: { injection: true, pii: true },
  },
  // B11.2 — Tare's savings, summed by the BFF from Lens's per-work-item rows.
  '/api/features/tare-savings': { requests: 14, tokens_before: 52_000, tokens_after: 18_500, cost_saved_usd: 0.084 },
  // B18.22 — the workspace's spending limit, as GET /api/features/budget projects Lens's budget.
  '/api/features/budget': {
    budget: { period: 'monthly', limit_usd: 200, spent_usd: 48.3, enforcement: 'hard_block' },
    several: false,
  },
  // B21.4 — what the workspace has stored, and its requests to delete everything.
  '/api/features/stored-answers': {
    shared_answers: 12,
    private_answers: 30,
    shared_conversions: 2,
    private_conversions: 5,
    confirm_with: 'ws_populated',
  },
  '/api/features/deletion-requests': { requests: [{ id: 1, status: 'requested', requested_at: '2026-09-27T12:00:00Z' }] },
  // B19.4 — the Agent Bank: two agents, one funded with rules, one payment waiting for a person.
  // B20.3 — the marketplace catalog: a paid prompt and a free agent another workspace published.
  '/api/marketplace/listings': {
    listings: [
      { id: 'lst_translate', workspace_id: 'ws-seller', kind: 'prompt', title: 'Translate to French', description: 'Idiomatic French for any English text.', price_per_use_ulxc: 500_000, visibility: 'public', latest_version: 2, created_at: '2026-09-27T09:00:00Z', updated_at: '2026-09-27T10:00:00Z' },
      { id: 'lst_review', workspace_id: 'ws-seller', kind: 'agent', title: 'Code reviewer', description: 'Reviews a diff for correctness.', price_per_use_ulxc: 0, visibility: 'public', latest_version: 1, created_at: '2026-09-27T11:00:00Z', updated_at: '2026-09-27T11:00:00Z' },
    ],
  },
  '/api/agents': {
    workspace_balance_ulxc: 100_000_000,
    allocated_ulxc: 12_500_000,
    unallocated_ulxc: 87_500_000,
    spent_ulxc: 1_250_000,
    agents: [
      { id: 'agt_research', name: 'Researcher', balance_ulxc: 10_000_000, spent_ulxc: 1_250_000, keys: ['key_1'], created_at: '2026-09-27T09:00:00Z' },
      { id: 'agt_writer', name: 'Writer', balance_ulxc: 2_500_000, spent_ulxc: 0, keys: [], created_at: '2026-09-27T09:05:00Z' },
    ],
  },
  // B19.10 — no passkey yet, so approvals are sent unsigned, as B19.4 sends them.
  '/api/agents/passkeys': { passkeys: [] },
  // B19.21 — a weekly payment from the Researcher to the Writer, and the Researcher's top-up.
  '/api/agents/schedules': {
    schedules: [{ id: 'sch_1', from_agent_id: 'agt_research', to_agent_id: 'agt_writer', amount_ulxc: 1_000_000, memo: 'drafts', every: 'week', next_run_at: '2026-10-05T09:00:00Z', active: true, created_at: '2026-09-28T09:00:00Z' }],
  },
  '/api/agents/agt_research/topup': { agent_id: 'agt_research', below_ulxc: 5_000_000, to_ulxc: 8_000_000 },
  // B19.24 — the researcher's test-mode card: one purchase approved within its rules, one declined above them.
  '/api/agents/agt_research/card': {
    card: { id: 'ic_research', agent_id: 'agt_research', last4: '4242', exp_month: 9, exp_year: 2029, currency: 'gbp', livemode: false, created_at: '2026-09-28T09:00:00Z' },
    authorizations: [
      { id: 'cauth_2', authorization_id: 'iauth_2', approved: false, reason: "the agent's spending rules refuse this request: this payment would cost up to 27.943501 LXC; the agent's limit per request is 20 LXC", amount_minor: 200, currency: 'gbp', merchant_name: 'Compute shop', merchant_category: 'computer_software_stores', rate_date: '2026-09-25T00:00:00Z', ecb_usd_per_eur: '1.1672', ecb_currency_per_eur: '0.8354', created_at: '2026-09-28T10:05:00Z' },
      { id: 'cauth_1', authorization_id: 'iauth_1', approved: true, reason: "within the agent's rules and balance", amount_minor: 100, currency: 'gbp', merchant_name: 'Compute shop', merchant_category: 'computer_software_stores', rate_date: '2026-09-25T00:00:00Z', ecb_usd_per_eur: '1.1672', ecb_currency_per_eur: '0.8354', amount_usd_micros: 1_397_176, amount_ulxc: 13_971_751, created_at: '2026-09-28T10:00:00Z' },
    ],
  },
  // B19.20 — this month's forecast, and one unusual-spend alert that paused an agent.
  '/api/agents/forecast': {
    at: '2026-09-15T00:00:00Z',
    month_start: '2026-09-01T00:00:00Z',
    month_end: '2026-10-01T00:00:00Z',
    spent_ulxc: 1_250_000,
    forecast_ulxc: 2_500_000,
    agents: [{ agent_id: 'agt_research', name: 'Researcher', spent_ulxc: 1_250_000, forecast_ulxc: 2_500_000 }],
  },
  '/api/agents/alerts': {
    alerts: [{ id: 'al_1', agent_id: 'agt_research', last_hour_ulxc: 600_000, usual_per_hour_ulxc: 100_000, paused: true, created_at: '2026-09-27T12:00:00Z' }],
    rule: 'An alert is raised when an agent spends five times its usual hourly rate.',
  },
  '/api/agents/approvals': {
    approvals: [
      { id: 'apr_1', agent_id: 'agt_research', amount_ulxc: 3_000_000, model: '', status: 'pending', created_at: '2026-09-27T12:30:00Z' },
    ],
  },
  '/api/agents/agt_research/rules': {
    max_per_request_ulxc: 0,
    daily_limit_ulxc: 5_000_000,
    monthly_limit_ulxc: 0,
    approval_above_ulxc: 2_000_000,
    allowed_models: null,
    allowed_providers: null,
    active_from: '',
    active_until: '',
    timezone: '',
  },
  '/api/agents/agt_research/statement': {
    agent_id: 'agt_research',
    lines: [
      { entry_id: 'e2', kind: 'spend', amount_ulxc: -1_250_000, counterparty: 'spend', balance_after_ulxc: 10_000_000, at: '2026-09-27T11:00:00Z' },
      { entry_id: 'e1', kind: 'fund', amount_ulxc: 11_250_000, counterparty: 'workspace', balance_after_ulxc: 11_250_000, at: '2026-09-27T10:00:00Z' },
    ],
  },
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
  '/api/models/waiting': [
    { provider: 'openai', id: 'gpt-6-nova', first_seen_at: '2026-09-26T01:00:00Z', needs_price: true },
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
  // B4.2 — the issue list's Project filter reads the workspace's projects.
  '/api/track/projects': [
    { id: 'pr-1', team_id: 'team-1', name: 'Importer', identifier: 'IMP', description: '', status: 'active' },
  ],
  // B18.27 — the sidebar's pinned Docs pages, kept by Docs.
  '/api/docs/pins': [],
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
