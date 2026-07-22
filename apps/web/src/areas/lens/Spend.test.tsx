import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Spend } from './Spend'
import { fixtureSpendRows } from './fixtures'

// /spend is LIVE on /api/tokens/history now (the route existed all along; the
// shared scaffold test was what forced fixture rows). The pure spendMath
// derivation is unchanged, so the pinned numbers here are the SAME numbers the
// fixture version showed — the data source swapped, the maths did not. The
// month card reads the new /api/spend/month; only the cache card remains a
// sample (Lens has no workspace cache-rate endpoint) and says so.

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
      throw new Error(`unexpected fetch: ${path}`)
    }),
  )
}

function renderSpend() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <Spend now={NOW} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('Spend (live)', () => {
  it('derives per-model rows from the live ledger route with tier dots and counts', async () => {
    stubFetch()
    renderSpend()
    expect(await screen.findByText('claude-sonnet-5')).toBeInTheDocument()
    expect(screen.getByText('claude-haiku-4-5')).toBeInTheDocument()
    expect(screen.getByText(/2 requests/)).toBeInTheDocument()
    expect(screen.getByText(/1 request\b/)).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: /cheap|capable/ })).toHaveLength(2)
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
    expect(screen.getByText(/≈\s*87%/)).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument())
  })

  it('only the cache card is still a sample, and it says so without placeholder wording', async () => {
    stubFetch()
    renderSpend()
    await screen.findByText('claude-sonnet-5')
    expect(screen.getAllByText(/sample/i)).toHaveLength(1)
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument()
  })
})
