import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Ledger } from './Ledger'

// REAL data captured live from trial-ws-1. LENS ledger: a held mint + a settled mint.
const LENS_ROWS = [
  { id: 'l1', workspace_id: 'trial-ws-1', amount_ulens: 1000, balance_after_ulens: 1000, type: 'pattern_mine_held', description: 'pattern shared (held)', metadata: {}, created_at: '2026-07-19T14:52:59Z' },
  { id: 'l2', workspace_id: 'trial-ws-1', amount_ulens: 1000, balance_after_ulens: 1000, type: 'pattern_mine', description: 'pattern shared', metadata: {}, created_at: '2026-07-19T14:35:21Z' },
]

// LXC ledger: admin_grant, spend, purchase — including the mislabeled bootstrap grant
// (type 'purchase', "no fiat"), which the UI must show verbatim, not compensate for.
const LXC_ROWS = [
  { id: 'x1', workspace_id: 'trial-ws-1', amount_ulxc: 5000000, balance_after_ulxc: 14999936, type: 'admin_grant', description: 'trial top-up via admin grant', metadata: {}, created_at: '2026-07-19T15:48:07Z' },
  { id: 'x2', workspace_id: 'trial-ws-1', amount_ulxc: -64, balance_after_ulxc: 9999936, type: 'spend', description: 'proof-of-agent-allocation: pre-serve estimate debit', metadata: {}, created_at: '2026-07-19T14:52:56Z' },
  { id: 'x3', workspace_id: 'trial-ws-1', amount_ulxc: 10000000, balance_after_ulxc: 10000000, type: 'purchase', description: 'closed-test bootstrap grant (manual admin act, no fiat)', metadata: {}, created_at: '2026-07-19T14:47:36Z' },
]

function mockBothLedgers() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const rows = url.startsWith('/api/lxc/history') ? LXC_ROWS : url.startsWith('/api/tokens/history') ? LENS_ROWS : null
    if (rows) return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } })
    return new Response('null', { status: 404 })
  })
}

function renderLedger() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Ledger />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('Ledger renders both real token ledgers', () => {
  it('defaults to the LENS ledger: held + settled pills, µ-integer amounts', async () => {
    mockBothLedgers()
    renderLedger()

    expect(await screen.findByText('pattern shared (held)')).toBeInTheDocument()
    expect(screen.getByText('held')).toBeInTheDocument()
    expect(screen.getByText('settled')).toBeInTheDocument()
    expect(screen.getAllByText('1,000').length).toBeGreaterThan(0) // sub-unit → µLENS integer
  })

  it('switches to the LXC ledger: 3 movement rows, steel tick, no pills, purchase shown verbatim', async () => {
    mockBothLedgers()
    const { container } = renderLedger()
    await screen.findByText('pattern shared') // LENS loaded first

    fireEvent.click(screen.getByRole('button', { name: 'LXC' }))

    // the three real LXC rows, including the mislabeled bootstrap grant, verbatim
    expect(await screen.findByText('closed-test bootstrap grant (manual admin act, no fiat)')).toBeInTheDocument()
    expect(screen.getByText('trial top-up via admin grant')).toBeInTheDocument()
    // the type is shown faithfully as a plain label — NOT re-interpreted
    expect(screen.getByText('purchase')).toBeInTheDocument()
    expect(screen.getByText('admin grant')).toBeInTheDocument()
    expect(screen.getByText('spend')).toBeInTheDocument()
    // the sub-unit spend renders as a signed µ-integer
    expect(screen.getByText('-64')).toBeInTheDocument()

    // movements carry NO economic pill …
    expect(screen.queryByText('held')).toBeNull()
    expect(screen.queryByText('settled')).toBeNull()
    // … and the unit tick is STEEL (lxc), not copper (lens) — the two-token signature
    expect(container.querySelector('.bg-lxc')).not.toBeNull()
    expect(container.querySelector('.bg-lens')).toBeNull()
  })

  it('surfaces an upstream failure honestly rather than faking rows', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }))
    renderLedger()
    expect(await screen.findByText(/Couldn’t load the ledger/)).toBeInTheDocument()
  })
})
