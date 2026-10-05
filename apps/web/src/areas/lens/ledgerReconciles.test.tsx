import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Ledger } from './Ledger'

// B28.268 — the ledger math reads correctly: one unit for amounts and balances, and each row's
// balance is the row below plus that row's amount, to the six decimals shown.
//
// A request's settle, as Lens writes it: the hold in one transaction, then the release and the
// delivered charge in another — so those two share a created_at, and Lens (ORDER BY created_at
// DESC, no tiebreak) can return them swapped. Served swapped here.
const SETTLE = '2026-10-05T18:00:02.123456Z'
const LXC_ROWS = [
  { id: 'r', amount_ulxc: 5_000, balance_after_ulxc: 10_000_000, type: 'reservation_release', description: 'reservation settle: release hold', created_at: SETTLE },
  { id: 's', amount_ulxc: -1_234, balance_after_ulxc: 9_998_766, type: 'spend', description: 'reservation settle: delivered charge', created_at: SETTLE },
  { id: 'h', amount_ulxc: -5_000, balance_after_ulxc: 9_995_000, type: 'reservation_hold', description: 'reservation hold (pre-serve)', created_at: '2026-10-05T18:00:01Z' },
  { id: 'g', amount_ulxc: 10_000_000, balance_after_ulxc: 10_000_000, type: 'admin_grant', description: 'trial grant', created_at: '2026-10-05T17:00:00Z' },
].map((r) => ({ ...r, workspace_id: 'ws-1', metadata: {} }))

const LENS_ROWS = [
  { id: 'l1', amount_ulens: 1000, balance_after_ulens: 1000, type: 'pattern_mine_held', description: 'pattern shared (held)', created_at: '2026-07-19T14:52:59Z' },
  { id: 'l2', amount_ulens: 1000, balance_after_ulens: 1000, type: 'pattern_mine', description: 'pattern shared', created_at: '2026-07-19T14:35:21Z' },
].map((r) => ({ ...r, workspace_id: 'ws-1', metadata: {} }))

function renderLedger() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    const rows = url.startsWith('/api/lxc/history') ? LXC_ROWS : url.startsWith('/api/tokens/history') ? LENS_ROWS : null
    return new Response(rows ? JSON.stringify(rows) : 'null', { status: rows ? 200 : 404, headers: { 'Content-Type': 'application/json' } })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Ledger />
    </QueryClientProvider>,
  )
}

/** A figure as the screen shows it — "+0.005000", "9.998766" — back to µ-units. */
function micros(el: HTMLElement): number {
  const shown = el.firstElementChild?.textContent ?? ''
  expect(shown).toMatch(/^[+-]?\d{1,3}(,\d{3})*\.\d{6}$/)
  return Math.round(Number(shown.replace(/,/g, '')) * 1e6)
}

afterEach(() => vi.restoreAllMocks())

describe('B28.268 — the ledger math reads correctly', () => {
  it('shows every amount and balance in LXC, and each balance is the row below plus that row’s amount', async () => {
    const { container } = renderLedger()
    await screen.findByText('reservation settle: delivered charge')
    expect(container.textContent).not.toContain('µ')

    const amounts = screen.getAllByTestId('ledger-amount').map(micros)
    const balances = screen.getAllByTestId('ledger-balance').map(micros)
    expect(amounts).toEqual([-1_234, 5_000, -5_000, 10_000_000]) // the charge above its release
    for (let i = 0; i + 1 < balances.length; i++) expect(balances[i]).toBe(balances[i + 1] + amounts[i])
    expect(screen.getByText('-0.001234')).toBeInTheDocument()
    expect(screen.getByText('9.998766')).toBeInTheDocument()
  })

  it('says a held LENS mint is not in the balance — the one row that does not move it', async () => {
    renderLedger()
    await screen.findByText('reservation settle: delivered charge')
    fireEvent.click(screen.getByRole('button', { name: 'LENS' }))
    await screen.findByText('pattern shared (held)')
    expect(screen.getAllByText('held · not in the balance')).toHaveLength(1)
  })
})
