import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Overview } from './Overview'

// A fixed clock so the 30-day spend window is deterministic: rows below sit
// inside it, and the derivation (spendMath, unit-tested separately) is exercised
// here against the LIVE history route's shape.
const NOW = new Date('2026-07-22T12:00:00Z')

const HISTORY = [
  { id: 'a', workspace_id: 'trial-ws-1', amount_ulens: 420, balance_after_ulens: 420, type: 'pattern_mine', description: 'pattern shared', metadata: { model_used: 'claude-haiku-4-5' }, created_at: '2026-07-21T10:00:00Z' },
  { id: 'b', workspace_id: 'trial-ws-1', amount_ulens: 180, balance_after_ulens: 600, type: 'pattern_mine', description: 'pattern shared', metadata: { model_used: 'claude-haiku-4-5' }, created_at: '2026-07-21T11:30:00Z' },
  { id: 'c', workspace_id: 'trial-ws-1', amount_ulens: 950, balance_after_ulens: 1550, type: 'pattern_mine', description: 'pattern shared', metadata: { model_used: 'claude-sonnet-5' }, created_at: '2026-07-20T09:15:00Z' },
]

const ROUTES: Record<string, unknown> = {
  '/api/lxc/balance': {
    workspace_id: 'trial-ws-1',
    balance_ulxc: 14999936,
    lifetime_minted_ulxc: 15000000,
    lifetime_spent_ulxc: 64,
    usd_value_uusd: 1499993,
  },
  '/api/tokens/balance': {
    workspace_id: 'trial-ws-1',
    balance_ulens: 1550,
    lifetime_earned_ulens: 1550,
    lifetime_spent_ulens: 0,
    updated_at: '2026-07-19T14:52:59Z',
  },
  '/api/tokens/history': HISTORY,
  '/api/spend/month': { current_month_usd: 12.3456 },
  // The LXC ledger — what inference SPENDS. Raw wire shape (amount_ulxc); the client
  // normalizes. Debits are negative; the grant credit must be excluded from any spend total
  // by sign. Rows DO carry model metadata: Lens stamps requested_model on every agent-lane
  // writer (#343) and served_model on the delivered-charge spend row (#355). This fixture
  // used to say "no model metadata — no LXC writer attaches one", which was true at lens
  // 8c70d9e and had been false for weeks.
  '/api/lxc/history': [
    { id: 'x1', workspace_id: 'trial-ws-1', amount_ulxc: -640000, balance_after_ulxc: 49360000, type: 'spend', description: 'reservation settle: delivered charge', metadata: { requested_model: 'claude-sonnet-5', served_model: 'claude-haiku-4-5', request_id: 'rq1' }, created_at: '2026-07-21T10:00:05Z' },
    { id: 'x2', workspace_id: 'trial-ws-1', amount_ulxc: -1360000, balance_after_ulxc: 48000000, type: 'spend', description: 'reservation settle: delivered charge', metadata: { requested_model: 'claude-sonnet-5', served_model: 'claude-sonnet-5', request_id: 'rq2' }, created_at: '2026-07-20T09:15:05Z' },
    { id: 'x3', workspace_id: 'trial-ws-1', amount_ulxc: 50000000, balance_after_ulxc: 50000000, type: 'admin_grant', description: 'trial onboarding', metadata: {}, created_at: '2026-07-19T08:00:00Z' },
  ],
  // GET /api/usage → Lens /v1/api/usage. REAL numbers on a trial workspace are single
  // digits; the fixture this replaces claimed 1,240 serves at an 87% hit rate.
  '/api/usage': {
    period_days: 30,
    models: [
      { model: 'claude-haiku-4-5', requests: 5, input_tokens: 900, output_tokens: 300, cost_usd: 0.0021, cache_hits: 2 },
      { model: 'claude-sonnet-5', requests: 3, input_tokens: 400, output_tokens: 150, cost_usd: 0.0140, cache_hits: 0 },
    ],
    cache: {
      total_requests: 8,
      cache_hits: 2,
      misses: 6,
      hit_rate: 0.25,
      by_source: { upstream: 6, cache_hit_exact: 2 },
    },
  },
}

