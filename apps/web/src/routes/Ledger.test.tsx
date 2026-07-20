import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Ledger } from './Ledger'

// The REAL two-row payload captured live from trial-ws-1's tokens/history: a held mint
// and a settled mint. Driving the screen with it proves the table survives the actual
// data shape — including that the held row carries NO window (only created_at).
const REAL_ROWS = [
  {
    id: '184cb09a-5864-4dc6-8b06-bda9068dfc40',
    workspace_id: 'trial-ws-1',
    amount_ulens: 1000,
    balance_after_ulens: 1000,
    type: 'pattern_mine_held',
    description: 'pattern shared (held)',
    metadata: { model_used: 'claude-haiku-4-5', latency_bucket: 'slow' },
    created_at: '2026-07-19T14:52:59.743069Z',
  },
  {
    id: 'f8a0a75e-41dc-420a-8b21-f7201893e47e',
    workspace_id: 'trial-ws-1',
    amount_ulens: 1000,
    balance_after_ulens: 1000,
    type: 'pattern_mine',
    description: 'pattern shared',
    metadata: { model_used: 'claude-haiku-4-5', latency_bucket: 'medium' },
    created_at: '2026-07-19T14:35:21.198558Z',
  },
]

function renderLedger() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Ledger />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Ledger renders the real tokens/history shape', () => {
  it('shows a held row with a held pill and a settled row with a settled pill', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/tokens/history')) {
        return new Response(JSON.stringify(REAL_ROWS), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('null', { status: 404 })
    })

    renderLedger()

    // both descriptions land
    expect(await screen.findByText('pattern shared (held)')).toBeInTheDocument()
    expect(screen.getByText('pattern shared')).toBeInTheDocument()

    // the derived lifecycle pills (settled + held), driven purely by the `type` suffix
    expect(screen.getByText('held')).toBeInTheDocument()
    expect(screen.getByText('settled')).toBeInTheDocument()

    // 1000 µLENS is sub-unit, so MuNumeral shows the µ-integer "1,000", not "0.001000"
    expect(screen.getAllByText('1,000').length).toBeGreaterThan(0)
    expect(screen.queryByText('.001000')).toBeNull()
  })

  it('surfaces an upstream failure honestly rather than faking rows', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }))
    renderLedger()
    expect(await screen.findByText(/Couldn’t load the ledger/)).toBeInTheDocument()
  })
})
