import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
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
  // The LXC ledger — what inference SPENDS. Raw wire shape (amount_ulxc); the
  // client normalizes. Debits are negative; the grant credit must be excluded
  // from any spend total by sign. No model metadata — no LXC writer attaches one.
  '/api/lxc/history': [
    { id: 'x1', workspace_id: 'trial-ws-1', amount_ulxc: -640000, balance_after_ulxc: 49360000, type: 'spend', description: 'proof-of-agent-allocation: pre-serve estimate debit', metadata: {}, created_at: '2026-07-21T10:00:05Z' },
    { id: 'x2', workspace_id: 'trial-ws-1', amount_ulxc: -1360000, balance_after_ulxc: 48000000, type: 'spend', description: 'proof-of-agent-allocation: pre-serve estimate debit', metadata: {}, created_at: '2026-07-20T09:15:05Z' },
    { id: 'x3', workspace_id: 'trial-ws-1', amount_ulxc: 50000000, balance_after_ulxc: 50000000, type: 'admin_grant', description: 'trial onboarding', metadata: {}, created_at: '2026-07-19T08:00:00Z' },
  ],
}

interface Stub {
  status?: number
  body: unknown
}

// Route mocked BFF responses by path. Bonds and the two product probes are
// per-test decisions; on this deployment Track/Docs answer 503 (unconfigured).
function mockBff(opts: { bonds?: Stub; track?: Stub; docs?: Stub } = {}) {
  const bonds = opts.bonds ?? { body: { capability: 'bonds', enabled: false } }
  const track = opts.track ?? { status: 503, body: { error: 'track upstream not configured on this BFF' } }
  const docs = opts.docs ?? { status: 503, body: { error: 'docs upstream not configured on this BFF' } }
  const stub = (s: Stub) =>
    new Response(JSON.stringify(s.body), {
      status: s.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/bonds')) return stub(bonds)
    if (url.startsWith('/api/track/')) return stub(track)
    if (url.startsWith('/api/docs/')) return stub(docs)
    for (const [path, body] of Object.entries(ROUTES)) {
      if (url.startsWith(path)) return stub({ body })
    }
    return new Response('null', { status: 404 })
  })
}

function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Overview now={NOW} />
    </QueryClientProvider>,
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

    // mint-attribution rows, largest µ first, request counts as hints
    expect(await screen.findByText('claude-sonnet-5')).toBeInTheDocument()
    expect(screen.getByText('claude-haiku-4-5')).toBeInTheDocument()
    expect(screen.getByText('2 requests')).toBeInTheDocument()
    // the month number is derived upstream → dressed as ≈, never a numeral
    expect(screen.getByText('≈ $12.35')).toBeInTheDocument()
  })

  it('SPENT is LXC (window debit total, no per-model split) and EARNED is LENS — never inverted', async () => {
    mockBff()
    renderOverview()

    // the two section markers, each side wearing its own metal
    expect(await screen.findByText('Spent — LXC')).toBeInTheDocument()
    expect(screen.getByText('Earned — LENS · mint attribution')).toBeInTheDocument()
    // the debits row exists and states WHY there is no per-model spend split:
    // no LXC ledger writer attaches a model (verified at lens 8c70d9e)
    expect(screen.getByText('Inference debits')).toBeInTheDocument()
    expect(screen.getByText(/LXC ledger rows carry no model attribution/)).toBeInTheDocument()
    // the word "Spend" never labels the mint table: the card header carries both
    expect(screen.getByText('Spend & earnings — last 30 days')).toBeInTheDocument()
  })
})

describe('the cache card is honest about being a sample', () => {
  it('wears its FixtureNotice — sample data is never silent', async () => {
    mockBff()
    renderOverview()

    expect(await screen.findByText(/Sample data — awaiting/)).toBeInTheDocument()
    // the claim's mechanism is stated; the rate is ≈-marked derived
    expect(screen.getByText(/without calling the provider/)).toBeInTheDocument()
    expect(screen.getByText(/≈ 87%/)).toBeInTheDocument()
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

describe('recent activity rides the shared history fetch', () => {
  it('renders ledger rows (capped at five), description first', async () => {
    mockBff()
    renderOverview()

    expect((await screen.findAllByText('pattern shared')).length).toBeGreaterThan(0)
  })
})
