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
  // B27.30 — a published board, at the address the public-route sweeps visit (`/board/:token`).
  '/api/public/boards/%3Atoken': {
    workspace: 'Fixture workspace',
    issues: [
      { identifier: 'IMP-1', title: 'Importer drops the last row', status: 'in_progress', priority: 2, updated_at: '2026-08-20T00:00:00Z' },
      { identifier: 'IMP-2', title: 'Map Jira priorities on import', status: 'todo', priority: 0, updated_at: '2026-08-19T00:00:00Z' },
    ],
    truncated: false,
  },
  // B28.127 — a shared chat, at the address the public-route sweeps visit (`/share/:token`).
  '/api/public/chats/%3Atoken': {
    title: 'Why the importer drops the last row',
    created_at: '2026-08-20T00:00:00Z',
    messages: [
      { role: 'user', content: 'Why does the importer drop the last row of a CSV file that has no newline at the end?' },
      { role: 'assistant', content: 'It splits on newlines and discards the final piece as empty. Keep the last piece when it holds text.' },
    ],
  },
  // B27.15 — Docs counts the fixture's person as a member, so the sidebar reads its pins.
  '/api/docs/membership': { member: true },
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
  '/api/savings/month': { month_start: '2026-09-01T00:00:00Z', saved_usd: 3.21, list_usd: 15.55, charged_usd: 12.34, requests: 1_200, unmeasured_requests: 0 },
  '/api/ai/providers': { unconfigured: [] },
  // B28.99 — Chat reads the wallet tools on load: they are part of the price it shows before a question is sent.
  '/api/chat/tools': { tools: [] },
  // B28.370 — and the workspace's prompt library, offered under the box.
  '/api/chat/prompts': { prompts: [{ name: 'support-tone', version: 2, description: 'Replies to customers', content: 'Answer as a calm support agent.' }] },

  // The BFF's capability envelope (apps/bff/lens.go#forwardGated), never a bare list. This was
  // `[{ id: 'bond-1', … }]`, which the screen read as switched off; off is what it showed, so off
  // is what it answers now that a bare list is refused as unreadable (B27.12).
  '/api/bonds': { capability: 'bonds', enabled: false },

  '/api/lxc/topup-options': { allowed_usd_cents: [1000, 2500, 5000], billing_enabled: true },

  // B28.5 — the public price list, with each plan's included usage as Lens states it (B28.439, h = 0).
  '/api/pricing': {
    usd_per_lxc: 0.1,
    min_usd_cents: 1000,
    max_usd_cents: 1000000,
    preset_usd_cents: [1000, 5000, 10000],
    plans: [
      { id: 'plus', usd_cents: 2000, included_ulxc: 191_200_000 },
      { id: 'pro', usd_cents: 10000, included_ulxc: 968_000_000 },
      { id: 'max', usd_cents: 20000, included_ulxc: 1_939_000_000 },
    ],
  },

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

  // B27.27 — Settings' "Your provider keys": the fixture's plan is Plus, so not BYOK and no key held.
  '/api/provider-keys': {
    capability: 'provider_keys',
    enabled: true,
    data: { byok: false, providers: ['anthropic', 'google', 'groq', 'mistral', 'openai'], keys: [] },
  },

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
    reuses: 4,
    helped_workspaces: 3,
  },
}