interface Stub {
  status?: number
  body: unknown
}

// Route mocked BFF responses by path. Bonds and the two product probes are
// per-test decisions; on this deployment Track/Docs answer 503 (unconfigured).
function mockBff(opts: { bonds?: Stub; track?: Stub; docs?: Stub; usage?: Stub } = {}) {
  const bonds = opts.bonds ?? { body: { capability: 'bonds', enabled: false } }
  const track = opts.track ?? { status: 503, body: { error: 'track upstream not configured on this BFF' } }
  const docs = opts.docs ?? { status: 503, body: { error: 'docs upstream not configured on this BFF' } }
  const usage = opts.usage ?? { body: ROUTES['/api/usage'] }
  const stub = (s: Stub) =>
    new Response(JSON.stringify(s.body), {
      status: s.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/bonds')) return stub(bonds)
    if (url.startsWith('/api/usage')) return stub(usage)
    if (url.startsWith('/api/track/')) return stub(track)
    if (url.startsWith('/api/docs/')) return stub(docs)
    for (const [path, body] of Object.entries(ROUTES)) {
      if (url.startsWith(path)) return stub({ body })
    }
    return new Response('null', { status: 404 })
  })
}

/** A usage body with a chosen cache rollup — for the empty-window case. */
function usageWith(cache: Partial<{ total_requests: number; cache_hits: number; misses: number; hit_rate: number }>): Stub {
  return {
    body: {
      period_days: 30,
      models: [],
      cache: { total_requests: 0, cache_hits: 0, misses: 0, hit_rate: 0, by_source: {}, ...cache },
    },
  }
}

// ⚠ A ROUTER IS REQUIRED NOW, and its absence was invisible. The zero-data empty state links to
// /setup, and every fixture in this file has data — so the branch containing the <Link> never
// rendered and a missing Router would have thrown only for a REAL brand-new user, which is
// exactly the person these screens are for. See the empty-state block at the bottom.
function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Overview now={NOW} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('capability-gated bonds render as state, not fault', () => {
  it('a disabled capability (BFF {enabled:false}) reads as OFF, not an error', async () => {
    mockBff()
    renderOverview()

    // the OFF affordance and its explanatory line appear …
    expect(await screen.findByText('Off')).toBeInTheDocument()
    expect(screen.getByText(/Turned off in this workspace/)).toBeInTheDocument()
    // … and the error copy does NOT (a disabled capability is information)
    expect(screen.queryByText(/Couldn’t load bonds/)).toBeNull()
  })

  it('a genuine failure (500) still surfaces as an error, not a fake OFF', async () => {
    mockBff({ bonds: { status: 500, body: { error: 'boom' } } })
    renderOverview()

    expect(await screen.findByText(/Couldn’t load bonds/)).toBeInTheDocument()
    expect(screen.queryByText('Off')).toBeNull()
  })
})

describe('the two token economies are separated and correctly labelled', () => {
  it('derives EARNED-by-model from the mint ledger and ≈-marks the month float', async () => {
    mockBff()
    renderOverview()

    // mint-attribution rows, largest µ first, request counts as hints. SCOPED to the mint
    // table: the same model now also appears in the LXC spend split, and an unscoped query
    // would resolve to the first match and stop testing the table it names.
    const mint = await screen.findByTestId('lens-by-model')
    expect(mint).toHaveTextContent('claude-sonnet-5')
    expect(mint).toHaveTextContent('claude-haiku-4-5')
    expect(mint).toHaveTextContent('2 requests')
    // the month number is derived upstream → dressed as ≈, never a numeral
    expect(screen.getByText('≈ $12.35')).toBeInTheDocument()
  })

  it('SPENT is LXC and EARNED is LENS — never inverted', async () => {
    mockBff()
    renderOverview()

    // the two section markers, each side wearing its own metal
    expect(await screen.findByText('Spent — LXC')).toBeInTheDocument()
    expect(screen.getByText('Earned — LENS · mint attribution')).toBeInTheDocument()
    expect(screen.getByText('Inference debits')).toBeInTheDocument()
    // the word "Spend" never labels the mint table: the card header carries both
    expect(screen.getByText('Spend & earnings — last 30 days')).toBeInTheDocument()
  })

  it('splits LXC spend per model — and no longer claims it cannot', async () => {
    mockBff()
    renderOverview()

    // x1 was REQUESTED as sonnet and SERVED by haiku, so its charge is attributed to
    // haiku; x2 was served by sonnet. The grant credit (x3) is excluded by sign.
    await waitFor(() => expect(screen.getByText('Spend by model — LXC')).toBeInTheDocument())
    const split = screen.getByTestId('lxc-by-model')
    expect(split).toHaveTextContent('claude-sonnet-5')
    expect(split).toHaveTextContent('claude-haiku-4-5')

    // THE STALE CLAIM IS GONE. It was true at lens 8c70d9e and false from #343 onward.
    expect(screen.queryByText(/carry no model attribution/)).toBeNull()
    expect(screen.queryByText(/no per-model split/)).toBeNull()
  })
})

