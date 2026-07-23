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
  it('defaults to the LXC ledger — the one inference moves — with the real movement rows, steel tick, no pills', async () => {
    mockBothLedgers()
    const { container } = renderLedger()

    // Lands on LXC: the three real movements, including the mislabeled bootstrap
    // grant, shown verbatim (the data is wrong, not the display). This is the fix
    // for the review's "first five minutes say nothing happened" — a real
    // workspace has LXC rows from its first request, LENS mint rows never.
    expect(await screen.findByText('closed-test bootstrap grant (manual admin act, no fiat)')).toBeInTheDocument()
    expect(screen.getByText('trial top-up via admin grant')).toBeInTheDocument()
    expect(screen.getByText('purchase')).toBeInTheDocument()
    expect(screen.getByText('admin grant')).toBeInTheDocument()
    expect(screen.getByText('spend')).toBeInTheDocument()
    expect(screen.getByText('-64')).toBeInTheDocument() // signed µ-integer

    // movements carry NO economic pill …
    expect(screen.queryByText('held')).toBeNull()
    expect(screen.queryByText('settled')).toBeNull()
    // … and the unit tick is STEEL (lxc), not copper (lens) — the two-token signature
    expect(container.querySelector('.bg-lxc')).not.toBeNull()
    expect(container.querySelector('.bg-lens')).toBeNull()
  })

  it('switches to the LENS mint ledger: held + settled pills, µ-integer amounts', async () => {
    mockBothLedgers()
    renderLedger()
    await screen.findByText('trial top-up via admin grant') // LXC loaded first (default)

    fireEvent.click(screen.getByRole('button', { name: 'LENS' }))

    expect(await screen.findByText('pattern shared (held)')).toBeInTheDocument()
    expect(screen.getByText('held')).toBeInTheDocument()
    expect(screen.getByText('settled')).toBeInTheDocument()
    expect(screen.getAllByText('1,000').length).toBeGreaterThan(0) // sub-unit → µLENS integer
  })

  it('surfaces an upstream failure honestly rather than faking rows', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }))
    renderLedger()
    expect(await screen.findByText(/Couldn’t load the ledger/)).toBeInTheDocument()
  })
})

// THE NULL EMPTY-STATE BUG (third instance of the shape today): Lens serialises an
// empty slice as JSON `null`, not `[]`. GetHistory/GetLXCHistory return a nil slice
// on a genuinely-empty workspace, so tokens/history and lxc/history answer 200 with
// body `null`. The client mapped over it (`rs.map`), threw, and a TRUE empty state
// rendered as "Couldn't load". Assert on what RENDERS — the status was 200 the whole
// time, which is why this was invisible to any status-code check.
describe('a null body (empty ledger) renders the empty state, not the error state', () => {
  const mockNull = (which: 'tokens' | 'lxc' | 'both') =>
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      const isTokens = url.startsWith('/api/tokens/history')
      const isLxc = url.startsWith('/api/lxc/history')
      const nulls = which === 'both' || (which === 'tokens' && isTokens) || (which === 'lxc' && isLxc)
      if ((isTokens || isLxc) && nulls) {
        return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (isTokens) return new Response(JSON.stringify(LENS_ROWS), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (isLxc) return new Response(JSON.stringify(LXC_ROWS), { status: 200, headers: { 'Content-Type': 'application/json' } })
      return new Response('null', { status: 404 })
    })

  it('LENS: 200 + null → "No ledger entries yet.", never "Couldn’t load"', async () => {
    mockNull('tokens')
    renderLedger()
    fireEvent.click(screen.getByRole('button', { name: 'LENS' })) // the tab the user reported
    expect(await screen.findByText(/no ledger entries yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument()
  })

  it('LXC keeps working exactly as now (real rows) while LENS is null', async () => {
    mockNull('tokens')
    renderLedger()
    fireEvent.click(screen.getByRole('button', { name: 'LXC' }))
    expect(await screen.findByText(/trial top-up via admin grant/i)).toBeInTheDocument()
  })

  it('LXC: 200 + null also renders the empty state (a fresh workspace nulls here too)', async () => {
    mockNull('lxc')
    renderLedger()
    fireEvent.click(screen.getByRole('button', { name: 'LXC' }))
    expect(await screen.findByText(/no ledger entries yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument()
  })
})
