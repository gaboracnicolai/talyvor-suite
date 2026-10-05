import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Spend } from './Spend'
import { spendLines } from '../chat/chatApi'

// B32.69 — the platform fee on AI spend (B32.11) is its own line on the spend screens, in Lens's words, and
// counted in the window's total. The history below is Lens's: the call's spend row and its platform_fee row,
// written in one transaction, the fee's description being the line's words.

const NOW = new Date('2026-10-05T12:00:00Z')
const SPEND_ROW = {
  id: 'x1', workspace_id: 'w', amount_ulxc: -10_000_000, balance_after_ulxc: 89_700_000, type: 'spend',
  description: 'reservation settle: delivered charge', metadata: { requested_model: 'claude-sonnet-5', served_model: 'claude-sonnet-5', request_id: 'rq1' },
  created_at: '2026-10-05T10:00:05Z',
}
const FEE_ROW = {
  id: 'x2', workspace_id: 'w', amount_ulxc: -300_000, balance_after_ulxc: 89_700_000, type: 'platform_fee',
  description: 'Platform fee 3%', metadata: { platform_fee_bps: 300, spend_ulxc: 10_000_000, request_id: 'rq1' },
  created_at: '2026-10-05T10:00:05Z',
}

function renderSpend(history: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (path.includes('/api/lxc/history')) return json(history)
      if (path.includes('/api/tokens/history')) return json([])
      if (path.includes('/api/spend/month')) return json({ current_month_usd: 1.03 })
      if (path.includes('/api/savings/month'))
        return json({ month_start: '2026-10-01T00:00:00Z', saved_usd: 0, list_usd: 0, charged_usd: 0, requests: 0, unmeasured_requests: 0 })
      if (path.includes('/api/usage')) return json({ period_days: 7, models: [], cache: { total_requests: 0, cache_hits: 0, misses: 0, hit_rate: 0, by_source: {} } })
      if (path.includes('/api/spend/by-feature')) return json([])
      throw new Error(`unexpected fetch: ${path}`)
    }),
  )
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Spend now={NOW} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const text = (el: HTMLElement) => (el.textContent ?? '').replace(/\s+/g, '')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('the platform fee on the spend screens (B32.69)', () => {
  it('shows the fee as its own line in Lens’s words, 0.3 LXC, and counts it in a total of 10.3 LXC', async () => {
    renderSpend([SPEND_ROW, FEE_ROW])
    const total = await screen.findByTestId('lxc-debit-total')
    expect(text(total)).toBe('10.300000lxc')
    // Two lines: the call, under its model, and the fee, under Lens's words — never folded into the call.
    const call = text(screen.getByTestId('lxc-by-model'))
    expect(call).toContain('claude-sonnet-5')
    expect(call).toContain('10.000000lxc')
    expect(call).not.toContain('Platformfee')
    const fees = screen.getByTestId('lxc-platform-fees')
    expect(within(fees).getAllByTestId('platform-fee-label').map((l) => l.textContent)).toEqual(['Platform fee 3%'])
    expect(text(fees)).toContain('300,000µlxc') // 0.3 LXC: the µ-split shows a figure under one LXC as µLXC (the unit is upper-cased by CSS)
    expect(fees).toHaveTextContent('on 1 call')
    expect(screen.getByText('every model and the platform fee on it — the window total that left the balance')).toBeInTheDocument()
    // The fee names no model, and is not reported as a charge that failed to.
    expect(screen.queryByTestId('lxc-unsplit')).toBeNull()
  })

  it('looks as it did before for a workspace with no fee rows', async () => {
    renderSpend([SPEND_ROW])
    expect(text(await screen.findByTestId('lxc-debit-total'))).toBe('10.000000lxc')
    expect(screen.queryByTestId('lxc-platform-fees')).toBeNull()
    expect(screen.getByText('every model — the window total that left the balance')).toBeInTheDocument()
  })

  it('carries a fee line’s label into Chat’s statement lines', () => {
    const said = JSON.stringify({
      agents: [{ agent_id: 'agt_1', name: 'Researcher', spent_ulxc: 10_300_000, lines: [
        { entry_id: 'ent_2', kind: 'platform_fee', amount_ulxc: -300_000, at: '2026-10-05T10:00:05Z', label: 'Platform fee 3%' },
        { entry_id: 'ent_1', kind: 'spend', amount_ulxc: -10_000_000, at: '2026-10-05T10:00:05Z' },
      ] }],
    })
    expect(spendLines(said).map((l) => l.label)).toEqual(['Platform fee 3%', undefined])
  })
})