/** Bodies for endpoints whose URL carries a query string — matched on pathname. */
const BY_PATH: Record<string, unknown> = {
  // B8.2 — the Features screen reads every capability setting on the workspace.
  '/api/features': {
    tare_policy: 'disabled',
    tare_model: false,
    distill_policy: 'always',
    compression_policy: 'disabled',
    logging_policy: 'metadata',
    cache_poolable: false,
    distill_poolable: false,
    cost_optimize_routing: false,
    guardrails: { injection: true, pii: true },
    pattern_mining: { opted_in: false, enabled: true },
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
  // B32.53 — rooms: one this workspace is in, one open room it is not, and its Free plan's room limits.
  '/api/rooms': {
    rooms: [
      { id: 'room_pricing', owner_workspace_id: 'ws_populated', title: 'Agent pricing research', topic: 'research', description: 'What agents pay for, and what they should.', visibility: 'public', status: 'open', terms_version: 1, member_count: 3, created_at: '2026-10-05T09:00:00Z', last_activity_at: '2026-10-06T16:00:00Z' },
      { id: 'room_evals', owner_workspace_id: 'ws-seller', title: 'Open-source evals', topic: 'evaluation', description: 'Evaluations anyone can run.', visibility: 'public', status: 'open', terms_version: 2, member_count: 12, created_at: '2026-10-04T09:00:00Z', last_activity_at: '2026-10-06T12:00:00Z' },
    ],
    joined: [
      { id: 'room_pricing', owner_workspace_id: 'ws_populated', title: 'Agent pricing research', topic: 'research', description: 'What agents pay for, and what they should.', visibility: 'public', status: 'open', terms_version: 1, member_count: 3, created_at: '2026-10-05T09:00:00Z', last_activity_at: '2026-10-06T16:00:00Z' },
    ],
    invited: null,
    limits: { plan: 'free', limit_as: 'free', public_rooms: 3, private_rooms: 0, members_per_room: 50, agents_per_room: 10, room_budget_max_usd: 100, public_rooms_open: 1, private_rooms_open: 0 },
  },
  // B18.25 — the operator screen: one busy workspace and one that never made a request.
  '/api/admin/workspaces': {
    workspaces: [
      { id: 'ws-acme', name: 'Acme', created_at: '2026-08-01T00:00:00Z', current_month_usd: 12.34, all_time_usd: 80.5, requests: 1_200, held_ulens: 822, last_request_at: '2026-09-27T09:00:00Z' },
      { id: 'ws-quiet', name: 'Quiet', created_at: '2026-09-01T00:00:00Z', current_month_usd: 0, all_time_usd: 0, requests: 0, held_ulens: 0, last_request_at: null },
    ],
  },
  // B27.19 — one marketplace use Stripe refused too often to keep retrying.
  '/api/admin/marketplace/parked-uses': {
    parked_uses: [
      { id: 'use_parked', listing_id: 'lst_translate', buyer_workspace_id: 'ws-acme', price_ulxc: 500_000, used_at: '2026-09-27T09:30:00Z', refusals: 5, reason: "resource_missing: No such customer: 'cus_gone'", parked_at: '2026-09-28T12:00:00Z' },
    ],
  },
  // B27.29 — the operator trail: a listing taken down, then one approved.
  '/api/admin/operator-audit': {
    entries: [
      { id: 2, actor: 'ops@example.com sub=110248495', action: 'marketplace.listing.approve', target: 'listing:lst_review', detail: '', occurred_at: '2026-09-28T10:05:00Z', recorded_at: '2026-09-28T10:05:00Z' },
      { id: 1, actor: 'ops@example.com sub=110248495', action: 'marketplace.listing.takedown', target: 'listing:lst_leak', detail: 'exposes a live key', occurred_at: '2026-09-28T10:00:00Z', recorded_at: '2026-09-28T10:00:00Z' },
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
  // B28.377 — a prompt the Researcher asks every morning, with its first answer and what it cost.
  '/api/agents/prompt-schedules': {
    schedules: [
      {
        id: 'psc_1', agent_id: 'agt_research', prompt: 'Summarise what the agents spent yesterday.', provider: 'anthropic', model: 'claude-haiku-4-5',
        every: 'day', next_run_at: '2026-10-06T08:00:00Z', active: true, created_at: '2026-10-04T08:00:00Z',
        runs: [{ ran_at: '2026-10-05T08:00:00Z', outcome: 'answered', answer: 'The agents spent 2.40 LXC yesterday.', request_id: 'req_s1', charged_ulxc: 1_200, entry_id: 'ent_s1' }],
      },
    ],
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
      {
        id: 'apr_1', agent_id: 'agt_research', amount_ulxc: 3_000_000, model: '', status: 'pending', created_at: '2026-09-27T12:30:00Z',
        payee: { kind: 'company', id: 'ws_acme', name: 'Acme Hosting' }, memo: 'October invoice',
      },
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
  // B28.31 — the Researcher's rules history: saved with a 5 LXC daily limit, then a person asked to approve above 2 LXC.
  '/api/agents/agt_research/rules/history': {
    versions: [
      {
        version: 2,
        rules: { max_per_request_ulxc: 0, daily_limit_ulxc: 5_000_000, monthly_limit_ulxc: 0, approval_above_ulxc: 2_000_000, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '' },
        changed_by: 'jwt:user:ws_1',
        change: 'set',
        created_at: '2026-09-27T12:00:00Z',
      },
      {
        version: 1,
        rules: { max_per_request_ulxc: 0, daily_limit_ulxc: 5_000_000, monthly_limit_ulxc: 0, approval_above_ulxc: 0, allowed_models: null, allowed_providers: null, active_from: '', active_until: '', timezone: '' },
        changed_by: 'jwt:user:ws_1',
        change: 'set',
        created_at: '2026-09-26T09:00:00Z',
      },
    ],
  },
  // B28.32 — the Researcher's daily limit raised from 5 LXC to 8 LXC until the evening.
  '/api/agents/agt_research/rules/boosts': {
    boosts: [{ rule: 'daily_limit_ulxc', raised_from: 5_000_000, value: 8_000_000, until: '2099-09-27T18:00:00Z', created_by: 'jwt:user:ws_1', created_at: '2026-09-27T12:30:00Z' }],
  },
  // B28.6 — the Writer's budget: Home draws each agent's monthly limit against its month's spend.
  '/api/agents/agt_writer/rules': {
    max_per_request_ulxc: 0,
    daily_limit_ulxc: 0,
    monthly_limit_ulxc: 10_000_000,
    approval_above_ulxc: 0,
    allowed_models: null,
    allowed_providers: null,
    active_from: '',
    active_until: '',
    timezone: '',
  },
  // B22.10 — money between owners: the classes, a transfer each way, an incoming request, a company credit line
  // and a loan being repaid.
  '/api/wallets/capabilities': {
    capabilities: [
      { capability: 'spend_on_talyvor', name: 'Spending on Talyvor', class: 'GREEN', real_money: true },
      { capability: 'pay_another_owner', name: 'Sending and requesting money between different owners', class: 'AMBER', real_money: false },
      { capability: 'company_credit_line', name: 'Talyvor’s credit line to companies, for Talyvor services', class: 'GREEN', real_money: true },
      { capability: 'loans_between_companies', name: 'Loans between companies', class: 'AMBER', real_money: false },
      { capability: 'rules_approvals_statements_pots', name: 'Rules, approvals, statements and pots', class: 'GREEN', real_money: true },
      { capability: 'escrow', name: 'Escrow between agents', class: 'AMBER', real_money: false },
      { capability: 'cash_out', name: 'Cashing credits out as money', class: 'RED', real_money: false },
      { capability: 'invest_and_trade', name: 'Investing and trading real assets', class: 'RED', real_money: false },
    ],
  },
  '/api/agents/agt_research/transfers': {
    transfers: [
      { id: 'xfer_2', from_workspace_id: 'ws-other', from_agent_id: 'agt_bea', to_workspace_id: 'ws-1', to_agent_id: 'agt_research', amount_ulxc: 2_000_000, memo: 'expenses', class: 'AMBER', test_funded_ulxc: 2_000_000, created_at: '2026-09-28T12:00:00Z' },
      { id: 'xfer_1', from_workspace_id: 'ws-1', from_agent_id: 'agt_research', to_workspace_id: 'ws-other', to_agent_id: 'agt_bea', amount_ulxc: 5_000_000, memo: 'design work', class: 'AMBER', test_funded_ulxc: 5_000_000, created_at: '2026-09-28T11:00:00Z' },
    ],
  },
  // B28.355 — Chat names another company's agent by its wallet, as Send does.
  '/api/wallets/address/agt_bea': { wallet_id: 'agt_bea', name: 'Bea' },
  '/api/wallets/requests': {
    requests: [
      { id: 'mreq_1', from_workspace_id: 'ws-other', from_agent_id: 'agt_bea', to_workspace_id: 'ws-1', to_agent_id: 'agt_research', amount_ulxc: 1_000_000, memo: 'invoice 12', status: 'pending', created_at: '2026-09-28T13:00:00Z' },
    ],
  },
  '/api/wallets/credit-line': {
    workspace_id: 'ws-1',
    limit_ulxc: 100_000_000,
    used_ulxc: 30_000_000,
    available_ulxc: 70_000_000,
    paused: false,
    invoices: [{ id: 'cli_1', period_end: '2026-09-01T00:00:00Z', amount_ulxc: 12_000_000, amount_cents: 120, due_at: '2026-09-15T00:00:00Z', paid_at: '2026-09-10T00:00:00Z', late: false }],
  },
  '/api/wallets/loans': {
    loans: [
      {
        id: 'loan_1', lender_workspace_id: 'ws-1', lender_agent_id: 'agt_research', borrower_workspace_id: 'ws-other', borrower_agent_id: 'agt_co',
        principal_ulxc: 50_000_000, interest_bps: 500, instalments: 5, every: 'month', late_fee_ulxc: 1_000_000, memo: 'working capital',
        status: 'active', paid_instalments: 1, next_due_at: '2026-10-28T09:00:00Z', offered_at: '2026-08-27T09:00:00Z', decided_at: '2026-08-28T09:00:00Z',
        events: [
          { kind: 'payout', principal_ulxc: 50_000_000, transfer_id: 'xfer_p', at: '2026-08-28T09:00:00Z' },
          { kind: 'instalment', instalment: 1, principal_ulxc: 10_000_000, interest_ulxc: 500_000, transfer_id: 'xfer_i1', at: '2026-09-28T09:00:00Z' },
        ],
      },
    ],
  },
  // B22.12 — escrow, pots, simulated investing and cash-out: an escrow held for another owner's agent, a locked
  // pot, a portfolio holding euros with a filled and an open order, and a cash-out with the partner.
  '/api/wallets/escrows': {
    escrows: [
      {
        id: 'esc_1', payer_workspace_id: 'ws-1', payer_agent_id: 'agt_research', payee_workspace_id: 'ws-other', payee_agent_id: 'agt_bea',
        amount_ulxc: 8_000_000, memo: 'logo design', class: 'AMBER', test_funded_ulxc: 8_000_000, release_at: '2026-10-12T00:00:00Z',
        status: 'held', created_at: '2026-09-28T10:00:00Z', events: [{ kind: 'held', actor: 'payer', at: '2026-09-28T10:00:00Z' }],
      },
    ],
  },
  '/api/agents/agt_research/pots': {
    pots: [
      { id: 'pot_1', agent_id: 'agt_research', name: 'Conference', kind: 'goal', target_ulxc: 30_000_000, locked_until: '2026-12-01T00:00:00Z', balance_ulxc: 12_000_000, created_at: '2026-09-01T09:00:00Z' },
    ],
  },
  '/api/wallets/quotes': {
    simulated: true,
    market_data: 'European Central Bank euro foreign exchange reference rates (source: ECB, free at www.ecb.europa.eu)',
    rate_date: '2026-09-28',
    quotes: [
      { instrument: 'EUR', price_usd: '1.08000000', rate_date: '2026-09-28' },
      { instrument: 'GBP', price_usd: '1.30000000', rate_date: '2026-09-28' },
    ],
  },
  '/api/agents/agt_research/portfolios': {
    notice: 'Simulated: executed by Talyvor’s simulator at the ECB reference rate. No order is ever sent to a market.',
    portfolios: [
      {
        id: 'pf_1', agent_id: 'agt_research', name: 'FX test', simulated: true,
        notice: 'Simulated: executed by Talyvor’s simulator at the ECB reference rate. No order is ever sent to a market.',
        market_data: 'European Central Bank euro foreign exchange reference rates (source: ECB, free at www.ecb.europa.eu)',
        rate_date: '2026-09-28', starting_cash_uusd: 10_000_000_000, cash_uusd: 8_920_000_000, value_uusd: 10_000_000_000,
        positions: [{ instrument: 'EUR', quantity_micros: 1_000_000_000, price_usd: '1.08000000', value_uusd: 1_080_000_000 }],
        orders: [
          { id: 'ord_2', portfolio_id: 'pf_1', instrument: 'GBP', side: 'buy', type: 'limit', quantity_micros: 500_000_000, limit_price_usd: '1.25', status: 'open', cash_uusd: 0, simulated: true, created_at: '2026-09-28T11:00:00Z' },
          { id: 'ord_1', portfolio_id: 'pf_1', instrument: 'EUR', side: 'buy', type: 'market', quantity_micros: 1_000_000_000, status: 'filled', fill_price_usd: '1.08000000', fill_rate_date: '2026-09-28', cash_uusd: -1_080_000_000, simulated: true, created_at: '2026-09-28T10:30:00Z' },
        ],
        created_at: '2026-09-28T10:00:00Z',
      },
    ],
  },
  '/api/wallets/cash-outs': {
    cash_outs: [
      { id: 'co_1', workspace_id: 'ws-1', agent_id: 'agt_research', amount_ulxc: 5_000_000, amount_uusd: 50_000, test_funded_ulxc: 5_000_000, destination: 'Operating account', partner: 'test', partner_ref: 'test_co_1', status: 'submitted', created_at: '2026-09-28T12:00:00Z' },
    ],
  },
  '/api/agents/agt_research/statement': {
    agent_id: 'agt_research',
    lines: [
      // B28.356 — a call's lines name its model and source (B28.93), which Chat's Recent calls shows.
      { entry_id: 'e2', kind: 'spend', amount_ulxc: -1_250_000, counterparty: 'spend', ref: 'req_1', model: 'claude-sonnet-4', source: 'Chat', balance_after_ulxc: 10_000_000, at: '2026-09-27T11:00:00Z' },
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
    { feature: 'chat', cost_usd: 2.35, requests: 96 },
    { feature: 'docs.ask', cost_usd: 1.1, requests: 42 },
    { feature: 'track.triage', cost_usd: 0.4, requests: 12 },
  ],
  '/api/models': [
    { id: 'claude-sonnet-4', provider: 'anthropic', display_name: 'Claude Sonnet 4', input_per_1m: 3, output_per_1m: 15, release_date: '2025-05-22', tier: 'balanced' },
    { id: 'gpt-4o-mini', provider: 'openai', display_name: 'GPT-4o mini', input_per_1m: 0.15, output_per_1m: 0.6, release_date: '2024-07-18', tier: 'fast' },
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
  // B27.30 — the board link's live list, on /track/board.
  '/api/track/boards': [],
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
