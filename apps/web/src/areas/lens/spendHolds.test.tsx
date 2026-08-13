import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Spend } from './Spend'

// ⚠ A RESERVATION HOLD IS NOT SPEND, AND THE PANEL COUNTED IT AS ONE.
//
// Found by a tester on the live deploy: "Spend & routing" read ~4.5x the real figure. The panel
// summed every NEGATIVE lxc_ledger row, and `reservation_hold` is negative — it is money reserved
// BEFORE serving, released moments later, netting to zero against its `reservation_release`.
//
// Lens says so itself, on the constant declaration
// (internal/economy/agent_subbudget.go#LXCTypeReservationHold):
//
//     "LXCTypeReservationHold marks the pre-serve HOLD debit — a bound, NOT a bill. Revenue readers
//      (sum type='spend') MUST exclude it; it nets to zero against its release."
//
// ⚠ THIS POINTER USED TO NAME A LINE, AND THE LINE WAS BLANK. #198 found the same quote in
// `spendMath.ts` citing a position 45 lines above the constant and corrected it there; the copy
// here — quote and number together, in the file whose whole subject is this defect — was outside
// that merge's per-file rule and stayed false. See rule D in `upstreamCitations.test.ts`. It also
// said "next to the code that writes the row": the writer is `#ReserveLXCForAgent`, and the
// sentence is not there. It is on the constant, which is what the symbol now names.
//
// The invariant was documented at the writer and never reached the reader. `type` survives the whole
// way — Lens selects it, the BFF proxies it, api.ts maps it — and only spendMath's row interface
// dropped it, so the sums could not see what they were adding.
//
// These are REAL production rows, two requests' worth:
//     -3270 reservation_hold  →  +3270 reservation_release   (net zero)
//     -920  spend                                            (the actual charge)
// Naive sum of negatives: 8,380.  Actually spent: 1,840.

const NOW = new Date('2026-07-22T12:00:00Z')

// Two complete request cycles, exactly as the ledger records them.
const productionRows = [
  { id: 'h1', workspace_id: 'w', amount_ulxc: -3270, balance_after_ulxc: 96730, type: 'reservation_hold',    description: 'pre-serve hold',  metadata: { request_id: 'rq1', served_model: 'claude-haiku-4-5' }, created_at: '2026-07-21T10:00:00Z' },
  { id: 'r1', workspace_id: 'w', amount_ulxc:  3270, balance_after_ulxc: 100000, type: 'reservation_release', description: 'refund unused',   metadata: { request_id: 'rq1' }, created_at: '2026-07-21T10:00:02Z' },
  { id: 's1', workspace_id: 'w', amount_ulxc:  -920, balance_after_ulxc: 99080, type: 'spend',                description: 'delivered charge', metadata: { request_id: 'rq1', served_model: 'claude-haiku-4-5' }, created_at: '2026-07-21T10:00:02Z' },
  { id: 'h2', workspace_id: 'w', amount_ulxc: -3270, balance_after_ulxc: 95810, type: 'reservation_hold',    description: 'pre-serve hold',  metadata: { request_id: 'rq2', served_model: 'claude-haiku-4-5' }, created_at: '2026-07-21T11:00:00Z' },
  { id: 'r2', workspace_id: 'w', amount_ulxc:  3270, balance_after_ulxc: 99080, type: 'reservation_release', description: 'refund unused',   metadata: { request_id: 'rq2' }, created_at: '2026-07-21T11:00:02Z' },
  { id: 's2', workspace_id: 'w', amount_ulxc:  -920, balance_after_ulxc: 98160, type: 'spend',                description: 'delivered charge', metadata: { request_id: 'rq2', served_model: 'claude-haiku-4-5' }, created_at: '2026-07-21T11:00:02Z' },
]

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      const json = (v: unknown) =>
        new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (path.includes('/api/lxc/history')) return json(productionRows)
      if (path.includes('/api/tokens/history')) return json([])
      if (path.includes('/api/spend/month')) return json({ current_month_usd: 0 })
      if (path.includes('/api/usage')) return json({ period_days: 7, models: [] })
      if (path.includes('/api/context')) return json({ workspace_id: 'w' })
      return json({})
    }),
  )
}

function renderSpend() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // MemoryRouter is not scaffolding, for the reason Overview.test.tsx records: Spend's empty
  // states link to /setup, and App mounts Spend inside the app Router. Rendering it outside one
  // tested an arrangement that does not exist — and would have thrown only in the empty case,
  // which is exactly the brand-new user this copy is written for.
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <Spend now={NOW} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('Spend panel — reservation holds are not spend', () => {
  // ⭐ THE DISPLAYED NUMBER, not a helper. This is what the tester saw.
  it('shows the settled charge (1,840 µLXC), not the sum of every negative row (8,380)', async () => {
    stub()
    renderSpend()

    await waitFor(() => {
      // 1,840 µLXC = 0.001840 LXC. Whatever the unit formatting, the WRONG total (8,380) must
      // not appear anywhere on the screen, and the right one must.
      const body = document.body.textContent ?? ''
      expect(body).not.toMatch(/8[,.]?380/)
      expect(body).toMatch(/1[,.]?840|0?\.00184/)
    })
  })

  // ⚠ The per-model split is the SAME defect written a second time — one function over, same file.
  // Without this, fixing only the headline leaves the breakdown 4.5x high and disagreeing with it.
  it('attributes only the settled charge per model, so the split agrees with the total', async () => {
    stub()
    renderSpend()

    await waitFor(() => {
      const body = document.body.textContent ?? ''
      expect(body).toMatch(/claude-haiku-4-5/)
      // 3270+920 = 4190 per request, 8380 for two — the naive per-model figure.
      expect(body).not.toMatch(/8[,.]?380|4[,.]?190/)
    })
  })
})
