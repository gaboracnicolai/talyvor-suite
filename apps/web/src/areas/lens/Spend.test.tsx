import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Spend } from './Spend'
import type { SpendLedgerRow } from './spendMath'

// Mint-ledger sample rows. Declared HERE, in the test, not exported from a module a screen
// could import — the distinction areas/lens/fixtures.ts failed to hold.
const fixtureSpendRows: SpendLedgerRow[] = [
  { id: 'l1', amount_ulens: 420, type: 'pattern_mine', created_at: '2026-07-21T10:00:00Z', metadata: { model_used: 'claude-haiku-4-5' } },
  { id: 'l2', amount_ulens: 180, type: 'pattern_mine', created_at: '2026-07-21T11:30:00Z', metadata: { model_used: 'claude-haiku-4-5' } },
  { id: 'l3', amount_ulens: 950, type: 'pattern_mine', created_at: '2026-07-20T09:15:00Z', metadata: { model_used: 'claude-sonnet-5' } },
  { id: 'l4', amount_ulens: 60, type: 'pattern_mine_held', created_at: '2026-07-05T08:00:00Z', metadata: { model_used: 'claude-haiku-4-5' } },
]


// /spend is LIVE on /api/tokens/history now (the route existed all along; the
// shared scaffold test was what forced fixture rows). The pure spendMath
// derivation is unchanged, so the pinned numbers here are the SAME numbers the
// fixture version showed — the data source swapped, the maths did not. The
// month card reads /api/spend/month, and the cache card now reads /api/usage — the
// endpoint Lens had all along while this screen drew an invented 87%.

const NOW = new Date('2026-07-22T12:00:00Z')

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      const json = (v: unknown) =>
        new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (path.includes('/api/tokens/history')) return json(fixtureSpendRows)
      if (path.includes('/api/spend/month')) return json({ current_month_usd: 4.31 })
      // The LXC ledger — inference debits (negative) + a grant credit. Raw wire shape,
      // carrying the model metadata Lens stamps (#343 requested_model, #355 served_model).
      if (path.includes('/api/lxc/history'))
        return json([
          { id: 'x1', workspace_id: 'w', amount_ulxc: -640000, balance_after_ulxc: 49360000, type: 'spend', description: 'reservation settle: delivered charge', metadata: { requested_model: 'claude-sonnet-5', served_model: 'claude-haiku-4-5', request_id: 'rq1' }, created_at: '2026-07-21T10:00:05Z' },
          { id: 'x2', workspace_id: 'w', amount_ulxc: 50000000, balance_after_ulxc: 50000000, type: 'admin_grant', description: 'trial onboarding', metadata: {}, created_at: '2026-07-19T08:00:00Z' },
        ])
      // The measured cache rollup. Single digits, as a real trial workspace reads.
      if (path.includes('/api/usage'))
        return json({
          period_days: 7,
          models: [],
          cache: { total_requests: 8, cache_hits: 2, misses: 6, hit_rate: 0.25, by_source: { upstream: 6, cache_hit_exact: 2 } },
        })
      throw new Error(`unexpected fetch: ${path}`)
    }),
  )
}

function renderSpend() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Inside a Router because App mounts it inside one and its empty states link to /setup. These
  // cases all render WITH data, so nothing here throws today — which is the point: without this,
  // the first test anyone adds for the empty case fails on the arrangement, not on the behaviour.
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Spend now={NOW} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('Spend (live)', () => {
  it('derives per-model rows from the live ledger route with tier dots and counts', async () => {
    stubFetch()
    renderSpend()
    const mint = await screen.findByTestId('lens-by-model')
    expect(mint).toHaveTextContent('claude-sonnet-5')
    expect(mint).toHaveTextContent('claude-haiku-4-5')
    expect(mint).toHaveTextContent('2 requests')
    expect(mint).toHaveTextContent('1 request')
    // both fixture models ARE categorised, so both draw a dot inside the mint table
    expect(mint.querySelectorAll('[role="img"]')).toHaveLength(2)
  })

  it('widening the window recounts (30d picks up the older row)', async () => {
    stubFetch()
    renderSpend()
    await screen.findByText('claude-sonnet-5')
    fireEvent.click(screen.getByRole('button', { name: /30d/i }))
    expect(await screen.findByText(/3 requests/)).toBeInTheDocument()
  })

  it('exact µ as numerals; derived month-USD (live route) and cache rate carry ≈', async () => {
    stubFetch()
    renderSpend()
    expect(await screen.findByText(/950/)).toBeInTheDocument()
    expect(screen.getByText(/600/)).toBeInTheDocument()
    // the cache rate is MEASURED now (2 of 8), still ≈-marked because it is derived
    expect(screen.getByText(/≈\s*25%/)).toBeInTheDocument()
    expect(screen.queryByText(/≈\s*87%/)).toBeNull()
    expect(await screen.findByText(/≈\s*\$4\.31/)).toBeInTheDocument()
  })

  it('a dead ledger route is a visible failure, never a silent empty table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/api/tokens/history')) return new Response('{}', { status: 502 })
        return new Response(JSON.stringify({ current_month_usd: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    renderSpend()
    // that stub also feeds the LXC row garbage, so MORE THAN ONE failure shows —
    // the point stands either way: a dead route is visible, never silently empty
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i).length).toBeGreaterThan(0))
  })

  it('no card on this screen is a sample any more', async () => {
    stubFetch()
    renderSpend()
    await screen.findByTestId('lens-by-model')
    // The cache card was the last fixture here; /api/usage retired it.
    expect(screen.queryAllByText(/sample/i)).toHaveLength(0)
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument()
  })

  it('the cache card degrades honestly — empty window and failure, never a number', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        const json = (v: unknown) =>
          new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
        if (path.includes('/api/usage')) return new Response('{}', { status: 500 })
        if (path.includes('/api/tokens/history')) return json(fixtureSpendRows)
        if (path.includes('/api/spend/month')) return json({ current_month_usd: 4.31 })
        return json([])
      }),
    )
    renderSpend()
    expect(await screen.findByText(/Couldn’t load the cache rate/)).toBeInTheDocument()
    expect(screen.queryByText(/%/)).toBeNull()
  })
})

describe('the inversion fix: earned is copper, spent is steel', () => {
  it('labels the by-model table as MINT ATTRIBUTION and shows spend as an LXC debit total', async () => {
    stubFetch()
    renderSpend()
    // the by-model table is EARNED (the mined token), never labelled spend
    expect(await screen.findByText('Earned by model — LENS mint attribution')).toBeInTheDocument()
    // the spent card: LXC debits at window granularity, PLUS the per-model split the
    // screen used to say was impossible
    expect(screen.getByText('Spent — LXC')).toBeInTheDocument()
    expect(screen.getByText(/Inference debits — 7d/)).toBeInTheDocument()
    // await the SPLIT, not the card header: the header is static markup and resolves
    // before the LXC query lands, so asserting on it would race the data.
    expect(await screen.findByTestId('lxc-by-model')).toHaveTextContent('claude-haiku-4-5')
    expect(screen.queryByText(/no model attribution/)).toBeNull()
    expect(screen.queryByText(/no per-model split/)).toBeNull()
  })
})