describe('the cache card reads MEASURED numbers, or says why it cannot', () => {
  it('shows the hits, the ≈-marked rate and the denominator from /api/usage', async () => {
    mockBff()
    renderOverview()

    // 2 hits of 8 recorded requests = 25%. The fixture this replaces said 1,240 / 87%.
    //
    // ⚠ SCOPED, AND IT HAD TO BE. Unscoped, `findByText('2')` resolved on a RACE: the LXC window
    // total in the spend card is 2,000,000 µLXC and renders the whole number "2" in exactly the
    // same string. Two elements answer to it, and which one existed when the poll first ran
    // depended on the order the two queries settled in — so this case was passing on the cache
    // figure only as long as the layout happened to mount the cache card first. The rebuilt
    // screen names its regions, so the query can say which card it means.
    const cacheRegion = within(await screen.findByRole('region', { name: 'What the cache answered' }))
    expect(await cacheRegion.findByText('2')).toBeInTheDocument()
    expect(screen.getByText(/≈ 25%/)).toBeInTheDocument()
    expect(screen.getByText(/8 requests recorded/)).toBeInTheDocument()
    // and it is no longer sample data
    expect(screen.queryByText(/Sample data — awaiting/)).toBeNull()
    expect(screen.queryByText(/≈ 87%/)).toBeNull()
  })

  it('an empty window says so — never 0%, which reads as a measured failure', async () => {
    mockBff({ usage: usageWith({ total_requests: 0 }) })
    renderOverview()

    expect(await screen.findByText(/No requests recorded in this window yet/)).toBeInTheDocument()
    // A 0% hit rate is a real measurement of nothing; showing it would claim the cache
    // never hits. With no denominator there is no rate to show at all.
    expect(screen.queryByText(/≈ 0%/)).toBeNull()
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('a failed read says it could not load — never a plausible number', async () => {
    mockBff({ usage: { status: 500, body: { error: 'boom' } } })
    renderOverview()

    expect(await screen.findByText(/Couldn’t load the cache rate/)).toBeInTheDocument()
    expect(screen.queryByText(/%/)).toBeNull()
    expect(screen.queryByText(/requests recorded/)).toBeNull()
  })
})

describe('the products strip reads unconfigured as calm state', () => {
  it('Track and Docs at 503 show "Not configured", never an error', async () => {
    mockBff()
    renderOverview()

    // findAllByText resolves on the FIRST match; both probes must settle, so wait
    // for the full count instead.
    await waitFor(() => expect(screen.getAllByText('Not configured')).toHaveLength(2))
    expect(screen.queryByText(/Couldn’t load track/i)).toBeNull()
    expect(screen.queryByText(/Couldn’t load docs/i)).toBeNull()
    // Lens itself answered (the balance served) → Configured
    expect(await screen.findByText('Configured')).toBeInTheDocument()
  })
})

// ⚠ 404 IS A STATEMENT ABOUT AN ADDRESS, NOT ABOUT A DEPLOYMENT — and this strip was the
// one place left that still read it as one.
//
// lib/productState.ts removed 404 from `isUnconfigured` and records why in full: the BFF
// asked Docs for a path Docs does not register, and the screen reported "Docs is not
// configured on this deployment — no upstream is wired" while Docs was RUNNING and had just
// served the space list. Our routing bug, rendered as the operator's misconfiguration,
// sending them to check env vars that were correct.
//
// `probeProduct` in Overview.tsx was a SECOND, HAND-ROLLED COPY of that predicate and still
// held `res.status === 503 || res.status === 404 → "off"`. Every other read in the app uses the
// repaired classifier; this was the one site the repair never reached. (The count that stood here
// named `useTrackProbe in areas/track/data.ts` as one of "two other call sites" — that hook is
// deleted, and the count was already stale: seven production call sites in six files at
// `7474125`. The property is what matters here, not the tally.)
//
// MEASURED IN REAL CHROME 151 on the built bundle against the real BFF binary, with only the
// two probe paths' STATUS injected by a front proxy (a genuine upstream 404 needs
// BFF_AUTH_MODE=oidc, which the BFF refuses to pair with a Track/Docs upstream in disabled
// mode). The console's landing screen, counted in the DOM:
//
//   injected   "Not configured"  its hint   "Couldn’t check"   "Configured"
//     200            0               0            0                3
//     404            2               2            0                1     ← indistinguishable
//     503            2               2            0                1     ←   from each other
//     500            0               0            2                1
//
// 404 and 503 are the same picture on the surface an operator reads first.
describe('the products strip does not read a 404 as a deployment fact', () => {
  it('a 404 from a running product surfaces as a fault, never as "Not configured"', async () => {
    const notFound = { status: 404, body: { error: 'not found' } }
    mockBff({ track: notFound, docs: notFound })
    renderOverview()

    // Both probes settle as FAULTS — the state that sends someone to look at the address
    // rather than at their env vars.
    await waitFor(() => expect(screen.getAllByText(/Couldn’t check/)).toHaveLength(2))
    expect(screen.queryAllByText('Not configured')).toHaveLength(0)
    expect(screen.queryAllByText('Not configured on this BFF deployment.')).toHaveLength(0)
    // …and the row that DID answer still reads Configured, so the absence above is not a
    // screen that failed to render.
    expect(screen.getByText('Configured')).toBeInTheDocument()
  })

  it('a 200 still reads Configured on both — the fault path did not swallow the good one', async () => {
    const ok = { body: [] }
    mockBff({ track: ok, docs: ok })
    renderOverview()

    await waitFor(() => expect(screen.getAllByText('Configured')).toHaveLength(3))
    expect(screen.queryAllByText('Not configured')).toHaveLength(0)
    expect(screen.queryAllByText(/Couldn’t check/)).toHaveLength(0)
  })
})

describe('recent activity rides the shared history fetch', () => {
  it('renders ledger rows (capped at five), description first', async () => {
    mockBff()
    renderOverview()

    expect((await screen.findAllByText('pattern shared')).length).toBeGreaterThan(0)
  })
})

// ⚠ THE BRAND-NEW USER. Every other fixture in this file has data, so nothing here described
// what the FIRST person to open this screen actually sees — and "a correct system that explains
// nothing reads as broken" has shipped twice in this project already (a held balance of 0 beside
// a ledger of 822; a Track fault rendered identically to an empty tracker).
//
// This renders the true zero state: no ledger rows, no earnings, no usage. It asserts that each
// empty state names WHAT WOULD PUT SOMETHING THERE, rather than only stating its own emptiness.
describe('a brand-new workspace with zero data', () => {
  const EMPTY: Record<string, unknown> = {
    '/api/lxc/balance': { workspace_id: 'new-ws', balance_ulxc: 0, lifetime_minted_ulxc: 0, lifetime_spent_ulxc: 0, usd_value_uusd: 0 },
    '/api/tokens/balance': { workspace_id: 'new-ws', balance_ulens: 0, lifetime_earned_ulens: 0, lifetime_spent_ulens: 0, updated_at: '2026-07-19T14:52:59Z' },
    '/api/tokens/history': [],
    '/api/lxc/history': [],
    '/api/spend/month': { current_month_usd: 0 },
  }

  function mockEmpty() {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      const json = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
      if (url.startsWith('/api/bonds')) return json({ capability: 'bonds', enabled: false })
      if (url.startsWith('/api/usage')) return json(usageWith({}).body)
      if (url.startsWith('/api/track/')) return json({ error: 'track upstream not configured on this BFF' }, 503)
      if (url.startsWith('/api/docs/')) return json({ error: 'docs upstream not configured on this BFF' }, 503)
      for (const [path, body] of Object.entries(EMPTY)) {
        if (url.startsWith(path)) return json(body)
      }
      return new Response('null', { status: 404 })
    })
  }

  it('the activity empty state names the action that creates the first entry, and links to it', async () => {
    mockEmpty()
    renderOverview()

    // It must not merely state its own emptiness…
    expect(await screen.findByText(/No activity yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/^No ledger entries yet\.$/)).toBeNull()
    // …it must say what puts a row there, and offer the way to do it.
    expect(screen.getByText(/first entry appears the moment a request goes through Lens/i)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /point a tool at it/i })
    expect(link).toHaveAttribute('href', '/setup')
  })

  it('the earnings empty state explains what earning requires', async () => {
    mockEmpty()
    renderOverview()

    expect(await screen.findByText(/No earnings yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/No mint-attributed LENS rows in the window yet/i)).toBeNull()
    expect(screen.getByText(/served an answer this workspace produced/i)).toBeInTheDocument()
  })

  it('a zero balance renders as a balance, not as a failure', async () => {
    mockEmpty()
    renderOverview()
    // The distinction that has bitten twice: empty is a STATE, a fault is an ERROR.
    expect(await screen.findByText(/No activity yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/Couldn’t load/i)).toBeNull()
    // Held is absent entirely at zero — a permanent "Held 0" would be noise.
    expect(screen.queryByText(/Held — not yet spendable/)).toBeNull()
  })

  // ⚠ THE SCREEN-LEVEL EMPTY STATE, WHICH IS THE ONE A NEW SIGNUP ACTUALLY MEETS. Every case
  // above tests ONE panel's emptiness; the person opening this screen for the first time meets
  // all six at once — six zeros and no next action anywhere above the fold. The three panels
  // that DO name an action (activity, earnings, cache) name three different ones, none of which
  // is "you have no LXC".
  it('names both first steps and links to them', async () => {
    mockEmpty()
    renderOverview()

    expect(
      await screen.findByRole('heading', { name: /nothing has arrived in this workspace yet/i }),
    ).toBeInTheDocument()
    // It must say WHAT IS ZERO — both tokens — rather than only that something is missing.
    expect(screen.getByText(/no LXC has been granted, bought or converted/i)).toBeInTheDocument()

    // Two steps, each a real destination in this app.
    expect(screen.getByRole('link', { name: /open setup/i })).toHaveAttribute('href', '/setup')
    expect(screen.getByRole('link', { name: /open billing/i })).toHaveAttribute('href', '/billing')
  })

  // ⚠ THE CONTROL THAT KEEPS "EMPTY" AND "BROKEN" APART. A balance that could not be READ is not
  // a balance of zero, and this project has shipped that conflation twice (a Track fault drawn
  // identically to an empty tracker; a held balance of 0 beside a ledger of 822). If the
  // predicate treated a failed read as zero, a workspace with money in it would be told, on the
  // first screen after sign-in, that nothing had ever arrived.
  it('does NOT claim a first run when a balance read FAILED', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      const json = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
      // LENS answers all-zero; LXC — the token that would say "you have nothing" — 500s.
      if (url.startsWith('/api/lxc/balance')) return json({ error: 'boom' }, 500)
      if (url.startsWith('/api/tokens/balance')) return json(EMPTY['/api/tokens/balance'])
      if (url.startsWith('/api/bonds')) return json({ capability: 'bonds', enabled: false })
      if (url.startsWith('/api/usage')) return json(usageWith({}).body)
      if (url.startsWith('/api/track/') || url.startsWith('/api/docs/')) return json({ error: 'x' }, 503)
      for (const [path, body] of Object.entries(EMPTY)) {
        if (url.startsWith(path)) return json(body)
      }
      return new Response('null', { status: 404 })
    })
    renderOverview()

    // The failure is reported as a failure …
    expect(await screen.findByText(/Couldn’t load the LXC balance/i)).toBeInTheDocument()
    // … and the screen does not tell a paying workspace that it has never had anything.
    expect(screen.queryByText(/nothing has arrived in this workspace yet/i)).toBeNull()
    expect(screen.queryByRole('link', { name: /open billing/i })).toBeNull()
  })

  it('a workspace that HAS held something never sees the first steps', async () => {
    mockBff()
    renderOverview()

    expect(await screen.findByRole('heading', { name: /everything this workspace has/i })).toBeInTheDocument()
    expect(screen.queryByText(/nothing has arrived in this workspace yet/i)).toBeNull()
    expect(screen.queryByRole('link', { name: /open setup/i })).toBeNull()
  })
})

// ── THE SHAPE OF THE SCREEN (W1.1.1) ──────────────────────────────────────────────────────────
//
// What this replaced: six cards in a two-column grid, no heading of the screen's own, and no
// label above any group of them. The sticky banner wrote "Overview" and everything below it was
// one undifferentiated run of panels — so the screen's own source could describe five questions
// it answers "in order" while the rendered page named none of them.
//
// The rebuild is the public site's section marking (accent tick · mono index · the one uppercase
// eyebrow) carried into the console's type scale, ONE page-scale heading, and five NAMED
// landmarks instead of one anonymous block.
describe('the screen reads as regions, in the site’s language', () => {
  it('opens with one page-scale heading, and it is an h2 under the shell’s h1', async () => {
    mockBff()
    renderOverview()

    const opening = await screen.findByRole('heading', { name: /everything this workspace has/i })
    // NOT an h1: the shell already writes exactly one per address (#126, #127), and a second
    // would be a second claim about what the page is. IssueDetail settled this shape already.
    expect(opening.tagName).toBe('H2')
    // `text-title` IS the page scale behind the gate — the top of the console ramp, 24px. The
    // marketing display steps stop at the gate (displayScale.test.ts), so this is the largest
    // type a console screen may write, and it had never been written on this one.
    expect(opening.className).toContain('text-title')
    expect(document.querySelectorAll('.text-title')).toHaveLength(1)
  })

  it('every region is a landmark named by its own uppercase eyebrow', async () => {
    mockBff()
    renderOverview()
    await screen.findByText('Spend & earnings — last 30 days')

    const regions = screen.getAllByRole('region')
    expect(
      regions.map((r) => r.getAttribute('aria-label') ?? document.getElementById(r.getAttribute('aria-labelledby') ?? '')?.textContent?.trim()),
      'the five questions this screen answers, in the order its own source declares them — plus ' +
        'the opening. A region with no name is a section a rotor cannot list.',
    ).toEqual([
      'Everything this workspace has, spends and earns.',
      'What you have',
      'What it costs, and what it earns',
      'What the cache answered',
      'What is switched on',
      'What just happened',
    ])
  })

  it('each region label wears the eyebrow token AND its casing, with the accent on a tick', async () => {
    mockBff()
    renderOverview()
    await screen.findByText('Spend & earnings — last 30 days')

    const labels = Array.from(document.querySelectorAll('[data-testid="region-label"]'))
    expect(labels.length, 'no region labels rendered — the assertions below would be vacuous').toBe(6)
    for (const l of labels) {
      const eyebrow = l.querySelector('.text-eyebrow')!
      expect(eyebrow.className, `"${eyebrow.textContent}" is not on the eyebrow token`).toContain('text-eyebrow')
      // The casing travels in the same class list as the token — the eyebrow sweep's rule.
      expect(eyebrow.className).toContain('uppercase')
      // Colour lands on a TICK, never on text: the invariant the whole palette rests on.
      expect(l.querySelector('.bg-accent'), 'the region marking lost its accent tick').toBeTruthy()
    }
    // Every index is a numeral, so every index is on the figure face.
    const indexes = Array.from(document.querySelectorAll('[data-testid="region-index"]'))
    expect(indexes.map((i) => i.textContent)).toEqual(['00', '01', '02', '03', '04', '05'])
    for (const i of indexes) expect(i.className).toContain('font-figure')
  })
})
